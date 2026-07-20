package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/fsutil"
	"packrat/backend/internal/models"
	"packrat/backend/internal/pathsafe"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
)

// embedMetadataSem caps how many EmbedMetadata goroutines (below, in
// UpdateLibraryItem) can run at once — each is an ffmpeg remux, so with no
// cap a large bulk edit (BulkEditLibraryItemsDialog fires one PATCH per
// changed row, N in parallel) would fan out N simultaneous ffmpeg processes
// with no backpressure. Sized as a fixed small constant rather than tied to
// the (runtime-editable) download worker count, since this is a short,
// CPU-light remux rather than a full download.
var embedMetadataSem = make(chan struct{}, 4)

// writeRenamePairError reports a fsutil.RenamePair failure as 409 when it's
// a destination-already-exists collision, matching the 409-style handling
// collections/tags/artists already use for name clashes, or 500 otherwise.
func writeRenamePairError(c *gin.Context, err error) {
	if errors.Is(err, fsutil.ErrDestinationExists) {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
}

// ListLibrary supports search/filter/sort/pagination via query params —
// ?q=&collectionId=&collectionIds=1,2&year=&tags=a,b&sortKey=&sortDir=&page=&pageSize= — all
// optional; with none set it behaves as it always did (every item, sorted by
// downloadedAt desc). page/pageSize are only honored together with page > 0;
// omitting page returns every matching row regardless of pageSize, matching
// the "pagination is opt-in, default off" behavior in Settings. collectionIds
// is a separate IN-match filter (used to resolve a bulk-selected folder plus
// its nested subcollections) that takes precedence over collectionId.
func ListLibrary(repo *repository.LibraryRepo, collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo, mediaRoot string) gin.HandlerFunc {
	return func(c *gin.Context) {
		q := repository.LibraryQuery{
			Search:  c.Query("q"),
			SortKey: c.DefaultQuery("sortKey", "downloadedAt"),
			SortDir: c.DefaultQuery("sortDir", "desc"),
		}
		if v := c.Query("collectionIds"); v != "" {
			// Bulk-selection resolution (a folder + its nested subcollections)
			// — takes precedence over collectionId below when present.
			for _, part := range strings.Split(v, ",") {
				id, err := strconv.ParseInt(part, 10, 64)
				if err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": "invalid collectionIds"})
					return
				}
				q.CollectionIDs = append(q.CollectionIDs, id)
			}
		} else if v := c.Query("collectionId"); v == "none" {
			// "none" explicitly means "uncategorized only" (collection_id IS
			// NULL) — folder view's root — distinct from omitting the param
			// entirely, which means no filter at all.
			q.CollectionIDIsNull = true
		} else if v != "" {
			id, err := strconv.ParseInt(v, 10, 64)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid collectionId"})
				return
			}
			q.CollectionID = &id
		}
		if v := c.Query("year"); v != "" {
			year, err := strconv.Atoi(v)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid year"})
				return
			}
			q.Year = &year
		}
		if v := c.Query("tags"); v != "" {
			q.Tags = strings.Split(v, ",")
		}
		if v := c.Query("page"); v != "" {
			page, err := strconv.Atoi(v)
			if err != nil || page < 1 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid page"})
				return
			}
			q.Page = page
			q.PageSize, _ = strconv.Atoi(c.Query("pageSize")) // 0 falls back to Query's default
		}

		rows, total, err := repo.Query(c.Request.Context(), q)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		cols, err := collectionsRepo.List(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		privacy := effectivePrivacyMap(cols)

		ids := make([]int64, len(rows))
		for i, item := range rows {
			ids[i] = item.ID
		}
		tagsByID, err := tagsRepo.TagsByLibraryIDs(c.Request.Context(), ids)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		privateTagNames, err := tagsRepo.PrivateTagNames(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		out := make([]LibraryItemResponse, 0, len(rows))
		for _, item := range rows {
			blurred := item.CollectionID != nil && privacy[*item.CollectionID]
			if !blurred {
				for _, t := range tagsByID[item.ID] {
					if privateTagNames[t] {
						blurred = true
						break
					}
				}
			}
			out = append(out, toLibraryItemResponse(item, blurred, tagsByID[item.ID], mediaRoot))
		}
		c.JSON(http.StatusOK, LibraryListResponse{Items: out, Total: total})
	}
}

// GetLibraryFacets returns distinct filter values computed over the whole
// library, for UI pickers (the year dropdown) that need every possible
// value regardless of whatever page/folder/search is currently active.
func GetLibraryFacets(repo *repository.LibraryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		years, err := repo.DistinctYears(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, LibraryFacetsResponse{Years: years})
	}
}

// DeleteLibraryItem removes a library row and, when ?deleteFiles=true is
// passed, best-effort removes the media file and thumbnail from disk too —
// a missing file is logged, not treated as a request failure, since the
// end state (file gone) is the same either way.
func DeleteLibraryItem(repo *repository.LibraryRepo, mediaRoot string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		deleteFiles := c.Query("deleteFiles") == "true"

		item, err := repo.Get(c.Request.Context(), id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		if deleteFiles {
			deleteLibraryItemFiles(mediaRoot, item)
		}

		if err := repo.Delete(c.Request.Context(), id); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// deleteLibraryItemFiles best-effort removes item's media file and
// thumbnail (if any) from mediaRoot — a missing file is logged, not treated
// as an error, since the end state (file gone) is the same either way.
// Shared by DeleteLibraryItem and BulkDeleteLibraryItems.
func deleteLibraryItemFiles(mediaRoot string, item *models.LibraryItem) {
	mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
	if err := os.Remove(mediaAbs); err != nil && !os.IsNotExist(err) {
		log.Printf("library: failed to delete media file %s: %v", mediaAbs, err)
	}
	if item.Thumbnail != nil {
		thumbAbs := filepath.Join(mediaRoot, filepath.FromSlash(*item.Thumbnail))
		if err := os.Remove(thumbAbs); err != nil && !os.IsNotExist(err) {
			log.Printf("library: failed to delete thumbnail %s: %v", thumbAbs, err)
		}
	}
}

// BulkDeleteLibraryItems mirrors DeleteLibraryItem applied to a batch — one
// shared DeleteFiles flag for the whole request, not per item. An id that's
// already gone (ErrNotFound) is skipped rather than failing the batch. The
// DB deletes run inside one transaction, so a genuine mid-batch failure
// rolls back every row this call already deleted instead of leaving a mix
// of deleted/not-deleted rows — files removed from disk in earlier
// iterations aren't part of that transaction (there's no filesystem
// rollback), but the DB and the on-disk library it describes were already
// only best-effort synced before this fix, and DeleteFiles failures are
// logged, not fatal, so this doesn't make that any worse.
func BulkDeleteLibraryItems(db *sql.DB, repo *repository.LibraryRepo, mediaRoot string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req BulkDeleteLibraryItemsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		tx, err := db.BeginTx(c.Request.Context(), nil)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer tx.Rollback()
		txRepo := repo.WithTx(tx)

		var resp BulkDeleteResponse
		for _, id := range req.ItemIDs {
			item, err := txRepo.Get(c.Request.Context(), id)
			if err != nil {
				if errors.Is(err, repository.ErrNotFound) {
					continue
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}

			if req.DeleteFiles {
				deleteLibraryItemFiles(mediaRoot, item)
			}

			if err := txRepo.Delete(c.Request.Context(), id); err != nil {
				if errors.Is(err, repository.ErrNotFound) {
					continue
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			resp.Deleted++
		}

		if err := tx.Commit(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, resp)
	}
}

// RenameLibraryItem updates the display title (DB only) and/or the actual
// filename (renames the media file and its thumbnail on disk, then updates
// the DB — see fsutil.RenamePair for the best-effort atomicity) and/or the
// display-only metadata fields (uploader, description, duration,
// resolution, artist, year). Fields omitted from the request are left
// untouched — the current value is merged in before writing, so a form
// that only sends the fields it changed can never accidentally blank out
// the others. If title/artist/year changed, the actual file's own
// container metadata is best-effort updated to match (see EmbedMetadata) —
// this runs in the background after the response is sent, since it remuxes
// the whole file via ffmpeg and can take several seconds for a real video;
// a failure there is logged but never fails the request, since the app's
// own DB state is the source of truth for what Packrat displays.
func UpdateLibraryItem(repo *repository.LibraryRepo, mediaRoot string, ytdlp *downloader.YtDlpService, tagsRepo *repository.TagsRepo, artistsRepo *repository.ArtistsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		var req UpdateLibraryItemRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		item, err := repo.Get(c.Request.Context(), id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))

		if req.Title != nil {
			if err := repo.UpdateTitle(c.Request.Context(), id, *req.Title); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}

		if req.Filename != nil {
			newBase := fsutil.SanitizeFilename(*req.Filename)
			if newBase == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid filename"})
				return
			}

			mediaExt := filepath.Ext(item.Filename)
			oldMediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
			dir := filepath.Dir(oldMediaAbs)
			newMediaAbs := filepath.Join(dir, newBase+mediaExt)

			var oldThumbAbs, newThumbAbs string
			if item.Thumbnail != nil {
				thumbExt := filepath.Ext(*item.Thumbnail)
				oldThumbAbs = filepath.Join(mediaRoot, filepath.FromSlash(*item.Thumbnail))
				newThumbAbs = filepath.Join(dir, newBase+thumbExt)
			}

			if err := fsutil.RenamePair(oldMediaAbs, newMediaAbs, oldThumbAbs, newThumbAbs); err != nil {
				writeRenamePairError(c, err)
				return
			}

			var newThumbRelPtr *string
			if item.Thumbnail != nil {
				s := toRelSlash(mediaRoot, newThumbAbs)
				newThumbRelPtr = &s
			}
			if err := repo.UpdateFilename(c.Request.Context(), id, newBase+mediaExt, toRelSlash(mediaRoot, newMediaAbs), newThumbRelPtr); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			mediaAbs = newMediaAbs
		}

		if req.Uploader != nil || req.Description != nil || req.Duration != nil || req.Resolution != nil || req.ArtistID != nil || req.Year != nil || req.SequenceNumber != nil || req.SeasonNumber != nil {
			uploader, description, duration, resolution, year, sequenceNumber, seasonNumber := req.Uploader, req.Description, req.Duration, req.Resolution, req.Year, req.SequenceNumber, req.SeasonNumber
			if uploader == nil {
				uploader = item.Uploader
			}
			if description == nil {
				description = item.Description
			}
			if duration == nil {
				duration = item.Duration
			}
			if resolution == nil {
				resolution = item.Resolution
			}
			artistID := item.ArtistID
			if req.ArtistID != nil {
				if *req.ArtistID == 0 {
					artistID = nil
				} else {
					artistID = req.ArtistID
				}
			}
			if year == nil {
				year = item.ReleaseYear
			}
			if sequenceNumber == nil {
				sequenceNumber = item.SequenceNumber
			}
			if seasonNumber == nil {
				seasonNumber = item.SeasonNumber
			}
			// title=nil relies on UpdateMetadata's COALESCE(?, title) so this
			// call never touches title — that's handled by UpdateTitle above.
			if err := repo.UpdateMetadata(c.Request.Context(), id, nil, uploader, duration, resolution, description, artistID, year, sequenceNumber, seasonNumber); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}

		if req.Title != nil || req.ArtistID != nil || req.Year != nil || req.SequenceNumber != nil || req.SeasonNumber != nil {
			title := item.Title
			if req.Title != nil {
				title = *req.Title
			}
			artistID := item.ArtistID
			if req.ArtistID != nil {
				if *req.ArtistID == 0 {
					artistID = nil
				} else {
					artistID = req.ArtistID
				}
			}
			var artistName *string
			if artistID != nil {
				if a, err := artistsRepo.Get(c.Request.Context(), *artistID); err == nil {
					artistName = &a.Name
				}
			}
			year := item.ReleaseYear
			if req.Year != nil {
				year = req.Year
			}
			sequenceNumber := item.SequenceNumber
			if req.SequenceNumber != nil {
				sequenceNumber = req.SequenceNumber
			}
			seasonNumber := item.SeasonNumber
			if req.SeasonNumber != nil {
				seasonNumber = req.SeasonNumber
			}
			// Backgrounded: c.Request.Context() would be cancelled as soon as
			// the handler returns, so this uses context.Background() instead —
			// EmbedMetadata applies its own internal timeout regardless.
			// embedMetadataSem bounds how many of these run concurrently.
			go func(path, title string, artist *string, year, sequenceNumber, seasonNumber *int) {
				embedMetadataSem <- struct{}{}
				defer func() { <-embedMetadataSem }()
				if err := ytdlp.EmbedMetadata(context.Background(), path, title, artist, year, sequenceNumber, seasonNumber); err != nil {
					log.Printf("library: embedding metadata into %s failed: %v", path, err)
				}
			}(mediaAbs, title, artistName, year, sequenceNumber, seasonNumber)
		}

		if req.OriginalURL != nil {
			trimmed := strings.TrimSpace(*req.OriginalURL)
			var urlPtr *string
			if trimmed != "" {
				urlPtr = &trimmed
			}
			if err := repo.UpdateOriginalURL(c.Request.Context(), id, urlPtr); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}

		if req.Tags != nil {
			tagIDs, err := tagsRepo.GetOrCreateByNames(c.Request.Context(), *req.Tags)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if err := tagsRepo.SetForLibraryItem(c.Request.Context(), id, tagIDs); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}

		if req.GenerateNFO != nil {
			if err := repo.UpdateGenerateNFO(c.Request.Context(), id, *req.GenerateNFO); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}

		// Keep an opted-in item's .nfo sidecar in sync whenever something it
		// reflects changes — including the toggle itself just being turned on,
		// so the file appears immediately rather than waiting for the next
		// unrelated edit. Failure here doesn't fail the request: the metadata
		// save itself already succeeded.
		nfoRelevant := req.Title != nil || req.Description != nil || req.Year != nil || req.SequenceNumber != nil || req.SeasonNumber != nil || req.Tags != nil ||
			(req.GenerateNFO != nil && *req.GenerateNFO)
		if nfoRelevant {
			if updated, err := repo.Get(c.Request.Context(), id); err == nil && updated.GenerateNFO {
				if err := writeNFO(c.Request.Context(), mediaRoot, tagsRepo, updated); err != nil {
					log.Printf("library: writing nfo for %d failed: %v", id, err)
				}
			}
		}

		c.Status(http.StatusNoContent)
	}
}

// BulkAssignTags overwrites the tag set on every listed item in one
// transaction (TagsRepo.SetForLibraryItems) — not a merge, matching the
// frontend bulk-edit dialog's explicit "replaces all tags" warning. Ids that
// no longer exist are silently skipped by SetForLibraryItems rather than
// failing the whole batch.
func BulkAssignTags(repo *repository.LibraryRepo, tagsRepo *repository.TagsRepo, mediaRoot string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req BulkAssignTagsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		tagIDs, err := tagsRepo.GetOrCreateByNames(c.Request.Context(), req.Tags)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := tagsRepo.SetForLibraryItems(c.Request.Context(), req.ItemIDs, tagIDs); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// Keep each opted-in item's .nfo sidecar in sync, same as
		// UpdateLibraryItem's nfoRelevant block — best effort, log-only.
		for _, id := range req.ItemIDs {
			item, err := repo.Get(c.Request.Context(), id)
			if err != nil || !item.GenerateNFO {
				continue
			}
			if err := writeNFO(c.Request.Context(), mediaRoot, tagsRepo, item); err != nil {
				log.Printf("library: writing nfo for %d failed: %v", id, err)
			}
		}

		c.Status(http.StatusNoContent)
	}
}

// MoveLibraryItem relocates the media file and thumbnail to a new
// collection/folder, reusing the same effective-root resolution and
// path-safety validation as creating a download in the first place.
func MoveLibraryItem(repo *repository.LibraryRepo, mgr *queue.DownloadManager, mediaRoot string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		var req MoveLibraryItemRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		item, err := repo.Get(c.Request.Context(), id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		effectiveRoot, err := mgr.ResolveEffectiveRoot(c.Request.Context(), req.CollectionID)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "collection not found"})
				return
			}
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid collection root: " + err.Error()})
			return
		}
		destDir, err := pathsafe.ResolveUnderRoot(effectiveRoot, req.Folder)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid folder: " + err.Error()})
			return
		}
		if err := fsutil.EnsureDir(destDir); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		oldMediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		newMediaAbs := filepath.Join(destDir, item.Filename)

		var oldThumbAbs, newThumbAbs string
		if item.Thumbnail != nil {
			oldThumbAbs = filepath.Join(mediaRoot, filepath.FromSlash(*item.Thumbnail))
			newThumbAbs = filepath.Join(destDir, filepath.Base(*item.Thumbnail))
		}

		if err := fsutil.RenamePair(oldMediaAbs, newMediaAbs, oldThumbAbs, newThumbAbs); err != nil {
			writeRenamePairError(c, err)
			return
		}

		var newThumbRelPtr *string
		if item.Thumbnail != nil {
			s := toRelSlash(mediaRoot, newThumbAbs)
			newThumbRelPtr = &s
		}
		if err := repo.UpdateLocation(c.Request.Context(), id, req.CollectionID, req.Folder, item.Filename, toRelSlash(mediaRoot, newMediaAbs), newThumbRelPtr); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.Status(http.StatusNoContent)
	}
}

// RefreshLibraryItemMetadata re-fetches yt-dlp metadata for the item's
// original URL and updates the display fields — it never touches the
// media file or thumbnail already on disk.
func RefreshLibraryItemMetadata(repo *repository.LibraryRepo, ytdlp *downloader.YtDlpService, collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo, mediaRoot string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		item, err := repo.Get(c.Request.Context(), id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		if item.OriginalURL == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no source URL set for this item"})
			return
		}

		meta, err := ytdlp.FetchMetadata(c.Request.Context(), *item.OriginalURL)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "fetching metadata: " + err.Error()})
			return
		}

		duration := int(meta.Duration)
		var resolution *string
		if meta.Width > 0 && meta.Height > 0 {
			r := fmt.Sprintf("%dx%d", meta.Width, meta.Height)
			resolution = &r
		}
		title, uploader, description := meta.Title, meta.Uploader, meta.Description

		// artist/year/sequenceNumber/seasonNumber are manual-only fields
		// (yt-dlp doesn't reliably expose them) — pass the item's existing
		// values through so this refresh never clobbers them.
		if err := repo.UpdateMetadata(c.Request.Context(), id, &title, &uploader, &duration, resolution, &description, item.ArtistID, item.ReleaseYear, item.SequenceNumber, item.SeasonNumber); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		updated, err := repo.Get(c.Request.Context(), id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		var blurred bool
		if updated.CollectionID != nil {
			blurred, err = collectionsRepo.IsPrivate(c.Request.Context(), *updated.CollectionID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		tags, err := tagsRepo.TagsForLibraryItem(c.Request.Context(), id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if !blurred {
			blurred, err = tagsRepo.HasPrivateTag(c.Request.Context(), tags)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}

		if updated.GenerateNFO {
			if err := writeNFO(c.Request.Context(), mediaRoot, tagsRepo, updated); err != nil {
				log.Printf("library: writing nfo for %d failed: %v", id, err)
			}
		}

		c.JSON(http.StatusOK, toLibraryItemResponse(*updated, blurred, tags, mediaRoot))
	}
}

// CompareLibraryItemMetadata re-fetches yt-dlp metadata for the item's
// original URL and returns it as-is for a side-by-side comparison against
// the saved item — unlike RefreshLibraryItemMetadata, this never writes
// anything back to the DB.
func CompareLibraryItemMetadata(repo *repository.LibraryRepo, ytdlp *downloader.YtDlpService) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		item, err := repo.Get(c.Request.Context(), id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		if item.OriginalURL == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no source URL set for this item"})
			return
		}

		meta, err := ytdlp.FetchMetadata(c.Request.Context(), *item.OriginalURL)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "fetching metadata: " + err.Error()})
			return
		}

		c.JSON(http.StatusOK, toLibraryItemMetadataPreviewResponse(meta))
	}
}

// RedownloadLibraryItem re-queues a download from the item's original URL,
// reusing the exact original type/quality/format/filename when the source
// download row is still around, falling back to sensible defaults if not.
func RedownloadLibraryItem(libraryRepo *repository.LibraryRepo, downloadsRepo *repository.DownloadsRepo, mgr *queue.DownloadManager, collectionsRepo *repository.CollectionsRepo, settingsRepo *repository.SettingsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		item, err := libraryRepo.Get(c.Request.Context(), id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		if item.OriginalURL == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no source URL set for this item"})
			return
		}

		downloadType := "video"
		if def, err := settingsRepo.Get(c.Request.Context(), models.SettingDefaultDownloadType); err == nil && def != "" {
			downloadType = def
		}
		req := CreateDownloadRequest{
			URL:          *item.OriginalURL,
			CollectionID: item.CollectionID,
			Folder:       item.Folder,
			DownloadType: downloadType,
		}
		if item.DownloadID != nil {
			if orig, err := downloadsRepo.Get(c.Request.Context(), *item.DownloadID); err == nil {
				req.DownloadType = orig.DownloadType
				req.Quality = orig.Quality
				req.Filename = orig.Filename
				if orig.AudioFormat != nil {
					req.AudioFormat = *orig.AudioFormat
				}
			}
		}

		newID, err := enqueueDownload(c.Request.Context(), mgr, collectionsRepo, settingsRepo, req)
		if err != nil {
			writeEnqueueError(c, err)
			return
		}
		c.JSON(http.StatusCreated, gin.H{"id": newID})
	}
}

func toRelSlash(root, abs string) string {
	if rel, err := filepath.Rel(root, abs); err == nil {
		return filepath.ToSlash(rel)
	}
	return filepath.ToSlash(abs)
}

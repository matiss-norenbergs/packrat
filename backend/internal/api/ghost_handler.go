package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/ghostthumb"
	"packrat/backend/internal/itemlock"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/sysevents"
)

// CreateGhostLibraryItem creates a library item with no downloaded file —
// title/metadata only, shown as a type-appropriate placeholder in the UI
// until a later "Download now" (the existing redownload machinery, see
// queue/manager.go's completeRedownload) fills it in. filename/path are set
// to "" (the same empty-string sentinel LibraryRepo.ClearFile uses) and
// status to "ghost" — both columns are NOT NULL but otherwise
// unconstrained, so this needs no schema change to store.
func CreateGhostLibraryItem(libraryRepo *repository.LibraryRepo, imagesRoot string, ytdlp *downloader.YtDlpService, tagsRepo *repository.TagsRepo, responder *ItemResponder) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()

		var req CreateGhostLibraryItemRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		item := models.LibraryItem{
			Title:          req.Title,
			Filename:       "",
			Path:           "",
			CollectionID:   req.CollectionID,
			OriginalURL:    req.OriginalURL,
			MediaType:      &req.MediaType,
			ArtistID:       req.ArtistID,
			ReleaseYear:    req.Year,
			SequenceNumber: req.SequenceNumber,
			SeasonNumber:   req.SeasonNumber,
			GenerateNFO:    req.GenerateNFO,
			Status:         "ghost",
		}
		id, err := libraryRepo.Create(ctx, &item)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		if len(req.Tags) > 0 {
			tagIDs, err := tagsRepo.GetOrCreateByNames(ctx, req.Tags)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if err := tagsRepo.SetForLibraryItem(ctx, id, tagIDs); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}

		if req.FetchThumbnail && req.OriginalURL != nil {
			fetchGhostThumbnail(ctx, libraryRepo, imagesRoot, ytdlp, id, *req.OriginalURL)
		}

		created, err := libraryRepo.Get(ctx, id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		resp, err := responder.Response(ctx, *created)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, resp)
	}
}

// fetchGhostThumbnail (the implementation is the shared ghostthumb.Generate,
// also used by the queue worker) best-effort fetches and tiers a thumbnail for a
// library item from url, independent of whether the item has a file
// (originally built for ghost creation, now also reused by the bulk
// "Download thumbnail(s)" operation for real items too) — the source image
// is fetched into a scratch temp dir (deleted once tiering is done) and
// only the ImagesRoot-relative WebP tiers (ThumbnailSmallPath/
// ThumbnailMediumPath, served via imageUrl()) are written — the plain
// Thumbnail field (served via mediaFileUrl(), MediaRoot-relative) is
// deliberately left untouched since there's no MediaRoot location tied to
// this fetch. Returns whether it actually succeeded, so bulk callers can
// report accurate fetched/skipped counts; single-item callers that only
// want best-effort behavior can ignore the return value.
func fetchGhostThumbnail(ctx context.Context, libraryRepo *repository.LibraryRepo, imagesRoot string, ytdlp *downloader.YtDlpService, id int64, url string) bool {
	return ghostthumb.Generate(ctx, libraryRepo, imagesRoot, ytdlp.FFmpegPath, id, func(ctx context.Context, dir string) (string, error) {
		return ytdlp.FetchThumbnail(ctx, url, dir, "thumb")
	})
}

// BulkFetchLibraryThumbnails is the Library toolbar's bulk "Download
// thumbnail(s)" operation — reuses fetchGhostThumbnail per selected item
// (works the same whether the item has a file or not, since it only ever
// writes ImagesRoot-relative tiers). Items with no source URL are silently
// skipped, matching this app's other bulk operations.
func BulkFetchLibraryThumbnails(libraryRepo *repository.LibraryRepo, downloadsRepo *repository.DownloadsRepo, imagesRoot string, ytdlp *downloader.YtDlpService) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		var req BulkFetchLibraryThumbnailsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		active, err := downloadsRepo.ActiveDownloadIDsByLibraryItem(ctx, req.ItemIDs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		var resp BulkFetchThumbnailsResponse
		for _, id := range req.ItemIDs {
			if _, busy := active[id]; busy {
				resp.Skipped++
				resp.SkippedDownloading++
				continue
			}
			item, err := libraryRepo.Get(ctx, id)
			if err != nil {
				if errors.Is(err, repository.ErrNotFound) {
					resp.Skipped++
					continue
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if item.OriginalURL == nil {
				resp.Skipped++
				continue
			}

			if fetchGhostThumbnail(ctx, libraryRepo, imagesRoot, ytdlp, id, *item.OriginalURL) {
				resp.Fetched++
			} else {
				resp.Skipped++
			}
		}
		c.JSON(http.StatusOK, resp)
	}
}

// DeleteLibraryItemFile removes just an item's media file (optionally also
// its thumbnail) — the DB row, tags, collection membership, and all other
// metadata are left untouched. The inverse of a real download completing;
// puts the item into the same "ghost" state CreateGhostLibraryItem creates
// directly (see LibraryRepo.ClearFile).
func DeleteLibraryItemFile(libraryRepo *repository.LibraryRepo, originalsRepo *repository.ThumbnailEnhancementOriginalsRepo, locks *itemlock.Locks, mediaRoot, imagesRoot string) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		if !locks.TryLock(id) {
			writeItemBusy(c)
			return
		}
		defer locks.Unlock(id)

		item, err := libraryRepo.Get(ctx, id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if item.Path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "item has no file"})
			return
		}

		clearThumbnail := c.Query("deleteThumbnail") == "true"
		if err := libraryRepo.ClearFile(ctx, id, clearThumbnail); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if isImageItem(item) && !clearThumbnail {
			// The thumbnail pointer was the deleted file; the tiers stay.
			if err := libraryRepo.ClearThumbnailPointer(ctx, id); err != nil {
				log.Printf("delete file: clearing thumbnail pointer for item %d failed: %v", id, err)
			}
		}
		purgeLibraryItemFileArtifacts(ctx, mediaRoot, imagesRoot, originalsRepo, item, clearThumbnail)
		c.Status(http.StatusNoContent)
	}
}

// ScanMissingLibraryFiles checks every non-ghost item's on-record file
// against disk and converts any that are missing into ghost items — same
// end state, same ClearFile call, as the existing "Delete file…" action —
// so a file removed or moved outside the app entirely (by hand, by
// Jellyfin, a disk issue) doesn't just keep 404ing forever with no
// indication in the UI. On-demand only (triggered by a Settings button, not
// scheduled), since converting library rows is a mutation someone should
// opt into rather than have happen silently on a timer. Thumbnails are left
// untouched (ClearFile's clearThumbnail: false) — only the media file has
// been confirmed missing here, the thumbnail may well still be fine.
//
// ClearFile is irreversible, so the scan is deliberately conservative: only
// fs.ErrNotExist counts as missing (other stat errors are reported as
// "unreadable" and the item is left alone); an absent, unreadable or empty
// media root is refused with 409 (an unmounted volume looks like a library
// of vanished files); and a scan that would clear 10+ items and at least half
// of those scanned is refused with 409 requiresConfirm unless the optional
// body says {"confirm": true}. The whole list is decided before any write.
func ScanMissingLibraryFiles(mediaRoot string, libraryRepo *repository.LibraryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()

		// The body is optional ({"confirm": true}); an absent or empty one must keep working.
		var req ScanMissingLibraryFilesRequest
		raw, err := io.ReadAll(io.LimitReader(c.Request.Body, 4096))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "reading request body: " + err.Error()})
			return
		}
		if len(bytes.TrimSpace(raw)) > 0 {
			if err := json.Unmarshal(raw, &req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body: " + err.Error()})
				return
			}
		}

		refs, err := libraryRepo.ListNonGhostFiles(ctx)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// An unmounted media folder looks exactly like a library whose files are all gone; refuse
		// before touching anything.
		if len(refs) > 0 {
			if problem := mediaRootProblem(mediaRoot); problem != "" {
				recordEvent(c, sysevents.LevelWarning, sysevents.CategoryMaintenance,
					"Scan for missing files refused: the media folder looks unavailable",
					map[string]any{"scanned": len(refs), "reason": problem})
				c.JSON(http.StatusConflict, gin.H{"error": "The media folder " + problem + ". Is it mounted? Nothing was changed."})
				return
			}
		}

		// Decide everything first, then write: only a definite "does not exist" counts as missing.
		// Any other stat error (permissions, I/O error, stale network handle) says nothing about
		// the file, so that item is left alone and reported as unreadable.
		var toClear []repository.LibraryFileRef
		unreadable := 0
		for _, ref := range refs {
			abs := filepath.Join(mediaRoot, filepath.FromSlash(ref.Path))
			_, err := os.Stat(abs)
			switch {
			case err == nil:
			case errors.Is(err, fs.ErrNotExist):
				toClear = append(toClear, ref)
			default:
				log.Printf("scan missing files: item %d: cannot check %s: %v", ref.ID, ref.Path, err)
				unreadable++
			}
		}

		// Mass-clear guard: losing most of the library in one click is far more likely an offline
		// mount than a real mass deletion, and clearing is irreversible.
		if !req.Confirm && len(toClear) >= scanMissingConfirmMinItems && len(toClear)*2 >= len(refs) {
			recordEvent(c, sysevents.LevelWarning, sysevents.CategoryMaintenance,
				"Scan for missing files stopped by the safety guard",
				map[string]any{"scanned": len(refs), "wouldGhost": len(toClear), "unreadable": unreadable})
			c.JSON(http.StatusConflict, gin.H{
				"error":           fmt.Sprintf("This would convert %d of %d items to ghosts. Is the media folder mounted? Nothing was changed.", len(toClear), len(refs)),
				"requiresConfirm": true,
				"scanned":         len(refs),
				"wouldClear":      len(toClear),
			})
			return
		}

		missing := make([]MissingLibraryFileResponse, 0, len(toClear))
		for _, ref := range toClear {
			if err := libraryRepo.ClearFile(ctx, ref.ID, false); err != nil {
				log.Printf("scan missing files: clearing item %d failed: %v", ref.ID, err)
				continue
			}
			missing = append(missing, MissingLibraryFileResponse{ID: ref.ID, Title: ref.Title})
		}

		level, msg := sysevents.LevelInfo, "Scan for missing files finished"
		if unreadable > 0 {
			level, msg = sysevents.LevelWarning, "Scan for missing files finished, but some files could not be checked"
		}
		recordEvent(c, level, sysevents.CategoryMaintenance, msg,
			map[string]any{"scanned": len(refs), "ghosted": len(missing), "unreadable": unreadable})
		c.JSON(http.StatusOK, ScanMissingLibraryFilesResponse{Scanned: len(refs), Missing: missing, Unreadable: unreadable})
	}
}

// scanMissingConfirmMinItems is the smallest number of to-be-cleared items that can trip the
// ScanMissingLibraryFiles mass-clear guard (together with "at least half of those scanned").
const scanMissingConfirmMinItems = 10

// mediaRootProblem describes why mediaRoot cannot be trusted for a missing-file scan ("" if fine):
// it does not exist, is not a readable directory, or is completely empty.
func mediaRootProblem(mediaRoot string) string {
	info, err := os.Stat(mediaRoot)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return "does not exist"
		}
		return "cannot be read (" + err.Error() + ")"
	}
	if !info.IsDir() {
		return "is not a folder"
	}
	f, err := os.Open(mediaRoot)
	if err != nil {
		return "cannot be read (" + err.Error() + ")"
	}
	defer f.Close()
	if _, err := f.Readdirnames(1); err != nil {
		if errors.Is(err, io.EOF) {
			return "is empty"
		}
		return "cannot be read (" + err.Error() + ")"
	}
	return ""
}

// BulkDeleteLibraryItemFiles mirrors DeleteLibraryItemFile applied to a
// batch — one shared deleteThumbnail flag for the whole request, not per
// item, matching BulkDeleteLibraryItems' shape (library_handler.go). An id
// that's already gone or already has no file (already a ghost) is skipped
// rather than failing the batch — a bulk selection spanning both real and
// ghost items is an expected, not exceptional, case here.
func BulkDeleteLibraryItemFiles(db *sql.DB, repo *repository.LibraryRepo, downloadsRepo *repository.DownloadsRepo, originalsRepo *repository.ThumbnailEnhancementOriginalsRepo, locks *itemlock.Locks, mediaRoot, imagesRoot string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req BulkDeleteLibraryItemFilesRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		itemIDs, skippedDownloading, err := splitActiveItems(c.Request.Context(), downloadsRepo, req.ItemIDs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// All-or-nothing: if any item is busy, no file is touched.
		release, ok := locks.TryLockAll(itemIDs)
		if !ok {
			writeItemBusy(c)
			return
		}
		defer release()

		tx, err := db.BeginTx(c.Request.Context(), nil)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer tx.Rollback()
		txRepo := repo.WithTx(tx)

		resp := BulkDeleteLibraryItemFilesResponse{Skipped: skippedDownloading, SkippedDownloading: skippedDownloading}
		var cleared []*models.LibraryItem
		for _, id := range itemIDs {
			item, err := txRepo.Get(c.Request.Context(), id)
			if err != nil {
				if errors.Is(err, repository.ErrNotFound) {
					continue
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if item.Path == "" {
				continue
			}

			if err := txRepo.ClearFile(c.Request.Context(), id, req.DeleteThumbnail); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if isImageItem(item) && !req.DeleteThumbnail {
				if err := txRepo.ClearThumbnailPointer(c.Request.Context(), id); err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
			}
			cleared = append(cleared, item)
			resp.Deleted++
		}

		if err := tx.Commit(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// Files only go once the commit has succeeded.
		for _, item := range cleared {
			purgeLibraryItemFileArtifacts(c.Request.Context(), mediaRoot, imagesRoot, originalsRepo, item, req.DeleteThumbnail)
		}
		c.JSON(http.StatusOK, resp)
	}
}

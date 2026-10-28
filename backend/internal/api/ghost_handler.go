package api

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/imageproc"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
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

// fetchGhostThumbnail best-effort fetches and tiers a thumbnail for a
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
	tmpDir, err := os.MkdirTemp("", "ghost-thumb-*")
	if err != nil {
		log.Printf("ghost item %d: creating scratch dir for thumbnail fetch failed: %v", id, err)
		return false
	}
	defer os.RemoveAll(tmpDir)

	thumbAbs, err := ytdlp.FetchThumbnail(ctx, url, tmpDir, "thumb")
	if err != nil {
		log.Printf("ghost item %d: thumbnail fetch failed: %v", id, err)
		return false
	}

	tiers, err := imageproc.GenerateTiersFromPath(ctx, ytdlp.FFmpegPath, imagesRoot, "library", id, thumbAbs, libraryThumbnailTiers)
	if err != nil {
		log.Printf("ghost item %d: generating thumbnail derivatives failed: %v", id, err)
		return false
	}
	// Snapshot the tiers being replaced so they can be removed once the DB
	// points at the new ones (best-effort; a failed lookup just skips cleanup).
	var oldSmall, oldMedium *string
	if existing, err := libraryRepo.Get(ctx, id); err != nil {
		log.Printf("ghost item %d: loading previous thumbnail tiers failed: %v", id, err)
	} else {
		oldSmall, oldMedium = existing.ThumbnailSmallPath, existing.ThumbnailMediumPath
	}

	var width, height *int
	if w, h, err := imageproc.ProbeDimensions(thumbAbs); err != nil {
		log.Printf("ghost item %d: probing thumbnail dimensions failed: %v", id, err)
	} else {
		width, height = &w, &h
	}
	if err := libraryRepo.UpdateThumbnailTiers(ctx, id, &tiers[0], &tiers[1], width, height); err != nil {
		log.Printf("ghost item %d: saving thumbnail derivatives failed: %v", id, err)
		return false
	}
	removeThumbnailTiers(imagesRoot, oldSmall, oldMedium)
	return true
}

// BulkFetchLibraryThumbnails is the Library toolbar's bulk "Download
// thumbnail(s)" operation — reuses fetchGhostThumbnail per selected item
// (works the same whether the item has a file or not, since it only ever
// writes ImagesRoot-relative tiers). Items with no source URL are silently
// skipped, matching this app's other bulk operations.
func BulkFetchLibraryThumbnails(libraryRepo *repository.LibraryRepo, imagesRoot string, ytdlp *downloader.YtDlpService) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		var req BulkFetchLibraryThumbnailsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		var resp BulkFetchThumbnailsResponse
		for _, id := range req.ItemIDs {
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
func DeleteLibraryItemFile(libraryRepo *repository.LibraryRepo, originalsRepo *repository.ThumbnailEnhancementOriginalsRepo, mediaRoot, imagesRoot string) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

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
func ScanMissingLibraryFiles(mediaRoot string, libraryRepo *repository.LibraryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()

		refs, err := libraryRepo.ListNonGhostFiles(ctx)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		missing := make([]MissingLibraryFileResponse, 0)
		for _, ref := range refs {
			abs := filepath.Join(mediaRoot, filepath.FromSlash(ref.Path))
			if _, err := os.Stat(abs); err == nil {
				continue // file present — nothing to do
			}
			if err := libraryRepo.ClearFile(ctx, ref.ID, false); err != nil {
				log.Printf("scan missing files: clearing item %d failed: %v", ref.ID, err)
				continue
			}
			missing = append(missing, MissingLibraryFileResponse{ID: ref.ID, Title: ref.Title})
		}

		c.JSON(http.StatusOK, ScanMissingLibraryFilesResponse{Scanned: len(refs), Missing: missing})
	}
}

// BulkDeleteLibraryItemFiles mirrors DeleteLibraryItemFile applied to a
// batch — one shared deleteThumbnail flag for the whole request, not per
// item, matching BulkDeleteLibraryItems' shape (library_handler.go). An id
// that's already gone or already has no file (already a ghost) is skipped
// rather than failing the batch — a bulk selection spanning both real and
// ghost items is an expected, not exceptional, case here.
func BulkDeleteLibraryItemFiles(db *sql.DB, repo *repository.LibraryRepo, originalsRepo *repository.ThumbnailEnhancementOriginalsRepo, mediaRoot, imagesRoot string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req BulkDeleteLibraryItemFilesRequest
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
		var cleared []*models.LibraryItem
		for _, id := range req.ItemIDs {
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

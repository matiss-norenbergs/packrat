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
func CreateGhostLibraryItem(libraryRepo *repository.LibraryRepo, mediaRoot, imagesRoot string, ytdlp *downloader.YtDlpService, tagsRepo *repository.TagsRepo) gin.HandlerFunc {
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
		c.JSON(http.StatusCreated, toLibraryItemResponse(*created, false, req.Tags, mediaRoot))
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
	if err := libraryRepo.UpdateThumbnailTiers(ctx, id, &tiers[0], &tiers[1]); err != nil {
		log.Printf("ghost item %d: saving thumbnail derivatives failed: %v", id, err)
		return false
	}
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
func DeleteLibraryItemFile(libraryRepo *repository.LibraryRepo, mediaRoot string) gin.HandlerFunc {
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
		removeLibraryItemFile(mediaRoot, item, clearThumbnail)

		if err := libraryRepo.ClearFile(ctx, id, clearThumbnail); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// removeLibraryItemFile deletes item's media file (and, if clearThumbnail,
// its thumbnail) from disk — shared by the single-item and bulk delete-file
// handlers. Best-effort: failures are logged, not returned, matching
// deleteLibraryItemFiles' (library_handler.go) convention for the
// whole-item-delete case.
func removeLibraryItemFile(mediaRoot string, item *models.LibraryItem, clearThumbnail bool) {
	mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
	if err := os.Remove(mediaAbs); err != nil && !os.IsNotExist(err) {
		log.Printf("library: failed to delete media file %s: %v", mediaAbs, err)
	}
	if clearThumbnail && item.Thumbnail != nil {
		thumbAbs := filepath.Join(mediaRoot, filepath.FromSlash(*item.Thumbnail))
		if err := os.Remove(thumbAbs); err != nil && !os.IsNotExist(err) {
			log.Printf("library: failed to delete thumbnail %s: %v", thumbAbs, err)
		}
	}
}

// BulkDeleteLibraryItemFiles mirrors DeleteLibraryItemFile applied to a
// batch — one shared deleteThumbnail flag for the whole request, not per
// item, matching BulkDeleteLibraryItems' shape (library_handler.go). An id
// that's already gone or already has no file (already a ghost) is skipped
// rather than failing the batch — a bulk selection spanning both real and
// ghost items is an expected, not exceptional, case here.
func BulkDeleteLibraryItemFiles(db *sql.DB, repo *repository.LibraryRepo, mediaRoot string) gin.HandlerFunc {
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

			removeLibraryItemFile(mediaRoot, item, req.DeleteThumbnail)

			if err := txRepo.ClearFile(c.Request.Context(), id, req.DeleteThumbnail); err != nil {
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

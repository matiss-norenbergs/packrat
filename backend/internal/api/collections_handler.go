package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"path"
	"path/filepath"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/fsutil"
	"packrat/backend/internal/models"
	"packrat/backend/internal/pathsafe"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
)

func ListCollections(repo *repository.CollectionsRepo, libraryRepo *repository.LibraryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		rows, err := repo.List(c.Request.Context())
		if err != nil {
			writeServerError(c, err)
			return
		}
		itemCounts, err := repo.ItemCounts(c.Request.Context())
		if err != nil {
			writeServerError(c, err)
			return
		}
		ghostItemCounts, err := repo.GhostItemCounts(c.Request.Context())
		if err != nil {
			writeServerError(c, err)
			return
		}
		latestThumbnails, err := libraryRepo.LatestThumbnailsByCollection(c.Request.Context())
		if err != nil {
			writeServerError(c, err)
			return
		}
		ranges := make(map[int64]repository.SequenceRange, len(rows))
		for _, col := range rows {
			ranges[col.ID] = repository.SequenceRange{Min: col.SequenceMin, Max: col.SequenceMax}
		}
		sequenceGaps, err := libraryRepo.SequenceGapsByCollection(c.Request.Context(), ranges)
		if err != nil {
			writeServerError(c, err)
			return
		}
		paths := collectionPaths(rows)
		privacy := effectivePrivacyMap(rows)
		totals := totalItemCounts(rows, itemCounts)
		ghostTotals := totalItemCounts(rows, ghostItemCounts)
		rolledUpThumbnails := rollupLatestThumbnails(rows, latestThumbnails)
		out := make([]CollectionResponse, 0, len(rows))
		for _, col := range rows {
			var thumb *string
			if t, ok := rolledUpThumbnails[col.ID]; ok {
				thumb = &t
			}
			var seqGap *SequenceGapResponse
			if g, ok := sequenceGaps[col.ID]; ok {
				seqGap = &SequenceGapResponse{Min: g.Min, Max: g.Max, Count: g.Count, Missing: g.Missing}
			}
			out = append(out, toCollectionResponse(col, paths[col.ID], itemCounts[col.ID], privacy[col.ID], totals[col.ID], ghostItemCounts[col.ID], ghostTotals[col.ID], thumb, seqGap))
		}
		c.JSON(http.StatusOK, out)
	}
}

// prospectiveCollectionPath computes the full relative path a collection
// would occupy if its own segment is ownSegment and its parent is parentID
// (nil for a root collection) — used to path-safety-validate a segment
// before it's actually persisted.
func prospectiveCollectionPath(ctx context.Context, repo *repository.CollectionsRepo, parentID *int64, ownSegment string) (string, error) {
	if parentID == nil {
		return ownSegment, nil
	}
	parentPath, err := repo.ResolvePath(ctx, *parentID)
	if err != nil {
		return "", err
	}
	return path.Join(parentPath, ownSegment), nil
}

func CreateCollection(repo *repository.CollectionsRepo, mgr *queue.DownloadManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateCollectionRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := req.checkNumberLimits(); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if req.DefaultQuality == "" {
			req.DefaultQuality = "best"
		}
		if req.DefaultDownloadType == "" {
			req.DefaultDownloadType = "video"
		}
		if req.FilenameTemplate == "" {
			req.FilenameTemplate = "{title}"
		}
		req.RootPath = fsutil.SanitizeFilename(req.RootPath)
		if req.RootPath == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid root path"})
			return
		}

		prospectivePath, err := prospectiveCollectionPath(c.Request.Context(), repo, req.ParentID, req.RootPath)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "parent collection not found"})
				return
			}
			writeServerError(c, err)
			return
		}
		if _, err := pathsafe.ResolveUnderRoot(mgr.MediaRoot(), prospectivePath); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid root path: " + err.Error()})
			return
		}

		col := models.Collection{
			Name:                req.Name,
			ParentID:            req.ParentID,
			RootPath:            req.RootPath,
			DefaultQuality:      req.DefaultQuality,
			DefaultDownloadType: req.DefaultDownloadType,
			FilenameTemplate:    req.FilenameTemplate,
			IsPrivate:           req.IsPrivate,
			JellyfinLibrary:     req.JellyfinLibraryID,
			SeasonNumber:        req.SeasonNumber,
			Year:                req.Year,
			SequenceMin:         req.SequenceMin,
			SequenceMax:         req.SequenceMax,
			ArtistID:            req.ArtistID,
			BrowseAsShow:        req.BrowseAsShow,
		}
		id, err := repo.Create(c.Request.Context(), &col)
		if err != nil {
			if errors.Is(err, repository.ErrDuplicateName) || errors.Is(err, repository.ErrDuplicateRootPath) {
				c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
				return
			}
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "parent collection not found"})
				return
			}
			writeServerError(c, err)
			return
		}

		c.JSON(http.StatusCreated, gin.H{"id": id})
	}
}

// UpdateCollection merges the request onto the stored row: name and rootPath are
// required, every other field omitted from the body keeps its stored value (see
// UpdateCollectionRequest). Checks that span several fields run on the merged result.
func UpdateCollection(repo *repository.CollectionsRepo, mgr *queue.DownloadManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		var req UpdateCollectionRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := req.checkEnums(); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := req.checkNumberLimits(); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		rawRootPath := req.RootPath
		req.RootPath = fsutil.SanitizeFilename(req.RootPath)
		if req.RootPath == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid root path"})
			return
		}

		existing, err := repo.Get(c.Request.Context(), id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "collection not found"})
				return
			}
			writeServerError(c, err)
			return
		}

		// Re-submitting the stored root path is not a change: an existing name (for example a
		// reserved one such as CON, made before the rule existed) is kept, not renamed.
		req.RootPath = fsutil.SanitizeRename(rawRootPath, existing.RootPath)

		// Overlay the request onto the stored row. An explicit empty string for the three
		// text defaults still falls back to the default, as before.
		col := *existing
		col.Name = req.Name
		col.RootPath = req.RootPath
		if req.DefaultQuality != nil {
			col.DefaultQuality = orDefault(*req.DefaultQuality, "best")
		}
		if req.DefaultDownloadType != nil {
			col.DefaultDownloadType = orDefault(*req.DefaultDownloadType, "video")
		}
		if req.FilenameTemplate != nil {
			col.FilenameTemplate = orDefault(*req.FilenameTemplate, "{title}")
		}
		if req.IsPrivate != nil {
			col.IsPrivate = *req.IsPrivate
		}
		if req.BrowseAsShow != nil {
			col.BrowseAsShow = *req.BrowseAsShow
		}
		col.JellyfinLibrary = req.JellyfinLibraryID.Apply(existing.JellyfinLibrary)
		col.SeasonNumber = req.SeasonNumber.Apply(existing.SeasonNumber)
		col.Year = req.Year.Apply(existing.Year)
		col.SequenceMin = req.SequenceMin.Apply(existing.SequenceMin)
		col.SequenceMax = req.SequenceMax.Apply(existing.SequenceMax)
		col.ArtistID = req.ArtistID.Apply(existing.ArtistID)

		// The range is checked on the merged values, so sending only one end can't invert
		// it against the stored other end. Only when the request touches the range: an
		// already-inverted stored range must not block unrelated edits.
		if (req.SequenceMin.Set() || req.SequenceMax.Set()) &&
			col.SequenceMin != nil && col.SequenceMax != nil && *col.SequenceMin > *col.SequenceMax {
			c.JSON(http.StatusBadRequest, gin.H{"error": "sequenceMin must not be greater than sequenceMax"})
			return
		}

		// parent_id is creation-time only — renaming the segment must still be
		// re-validated against the *existing* parent so it can't escape the
		// media root.
		prospectivePath, err := prospectiveCollectionPath(c.Request.Context(), repo, existing.ParentID, req.RootPath)
		if err != nil {
			writeServerError(c, err)
			return
		}
		if _, err := pathsafe.ResolveUnderRoot(mgr.MediaRoot(), prospectivePath); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid root path: " + err.Error()})
			return
		}

		if err := repo.Update(c.Request.Context(), id, &col); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "collection not found"})
				return
			}
			if errors.Is(err, repository.ErrDuplicateName) || errors.Is(err, repository.ErrDuplicateRootPath) {
				c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
				return
			}
			writeServerError(c, err)
			return
		}

		c.Status(http.StatusNoContent)
	}
}

// checkEnums applies the same allowed values the create binding enforces, to the
// fields a PATCH actually sent. An empty string is accepted (it means "use the
// default"); the validator's oneof can't express that on a non-nil pointer.
func (r UpdateCollectionRequest) checkEnums() error {
	if q := r.DefaultQuality; q != nil && *q != "" && !slices.Contains(collectionQualities, *q) {
		return fmt.Errorf("defaultQuality must be one of: %s", strings.Join(collectionQualities, ", "))
	}
	if t := r.DefaultDownloadType; t != nil && *t != "" && !slices.Contains(collectionDownloadTypes, *t) {
		return fmt.Errorf("defaultDownloadType must be one of: %s", strings.Join(collectionDownloadTypes, ", "))
	}
	return nil
}

var (
	collectionQualities     = []string{"best", "2160p", "1440p", "1080p", "720p", "480p", "360p", "worst"}
	collectionDownloadTypes = []string{"video", "audio", "image"}
)

func orDefault(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

func DeleteCollection(repo *repository.CollectionsRepo, imagesRoot string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		if err := repo.Delete(c.Request.Context(), id); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "collection not found"})
				return
			}
			if errors.Is(err, repository.ErrHasChildren) {
				c.JSON(http.StatusConflict, gin.H{"error": "collection has sub-collections — move or delete them first"})
				return
			}
			writeServerError(c, err)
			return
		}
		removeDirBestEffort(filepath.Join(imagesRoot, "collections", strconv.FormatInt(id, 10)))
		c.Status(http.StatusNoContent)
	}
}

// sortDeepestFirst orders ids by their depth in the collection tree,
// deepest first — so that within one bulk-delete batch, a selected child is
// always deleted before its selected parent is attempted. Without this, a
// parent+child selection order that happens to list the parent first would
// spuriously fail with ErrHasChildren even though the child is also about
// to be deleted.
func sortDeepestFirst(ids []int64, all []models.Collection) []int64 {
	byID := make(map[int64]models.Collection, len(all))
	for _, c := range all {
		byID[c.ID] = c
	}

	depth := make(map[int64]int, len(all))
	var depthOf func(id int64) int
	depthOf = func(id int64) int {
		if d, ok := depth[id]; ok {
			return d
		}
		col, ok := byID[id]
		if !ok || col.ParentID == nil {
			depth[id] = 0
			return 0
		}
		d := depthOf(*col.ParentID) + 1
		depth[id] = d
		return d
	}

	sorted := append([]int64(nil), ids...)
	sort.Slice(sorted, func(i, j int) bool { return depthOf(sorted[i]) > depthOf(sorted[j]) })
	return sorted
}

// BulkDeleteCollections deletes every listed collection, deepest-first (see
// sortDeepestFirst) so a selected parent+child pair deletes cleanly
// regardless of selection order. A collection that still has a child left
// over — one that wasn't part of this batch — is skipped and reported
// rather than treated as a hard failure, since that's an expected outcome
// of a partial-subtree selection, not an error.
// The deletes run inside one transaction, so a genuine mid-batch failure
// rolls back every row already deleted instead of leaving a partial batch —
// skips (ErrNotFound/ErrHasChildren) don't delete anything, so they have
// nothing to roll back.
func BulkDeleteCollections(db *sql.DB, repo *repository.CollectionsRepo, imagesRoot string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req BulkDeleteRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		tx, err := db.BeginTx(c.Request.Context(), nil)
		if err != nil {
			writeServerError(c, err)
			return
		}
		defer tx.Rollback()
		txRepo := repo.WithTx(tx)

		all, err := txRepo.List(c.Request.Context())
		if err != nil {
			writeServerError(c, err)
			return
		}

		var deletedIDs []int64
		var resp BulkDeleteResponse
		for _, id := range sortDeepestFirst(req.IDs, all) {
			if err := txRepo.Delete(c.Request.Context(), id); err != nil {
				if errors.Is(err, repository.ErrNotFound) {
					continue
				}
				if errors.Is(err, repository.ErrHasChildren) {
					resp.Skipped = append(resp.Skipped, id)
					continue
				}
				writeServerError(c, err)
				return
			}
			deletedIDs = append(deletedIDs, id)
			resp.Deleted++
		}

		if err := tx.Commit(); err != nil {
			writeServerError(c, err)
			return
		}
		for _, id := range deletedIDs {
			removeDirBestEffort(filepath.Join(imagesRoot, "collections", strconv.FormatInt(id, 10)))
		}
		c.JSON(http.StatusOK, resp)
	}
}

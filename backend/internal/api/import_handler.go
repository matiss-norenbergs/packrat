package api

import (
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/importer"
	"packrat/backend/internal/models"
	"packrat/backend/internal/pathsafe"
	"packrat/backend/internal/repository"
)

// sidecarImageExts are checked, in order, for a same-basename thumbnail
// already sitting next to a media file — .jpg first since that's the
// convention real downloads already use (see downloader.BuildArgs'
// --convert-thumbnails jpg), so imports look the same either way.
var sidecarImageExts = []string{".jpg", ".jpeg", ".png", ".webp"}

// ScanImport lists media files under mediaRoot not yet tracked in the
// library table, along with best-effort probed metadata and the collection
// path they'd be imported into. Purely read-only — nothing is created until
// a file is actually imported, so re-running a scan is always safe.
func ScanImport(mediaRoot string, libraryRepo *repository.LibraryRepo, collectionsRepo *repository.CollectionsRepo, settingsRepo *repository.SettingsRepo, ffprobePath string) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()

		known, err := libraryRepo.ListPaths(ctx)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		files, err := importer.Scan(mediaRoot, known)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		ignoredFolders, err := ImportIgnoredFolders(ctx, settingsRepo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		files = importer.FilterIgnored(files, ignoredFolders)

		cols, err := collectionsRepo.List(ctx)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		out := make([]ScannedFileResponse, 0, len(files))
		for _, f := range files {
			collectionPath, newCollectionPath := resolveCollectionPathStatus(cols, f.FolderSegments)

			probe := importer.Probe(ctx, ffprobePath, filepath.Join(mediaRoot, filepath.FromSlash(f.RelPath)))

			out = append(out, ScannedFileResponse{
				Path:              f.RelPath,
				Filename:          f.Filename,
				SizeBytes:         f.SizeBytes,
				DurationSeconds:   probe.DurationSeconds,
				Resolution:        probe.Resolution,
				CollectionPath:    collectionPath,
				NewCollectionPath: newCollectionPath,
			})
		}

		c.JSON(http.StatusOK, out)
	}
}

// resolveCollectionPathStatus walks segments (a scanned file's folder chain)
// against an already-fetched collections list, returning the full path the
// file would live at and the suffix of that path (if any) that doesn't
// already exist as a collection.
func resolveCollectionPathStatus(cols []models.Collection, segments []string) (collectionPath string, newCollectionPath string) {
	if len(segments) == 0 {
		return "", ""
	}

	var parentID *int64
	newFrom := -1
	for i, seg := range segments {
		child := repository.FindChildByRootPath(cols, parentID, seg)
		if child == nil {
			newFrom = i
			break
		}
		id := child.ID
		parentID = &id
	}

	full := strings.Join(segments, "/")
	if newFrom == -1 {
		return full, ""
	}
	return full, strings.Join(segments[newFrom:], "/")
}

// CreateImport imports a single previously-scanned file: creates any
// missing collections matching its on-disk folder chain, probes the file
// for duration/resolution, resolves a thumbnail (a same-basename sidecar
// image if one exists, else — only if originalUrl was given — a best-effort
// yt-dlp thumbnail-only fetch), and creates the library row. Never triggers
// a real download or a full metadata refresh.
func CreateImport(mediaRoot string, libraryRepo *repository.LibraryRepo, collectionsRepo *repository.CollectionsRepo, ytdlp *downloader.YtDlpService, ffprobePath string) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()

		var req ImportRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		absPath, err := pathsafe.ResolveUnderRoot(mediaRoot, req.Path)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid path: " + err.Error()})
			return
		}
		info, err := os.Stat(absPath)
		if err != nil || info.IsDir() {
			c.JSON(http.StatusBadRequest, gin.H{"error": "file not found"})
			return
		}

		relPath := path.Clean(filepath.ToSlash(req.Path))
		known, err := libraryRepo.ListPaths(ctx)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if known[relPath] {
			c.JSON(http.StatusConflict, gin.H{"error": "file already imported"})
			return
		}

		var segments []string
		if dir := path.Dir(relPath); dir != "." {
			segments = strings.Split(dir, "/")
		}

		// EnsureChain serializes against concurrent imports (e.g. "Import
		// Selected"/"Import All" firing several requests at once) so two
		// files landing under the same not-yet-existing folder can't each
		// create their own duplicate collection — see its doc comment.
		parentID, err := collectionsRepo.EnsureChain(ctx, segments)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		probe := importer.Probe(ctx, ffprobePath, absPath)
		sizeBytes := info.Size()

		thumbRelPtr := findSidecarThumbnail(mediaRoot, absPath)
		if thumbRelPtr == nil && req.OriginalURL != nil {
			dir := filepath.Dir(absPath)
			base := strings.TrimSuffix(filepath.Base(absPath), filepath.Ext(absPath))
			if thumbPath, err := ytdlp.FetchThumbnail(ctx, *req.OriginalURL, dir, base); err != nil {
				log.Printf("import: thumbnail fetch failed for %s: %v", relPath, err)
			} else {
				rel := toRelSlash(mediaRoot, thumbPath)
				thumbRelPtr = &rel
			}
		}

		title := strings.TrimSuffix(filepath.Base(absPath), filepath.Ext(absPath))
		item := models.LibraryItem{
			Title:         title,
			Filename:      filepath.Base(absPath),
			Path:          relPath,
			CollectionID:  parentID,
			Folder:        "",
			OriginalURL:   req.OriginalURL,
			Duration:      probe.DurationSeconds,
			Resolution:    probe.Resolution,
			Thumbnail:     thumbRelPtr,
			FileSizeBytes: &sizeBytes,
			Status:        "completed",
		}
		id, err := libraryRepo.Create(ctx, &item)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		created, err := libraryRepo.Get(ctx, id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		var blurred bool
		if created.CollectionID != nil {
			blurred, err = collectionsRepo.IsPrivate(ctx, *created.CollectionID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		c.JSON(http.StatusCreated, toLibraryItemResponse(*created, blurred))
	}
}

// findSidecarThumbnail looks for a same-basename image file next to absPath
// (e.g. video.mp4 + video.jpg) and returns its media-root-relative path if
// found.
func findSidecarThumbnail(mediaRoot, absPath string) *string {
	base := strings.TrimSuffix(absPath, filepath.Ext(absPath))
	for _, ext := range sidecarImageExts {
		candidate := base + ext
		if _, err := os.Stat(candidate); err == nil {
			rel := toRelSlash(mediaRoot, candidate)
			return &rel
		}
	}
	return nil
}

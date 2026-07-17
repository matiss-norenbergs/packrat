package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/backup"
	"packrat/backend/internal/models"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
)

func passwordFrom(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// ExportSettings dumps every settings row into a downloadable (optionally
// password-encrypted) file. The response is plain JSON — the frontend turns
// it into a browser download itself, there's no special Content-Disposition
// handling needed server-side.
func ExportSettings(settingsRepo *repository.SettingsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req BackupExportRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		bundle, err := backup.BuildSettingsBundle(c.Request.Context(), settingsRepo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		plaintext, err := json.Marshal(bundle)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		env, err := backup.Seal("settings", plaintext, passwordFrom(req.Password))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, env)
	}
}

// ExportLibrary dumps collections/tags/artists/URL-having library items into
// a downloadable (optionally encrypted) file — see backup.BuildLibraryBundle
// for exactly what's included and why.
func ExportLibrary(collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo, artistsRepo *repository.ArtistsRepo, libraryRepo *repository.LibraryRepo, downloadsRepo *repository.DownloadsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req BackupExportRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		bundle, err := backup.BuildLibraryBundle(c.Request.Context(), collectionsRepo, tagsRepo, artistsRepo, libraryRepo, downloadsRepo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		plaintext, err := json.Marshal(bundle)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		env, err := backup.Seal("library", plaintext, passwordFrom(req.Password))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, env)
	}
}

// writeBackupOpenError maps the shared parse/decrypt failure modes from a
// previously-exported file to sensible HTTP statuses — a wrong password or
// corrupt file is a client mistake (400), not a server error.
func writeBackupOpenError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, backup.ErrNotPackratExport), errors.Is(err, backup.ErrWrongKind), errors.Is(err, backup.ErrIncorrectPassword):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

func ImportSettings(settingsRepo *repository.SettingsRepo, mgr *queue.DownloadManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req BackupImportRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		env, err := backup.ParseEnvelope(req.Data)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		plaintext, err := backup.Open(env, "settings", passwordFrom(req.Password))
		if err != nil {
			writeBackupOpenError(c, err)
			return
		}

		var bundle map[string]string
		if err := json.Unmarshal(plaintext, &bundle); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "corrupt settings export: " + err.Error()})
			return
		}

		applied, err := backup.ApplySettingsBundle(c.Request.Context(), settingsRepo, bundle)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// GetSettings reports maxConcurrentDownloads from the live worker
		// pool, not the settings row, so writing the row alone (above) isn't
		// enough to actually change it — same as UpdateSettings has to do.
		if raw, ok := bundle[models.SettingMaxConcurrentDownloads]; ok {
			if n, err := strconv.Atoi(raw); err == nil && n > 0 {
				mgr.SetWorkerCount(n)
			}
		}
		c.JSON(http.StatusOK, BackupImportSettingsResponse{Applied: applied})
	}
}

// ImportLibrary merges a previously-exported library bundle into the local
// database (see backup.ApplyLibraryBundle) and re-queues a download for
// every resolved item — the same enqueueDownload helper CreateDownload and
// RedownloadLibraryItem use, applying the same default-download-type
// fallback RetryHistoryItem/RedownloadLibraryItem already use when the
// export didn't carry a type (its originating Download row was gone).
// Each item is enqueued independently and best-effort — one bad URL/folder
// doesn't abort the rest of the import.
func ImportLibrary(collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo, artistsRepo *repository.ArtistsRepo, mgr *queue.DownloadManager, settingsRepo *repository.SettingsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req BackupImportRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		env, err := backup.ParseEnvelope(req.Data)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		plaintext, err := backup.Open(env, "library", passwordFrom(req.Password))
		if err != nil {
			writeBackupOpenError(c, err)
			return
		}

		var bundle backup.LibraryBundle
		if err := json.Unmarshal(plaintext, &bundle); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "corrupt library export: " + err.Error()})
			return
		}

		resolved, result, err := backup.ApplyLibraryBundle(c.Request.Context(), collectionsRepo, tagsRepo, artistsRepo, bundle)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		defaultType := "video"
		if def, err := settingsRepo.Get(c.Request.Context(), models.SettingDefaultDownloadType); err == nil && def != "" {
			defaultType = def
		}

		resp := BackupImportLibraryResponse{
			CollectionsEnsured: result.CollectionsEnsured,
			TagsCreated:        result.TagsCreated,
			ArtistsCreated:     result.ArtistsCreated,
		}
		for _, r := range resolved {
			downloadType := r.DownloadType
			if downloadType == "" {
				downloadType = defaultType
			}
			req := CreateDownloadRequest{
				URL:            r.URL,
				CollectionID:   r.CollectionID,
				Folder:         r.Folder,
				Filename:       r.Filename,
				DownloadType:   downloadType,
				Quality:        r.Quality,
				AudioFormat:    r.AudioFormat,
				ArtistID:       r.ArtistID,
				Year:           r.Year,
				SeasonNumber:   r.SeasonNumber,
				SequenceNumber: r.SequenceNumber,
				Tags:           r.Tags,
			}
			if _, err := enqueueDownload(c.Request.Context(), mgr, collectionsRepo, settingsRepo, req); err == nil {
				resp.DownloadsQueued++
			}
		}
		c.JSON(http.StatusOK, resp)
	}
}

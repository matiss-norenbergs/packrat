package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/backup"
	"packrat/backend/internal/downloader"
	"packrat/backend/internal/models"
	"packrat/backend/internal/pathsafe"
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

// ExportLibrary dumps collections/tags/artists/every library item into a
// downloadable (optionally encrypted) file — see backup.BuildLibraryBundle
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

func ImportSettings(settingsRepo *repository.SettingsRepo, mgr *queue.DownloadManager, ytdlp *downloader.YtDlpService) gin.HandlerFunc {
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
		// Accepts a plain settings export or the settings half of a full
		// backup — a full file's library half is simply ignored here.
		plaintext, kind, err := backup.OpenAny(env, []string{"settings", "full"}, passwordFrom(req.Password))
		if err != nil {
			writeBackupOpenError(c, err)
			return
		}

		var bundle map[string]string
		if kind == "full" {
			var full backup.FullBundle
			if err := json.Unmarshal(plaintext, &full); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "corrupt backup file: " + err.Error()})
				return
			}
			bundle = full.Settings
		} else if err := json.Unmarshal(plaintext, &bundle); err != nil {
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
		if raw, ok := bundle[models.SettingMaxConcurrentTranscodes]; ok {
			if n, err := strconv.Atoi(raw); err == nil && n > 0 {
				ytdlp.SetMaxConcurrentTranscodes(n)
			}
		}
		c.JSON(http.StatusOK, BackupImportSettingsResponse{Applied: applied})
	}
}

// decodeLibraryBundle binds a BackupImportRequest from the request body,
// then parses/decrypts/unmarshals it into a LibraryBundle — the shared first
// steps of ImportLibrary and PreviewLibraryImport. Accepts either a plain
// library export or the library half of a full backup (its settings half is
// simply ignored here). On any failure it writes the appropriate error
// response itself and returns ok=false, so callers can just check ok and
// return. mode is the request's raw Mode field ("" or "download" means
// download, "ghostOnly" skips every redownload).
func decodeLibraryBundle(c *gin.Context) (bundle backup.LibraryBundle, mode string, ok bool) {
	var req BackupImportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return bundle, "", false
	}

	env, err := backup.ParseEnvelope(req.Data)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return bundle, "", false
	}
	plaintext, kind, err := backup.OpenAny(env, []string{"library", "full"}, passwordFrom(req.Password))
	if err != nil {
		writeBackupOpenError(c, err)
		return bundle, "", false
	}

	if kind == "full" {
		var full backup.FullBundle
		if err := json.Unmarshal(plaintext, &full); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "corrupt backup file: " + err.Error()})
			return bundle, "", false
		}
		bundle = full.Library
	} else if err := json.Unmarshal(plaintext, &bundle); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "corrupt library export: " + err.Error()})
		return bundle, "", false
	}
	return bundle, req.Mode, true
}

// PreviewLibraryImport decrypts/parses a library export the same way
// ImportLibrary does, but only reads (List/FindDuplicates) — never writes —
// so the Backup page can show what an import would do before the user
// commits to it. See backup.PreviewLibraryBundle for the diffing logic.
func PreviewLibraryImport(collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo, artistsRepo *repository.ArtistsRepo, libraryRepo *repository.LibraryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		bundle, _, ok := decodeLibraryBundle(c)
		if !ok {
			return
		}

		preview, err := backup.PreviewLibraryBundle(c.Request.Context(), collectionsRepo, tagsRepo, artistsRepo, libraryRepo, bundle)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, preview)
	}
}

// applyLibraryBundleAndEnqueue runs backup.ApplyLibraryBundle and then
// queues a redownload for every resolved (non-ghost) item it returns — the
// shared second half of ImportLibrary and RestoreFullBackup. Ghost
// (placeholder, no-file) entries are recreated directly as ghosts, nothing
// queued for them; every other resolved item gets a redownload queued —
// the same enqueueDownload helper CreateDownload and RedownloadLibraryItem
// use, applying the same default-download-type fallback
// RetryHistoryItem/RedownloadLibraryItem already use when the export didn't
// carry a type (its originating Download row was gone). Each item is
// enqueued independently and best-effort — one bad URL/folder doesn't abort
// the rest of the import.
func applyLibraryBundleAndEnqueue(
	ctx context.Context,
	db *sql.DB,
	collectionsRepo *repository.CollectionsRepo,
	tagsRepo *repository.TagsRepo,
	artistsRepo *repository.ArtistsRepo,
	libraryRepo *repository.LibraryRepo,
	mgr *queue.DownloadManager,
	settingsRepo *repository.SettingsRepo,
	bundle backup.LibraryBundle,
	ghostOnly bool,
) (BackupImportLibraryResponse, error) {
	resolved, result, err := backup.ApplyLibraryBundle(ctx, db, collectionsRepo, tagsRepo, artistsRepo, libraryRepo, bundle, ghostOnly)
	if err != nil {
		return BackupImportLibraryResponse{}, err
	}

	defaultType := "video"
	if def, err := settingsRepo.Get(ctx, models.SettingDefaultDownloadType); err == nil && def != "" {
		defaultType = def
	}

	resp := BackupImportLibraryResponse{
		CollectionsEnsured: result.CollectionsEnsured,
		TagsCreated:        result.TagsCreated,
		ArtistsCreated:     result.ArtistsCreated,
		GhostsCreated:      result.GhostsCreated,
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
		if _, err := enqueueDownload(ctx, mgr, collectionsRepo, settingsRepo, req); err == nil {
			resp.DownloadsQueued++
		}
	}
	return resp, nil
}

// ImportLibrary merges a previously-exported library bundle into the local
// database — see applyLibraryBundleAndEnqueue for what happens to each
// entry.
func ImportLibrary(db *sql.DB, collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo, artistsRepo *repository.ArtistsRepo, libraryRepo *repository.LibraryRepo, mgr *queue.DownloadManager, settingsRepo *repository.SettingsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		bundle, mode, ok := decodeLibraryBundle(c)
		if !ok {
			return
		}

		resp, err := applyLibraryBundleAndEnqueue(c.Request.Context(), db, collectionsRepo, tagsRepo, artistsRepo, libraryRepo, mgr, settingsRepo, bundle, mode == "ghostOnly")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, resp)
	}
}

// ListBackupHistory returns every recorded auto/manual backup attempt, most
// recent first — including failed ones, so the table doubles as a health
// check.
func ListBackupHistory(repo *repository.BackupHistoryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		entries, err := repo.List(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		resp := make([]BackupHistoryResponse, 0, len(entries))
		for _, e := range entries {
			resp = append(resp, toBackupHistoryResponse(e))
		}
		c.JSON(http.StatusOK, resp)
	}
}

// RunManualBackup runs backup.RunBackup synchronously and returns the
// resulting history row. A non-nil error here means the row itself couldn't
// be persisted (see RunBackup) — a failed backup attempt still comes back as
// 201 with Status: "failed", the same way a failed download still gets a
// History row rather than the API call itself erroring.
func RunManualBackup(deps backup.RunDeps) gin.HandlerFunc {
	return func(c *gin.Context) {
		entry, err := backup.RunBackup(c.Request.Context(), deps, "manual")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, toBackupHistoryResponse(entry))
	}
}

// resolveBackupFile looks up a backup_history row and resolves its on-disk
// path, handling the shared not-found cases for DownloadBackupFile and
// PreviewBackupFile: missing row, a row with no file (failed backup), or a
// file the row references but that's no longer on disk.
func resolveBackupFile(c *gin.Context, backupsRoot string, repo *repository.BackupHistoryRepo, id int64) (entry *models.BackupHistory, fullPath string, ok bool) {
	entry, err := repo.Get(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "backup not found"})
			return nil, "", false
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return nil, "", false
	}
	if entry.FileName == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "this backup has no file"})
		return nil, "", false
	}
	fullPath, err = pathsafe.ResolveUnderRoot(backupsRoot, *entry.FileName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return nil, "", false
	}
	if _, err := os.Stat(fullPath); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "backup file is missing on disk"})
		return nil, "", false
	}
	return entry, fullPath, true
}

// DownloadBackupFile streams an already-written backup file to the browser.
// This is a deliberate, narrow exception to the rest of this file's "no
// server-side Content-Disposition" convention (see ExportSettings) — that
// convention is scoped to the ad-hoc, in-memory export flow; this is a
// genuinely different case, a real file already sitting on disk, so Gin's
// FileAttachment (which sets Content-Disposition: attachment) is the
// simpler, more standard choice. A plain <a href> GET navigation carries the
// session cookie same as any authenticated page load, and RequireCSRF
// no-ops on GET, so no special frontend handling is needed either.
func DownloadBackupFile(backupsRoot string, repo *repository.BackupHistoryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		entry, fullPath, ok := resolveBackupFile(c, backupsRoot, repo, id)
		if !ok {
			return
		}
		c.FileAttachment(fullPath, *entry.FileName)
	}
}

// DeleteBackupHistoryEntry removes a backup_history row and best-effort
// unlinks its file — not explicitly requested, but a natural complement to a
// management table, matching every other list-with-delete page in the app.
func DeleteBackupHistoryEntry(backupsRoot string, repo *repository.BackupHistoryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		ctx := c.Request.Context()
		entry, err := repo.Get(ctx, id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "backup not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := repo.Delete(ctx, id); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if entry.FileName != nil {
			if path, err := pathsafe.ResolveUnderRoot(backupsRoot, *entry.FileName); err == nil {
				if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
					log.Printf("deleting backup file %q failed: %v", path, err)
				}
			}
		}
		c.Status(http.StatusNoContent)
	}
}

// PreviewBackupFile reads a backup file back off disk and returns a
// human-readable summary of its contents — counts plus collection/tag/
// artist/item lists — without requiring a download. Auto-backups are always
// unencrypted (see backup.RunBackup), so no password is needed to open one.
func PreviewBackupFile(backupsRoot string, repo *repository.BackupHistoryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		_, fullPath, ok := resolveBackupFile(c, backupsRoot, repo, id)
		if !ok {
			return
		}

		raw, err := os.ReadFile(fullPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		env, err := backup.ParseEnvelope(string(raw))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		plaintext, err := backup.Open(env, "full", "")
		if err != nil {
			writeBackupOpenError(c, err)
			return
		}
		var bundle backup.FullBundle
		if err := json.Unmarshal(plaintext, &bundle); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "corrupt backup file: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, toBackupContentPreviewResponse(bundle))
	}
}

// RestoreFullBackup applies a full backup already sitting in backup history
// back into the local database — both the settings half (backup.ApplySettingsBundle)
// and the library half (backup.ApplyLibraryBundle), in one action. This is
// the only way to actually restore what "Run Backup Now"/the scheduler
// produces: PreviewBackupFile can already read a "full" envelope, but
// ImportSettings/ImportLibrary only ever accept their own single-purpose
// "settings"/"library" kind, so a full backup previously had no restore path
// at all.
func RestoreFullBackup(
	backupsRoot string,
	repo *repository.BackupHistoryRepo,
	db *sql.DB,
	settingsRepo *repository.SettingsRepo,
	collectionsRepo *repository.CollectionsRepo,
	tagsRepo *repository.TagsRepo,
	artistsRepo *repository.ArtistsRepo,
	libraryRepo *repository.LibraryRepo,
	mgr *queue.DownloadManager,
) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		var req RestoreBackupRequest
		if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		_, fullPath, ok := resolveBackupFile(c, backupsRoot, repo, id)
		if !ok {
			return
		}

		raw, err := os.ReadFile(fullPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		env, err := backup.ParseEnvelope(string(raw))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		plaintext, err := backup.Open(env, "full", "")
		if err != nil {
			writeBackupOpenError(c, err)
			return
		}
		var bundle backup.FullBundle
		if err := json.Unmarshal(plaintext, &bundle); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "corrupt backup file: " + err.Error()})
			return
		}

		resp, err := applyFullBundle(c.Request.Context(), db, settingsRepo, collectionsRepo, tagsRepo, artistsRepo, libraryRepo, mgr, bundle, req.Mode == "ghostOnly")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, resp)
	}
}

// applyFullBundle applies both halves of a full backup bundle — settings
// (backup.ApplySettingsBundle) then library (applyLibraryBundleAndEnqueue) —
// shared by RestoreFullBackup (bundle read off a backup_history file) and
// ImportFullBackup (bundle decoded from an ad-hoc uploaded file); the only
// difference between those two callers is where bundle came from.
func applyFullBundle(
	ctx context.Context,
	db *sql.DB,
	settingsRepo *repository.SettingsRepo,
	collectionsRepo *repository.CollectionsRepo,
	tagsRepo *repository.TagsRepo,
	artistsRepo *repository.ArtistsRepo,
	libraryRepo *repository.LibraryRepo,
	mgr *queue.DownloadManager,
	bundle backup.FullBundle,
	ghostOnly bool,
) (BackupRestoreFullResponse, error) {
	settingsApplied, err := backup.ApplySettingsBundle(ctx, settingsRepo, bundle.Settings)
	if err != nil {
		return BackupRestoreFullResponse{}, err
	}
	libResp, err := applyLibraryBundleAndEnqueue(ctx, db, collectionsRepo, tagsRepo, artistsRepo, libraryRepo, mgr, settingsRepo, bundle.Library, ghostOnly)
	if err != nil {
		return BackupRestoreFullResponse{}, err
	}
	return BackupRestoreFullResponse{SettingsApplied: settingsApplied, Library: libResp}, nil
}

// ImportFullBackup applies an ad-hoc uploaded full backup file — same as
// RestoreFullBackup, but for a file the user picked (downloaded from another
// install's backup history, received from someone else, or a history file
// re-applied after its row was deleted) rather than one already sitting in
// this install's backup_history.
func ImportFullBackup(
	db *sql.DB,
	settingsRepo *repository.SettingsRepo,
	collectionsRepo *repository.CollectionsRepo,
	tagsRepo *repository.TagsRepo,
	artistsRepo *repository.ArtistsRepo,
	libraryRepo *repository.LibraryRepo,
	mgr *queue.DownloadManager,
) gin.HandlerFunc {
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
		plaintext, err := backup.Open(env, "full", passwordFrom(req.Password))
		if err != nil {
			writeBackupOpenError(c, err)
			return
		}
		var bundle backup.FullBundle
		if err := json.Unmarshal(plaintext, &bundle); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "corrupt backup file: " + err.Error()})
			return
		}

		resp, err := applyFullBundle(c.Request.Context(), db, settingsRepo, collectionsRepo, tagsRepo, artistsRepo, libraryRepo, mgr, bundle, req.Mode == "ghostOnly")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, resp)
	}
}

// PreviewFullImport decrypts/parses an ad-hoc uploaded full backup file the
// same way ImportFullBackup does, but only reads (via
// backup.PreviewLibraryBundle) — never writes — so the Full Backup card can
// show what an import would do before committing to it. Settings have
// nothing to diff (an import always overwrites every key), so they're
// reported as a plain count.
func PreviewFullImport(collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo, artistsRepo *repository.ArtistsRepo, libraryRepo *repository.LibraryRepo) gin.HandlerFunc {
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
		plaintext, err := backup.Open(env, "full", passwordFrom(req.Password))
		if err != nil {
			writeBackupOpenError(c, err)
			return
		}
		var bundle backup.FullBundle
		if err := json.Unmarshal(plaintext, &bundle); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "corrupt backup file: " + err.Error()})
			return
		}

		libPreview, err := backup.PreviewLibraryBundle(c.Request.Context(), collectionsRepo, tagsRepo, artistsRepo, libraryRepo, bundle.Library)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, FullImportPreviewResponse{
			SettingsCount: len(bundle.Settings),
			Library:       libPreview,
		})
	}
}

func toBackupContentPreviewResponse(bundle backup.FullBundle) BackupContentPreviewResponse {
	collections := make([]BackupPreviewCollection, 0, len(bundle.Library.Collections))
	for _, col := range bundle.Library.Collections {
		collections = append(collections, BackupPreviewCollection{Path: col.Path, Name: col.Name})
	}
	tags := make([]string, 0, len(bundle.Library.Tags))
	for _, t := range bundle.Library.Tags {
		tags = append(tags, t.Name)
	}
	items := make([]BackupPreviewItem, 0, len(bundle.Library.LibraryItems))
	for _, it := range bundle.Library.LibraryItems {
		items = append(items, BackupPreviewItem{
			Title:          it.Title,
			OriginalURL:    it.OriginalURL,
			CollectionPath: it.CollectionPath,
			ArtistName:     it.ArtistName,
			Tags:           it.Tags,
			IsGhost:        it.Status == "ghost" || it.OriginalURL == "",
		})
	}
	return BackupContentPreviewResponse{
		SettingsCount: len(bundle.Settings),
		Collections:   collections,
		Tags:          tags,
		Artists:       bundle.Library.Artists,
		Items:         items,
	}
}

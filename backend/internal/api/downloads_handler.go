package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/fsutil"
	"packrat/backend/internal/imagefetch"
	"packrat/backend/internal/models"
	"packrat/backend/internal/pathsafe"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
)

func CreateDownload(mgr *queue.DownloadManager, collectionsRepo *repository.CollectionsRepo, settingsRepo *repository.SettingsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateDownloadRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		id, err := enqueueDownload(c.Request.Context(), mgr, collectionsRepo, settingsRepo, req)
		if err != nil {
			writeEnqueueError(c, err)
			return
		}

		c.JSON(http.StatusCreated, gin.H{"id": id})
	}
}

// PreviewDownloadMetadata fetches yt-dlp metadata for a URL without queuing anything, for the
// New Download dialog's pre-submit preview card. A fetch failure (bad URL, unsupported site,
// network error) is reported as 422 — the frontend treats this as non-fatal and never blocks
// submission on it. For a non-playlist URL, also looks up whether it's already in the library
// (by original URL or video ID) so the dialog can offer Skip/Replace/Download Anyway.
func PreviewDownloadMetadata(ytdlp *downloader.YtDlpService, libraryRepo *repository.LibraryRepo, responder *ItemResponder) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req PreviewDownloadRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if !isHTTPURL(req.URL) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "url must be an http or https URL"})
			return
		}

		meta, err := ytdlp.FetchMetadata(c.Request.Context(), req.URL)
		if err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}

		var dup *DuplicateInfo
		if !meta.IsPlaylist() {
			item, err := libraryRepo.FindDuplicate(c.Request.Context(), req.URL, meta.ID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if item != nil {
				if dup, err = responder.duplicateInfo(c.Request.Context(), item); err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
			}
		}

		c.JSON(http.StatusOK, toPreviewDownloadResponse(meta, dup))
	}
}

// PreviewImage proxies a single image through the backend for the New
// Download dialog's live preview — both the direct-image-URL preview (Type
// = Image) and the yt-dlp-reported thumbnail preview (Type = Video/Audio)
// use this instead of pointing an <img> straight at the target/thumbnail
// URL. That matters specifically because of the configured proxy: an <img
// src> fetch happens in the user's own browser and has no way to honor the
// backend's ytdlp_proxy setting, silently leaking the request to the local
// network even when a proxy/VPN is configured for exactly this purpose.
// Routing through the backend (which does honor it, via imagefetch.Open)
// closes that gap. GET-only and read-only, so no CSRF token is required —
// same convention as /media-files/*path.
//
// The optional `kind` query parameter says who chose the URL: "image"
// (default) is the direct image URL the admin typed — size cap only, LAN hosts
// allowed — while "thumbnail" is the thumbnail yt-dlp reported from the page's
// metadata, which the remote page controls, so private/loopback/link-local
// addresses are refused (imagefetch.ThumbnailPolicy).
func PreviewImage(settingsRepo *repository.SettingsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		target := c.Query("url")
		if !isHTTPURL(target) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "url must be an http or https URL"})
			return
		}

		policy := imagefetch.PreviewPolicy
		switch c.DefaultQuery("kind", "image") {
		case "image":
		case "thumbnail":
			policy = imagefetch.ThumbnailPolicy
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "kind must be \"image\" or \"thumbnail\""})
			return
		}

		proxy, _ := settingsRepo.Get(c.Request.Context(), models.SettingYtdlpProxy)

		body, contentType, size, cancel, err := imagefetch.Open(c.Request.Context(), target, proxy, policy)
		if err != nil {
			if errors.Is(err, imagefetch.ErrBlockedAddress) {
				// URL-free, like queue.fetchRemoteThumbnail.
				c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "thumbnail URL refused: it points at a private or non-public address"})
				return
			}
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}
		defer body.Close()
		defer cancel()

		c.DataFromReader(http.StatusOK, size, contentType, body, nil)
	}
}

// enqueueDownload applies collection/app-wide defaults, validates the
// destination path, and queues the download. Shared by CreateDownload and
// RedownloadLibraryItem so both go through identical validation.
func enqueueDownload(ctx context.Context, mgr *queue.DownloadManager, collectionsRepo *repository.CollectionsRepo, settingsRepo *repository.SettingsRepo, req CreateDownloadRequest) (int64, error) {
	if !isHTTPURL(req.URL) {
		return 0, invalidURLError{}
	}
	if req.CollectionID != nil {
		collection, err := collectionsRepo.Get(ctx, *req.CollectionID)
		if err != nil {
			return 0, err
		}
		if req.Quality == "" {
			req.Quality = collection.DefaultQuality
		}
		// Only fall back to the collection's template when the caller left
		// both the literal filename and their own template empty — an
		// explicit choice at request time always wins, same as Quality above.
		if req.Filename == "" && (req.FilenameTemplate == nil || *req.FilenameTemplate == "") && collection.FilenameTemplate != "" {
			req.FilenameTemplate = &collection.FilenameTemplate
		}
	}
	if req.Quality == "" {
		if def, err := settingsRepo.Get(ctx, models.SettingDefaultQuality); err == nil && def != "" {
			req.Quality = def
		} else {
			req.Quality = "best"
		}
	}
	if req.DownloadType == "audio" && req.AudioFormat == "" {
		req.AudioFormat = "mp3"
	}

	req.Folder = fsutil.SanitizeRelativePath(req.Folder)

	// Reject path traversal (and unknown collections) up front, before ever
	// queuing the job — the queue worker re-validates this too, but failing
	// fast here gives the caller an immediate error instead of a later
	// asynchronous "failed" status.
	effectiveRoot, err := mgr.ResolveEffectiveRoot(ctx, req.CollectionID)
	if err != nil {
		return 0, err
	}
	if _, err := pathsafe.ResolveUnderRoot(effectiveRoot, req.Folder); err != nil {
		return 0, invalidFolderError{err}
	}

	d := models.Download{
		URL:                    req.URL,
		CollectionID:           req.CollectionID,
		Folder:                 req.Folder,
		Filename:               req.Filename,
		DownloadType:           req.DownloadType,
		Quality:                req.Quality,
		OverrideTitle:          req.Title,
		OverrideArtistID:       req.ArtistID,
		OverrideYear:           req.Year,
		OverrideSeasonNumber:   req.SeasonNumber,
		OverrideSequenceNumber: req.SequenceNumber,
		FilenamePrefix:         req.FilenamePrefix,
		FilenameTemplate:       req.FilenameTemplate,
		OverrideTags:           req.Tags,
		GenerateNFO:            req.GenerateNFO,
		TargetLibraryItemID:    req.TargetLibraryItemID,
		GhostLibraryItemID:     req.GhostLibraryItemID,
		OverwriteFields:        req.OverwriteFields,
	}
	if req.AudioFormat != "" {
		d.AudioFormat = &req.AudioFormat
	}

	return mgr.Enqueue(ctx, d)
}

// invalidFolderError distinguishes a bad "folder" value from a bad/missing
// collection, both of which enqueueDownload can return as plain errors —
// writeEnqueueError uses this to pick the right message.
type invalidFolderError struct{ err error }

func (e invalidFolderError) Error() string { return e.err.Error() }
func (e invalidFolderError) Unwrap() error { return e.err }

// invalidURLError marks enqueueDownload's URL-scheme rejection so
// writeEnqueueError can report it as a 400 instead of a 500.
type invalidURLError struct{}

func (e invalidURLError) Error() string { return "url must be an http or https URL" }

// enqueueErrorStatus maps an enqueueDownload failure to the HTTP status and
// message the handlers answer with (also used as a per-item error by the bulk
// endpoints).
func enqueueErrorStatus(err error) (int, string) {
	var folderErr invalidFolderError
	if errors.As(err, &folderErr) {
		return http.StatusBadRequest, "invalid folder: " + folderErr.Error()
	}
	var urlErr invalidURLError
	if errors.As(err, &urlErr) {
		return http.StatusBadRequest, urlErr.Error()
	}
	if errors.Is(err, queue.ErrInvalidURL) {
		return http.StatusBadRequest, queue.ErrInvalidURL.Error()
	}
	if errors.Is(err, queue.ErrShuttingDown) {
		return http.StatusServiceUnavailable, queue.ErrShuttingDown.Error()
	}
	if errors.Is(err, repository.ErrNotFound) {
		return http.StatusBadRequest, "collection not found"
	}
	return http.StatusInternalServerError, err.Error()
}

// writeEnqueueError maps an enqueueDownload error to an HTTP response.
func writeEnqueueError(c *gin.Context, err error) {
	status, msg := enqueueErrorStatus(err)
	c.JSON(status, gin.H{"error": msg})
}

func ListDownloads(mgr *queue.DownloadManager, repo *repository.DownloadsRepo, collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo, artistsRepo *repository.ArtistsRepo, settingsRepo *repository.SettingsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		// ListLight: the response carries none of the stdout/stderr tails or
		// the yt-dlp command, so don't read them (~8 KB per row) for every
		// row on each 10 s poll. Still unbounded: the queue never truncates.
		rows, err := repo.ListLight(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		privacy, err := LoadItemPrivacy(c.Request.Context(), settingsRepo, collectionsRepo, tagsRepo, artistsRepo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		live := mgr.ProgressSnapshot()
		out := make([]DownloadResponse, 0, len(rows))
		for _, d := range rows {
			// Queue rows blur by collection only (no tags, no artist passed): a
			// download has no tags yet — they're applied to the library item once
			// it completes — and the queue deliberately ignores the artist too.
			out = append(out, toDownloadResponse(d, live[d.ID], privacy.Blurred(d.CollectionID, nil, nil)))
		}
		c.JSON(http.StatusOK, out)
	}
}

func CancelDownload(mgr *queue.DownloadManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		if err := mgr.Cancel(c.Request.Context(), id); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "download not found"})
				return
			}
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// ClearDownloadLog permanently removes every terminal (non-active) download
// log entry, regardless of age — a manual complement to the automated
// retention sweep (cleanupDownloadLog in cmd/server/main.go). Never touches
// an active download: DeleteOlderThan itself excludes those, so this can't
// be used to short-circuit BulkDeleteDownloads' cancel-first guard.
func ClearDownloadLog(repo *repository.DownloadsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		n, err := repo.DeleteOlderThan(c.Request.Context(), time.Now())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"deleted": n})
	}
}

// BulkDeleteDownloads is POST /api/downloads/bulk-delete: it removes the
// download log rows for the given ids, all or nothing. A download in an active
// status must be cancelled first, so if any listed id is active nothing is
// deleted and the answer is 409 {error, blockedIds}. Ids that do not exist are
// ignored; "deleted" counts the rows really removed. Safe with respect to the
// library table: see DownloadsRepo.Delete's note on library.download_id.
func BulkDeleteDownloads(repo *repository.DownloadsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req BulkIDsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if !checkBulkCount(c, len(req.IDs)) {
			return
		}
		deleted, blocked, err := repo.DeleteByIDs(c.Request.Context(), dedupeKeepOrder(req.IDs))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if len(blocked) > 0 {
			writeBlocked(c, "cancel these downloads before deleting them", blocked)
			return
		}
		c.JSON(http.StatusOK, BulkDeleteResponse{Deleted: deleted})
	}
}

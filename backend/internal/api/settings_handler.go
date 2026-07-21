package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
)

// ImportIgnoredFolders reads and JSON-decodes the import_ignored_folders
// setting, defaulting to an empty list if it's never been set (no migration
// seeds this key). Shared by GetSettings and ScanImport.
func ImportIgnoredFolders(ctx context.Context, repo *repository.SettingsRepo) ([]string, error) {
	raw, err := repo.Get(ctx, models.SettingImportIgnoredFolders)
	if errors.Is(err, repository.ErrNotFound) {
		return []string{}, nil
	}
	if err != nil {
		return nil, err
	}
	var folders []string
	if err := json.Unmarshal([]byte(raw), &folders); err != nil {
		return nil, fmt.Errorf("corrupt import_ignored_folders setting: %w", err)
	}
	return folders, nil
}

// HistoryAnonymizeURLs reads the history_anonymize_urls setting, defaulting
// to false if it's never been set (no migration seeds this key). Shared by
// GetSettings and ListHistory.
func HistoryAnonymizeURLs(ctx context.Context, repo *repository.SettingsRepo) (bool, error) {
	raw, err := repo.Get(ctx, models.SettingHistoryAnonymizeURLs)
	if errors.Is(err, repository.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return strconv.ParseBool(raw)
}

// HistoryRetentionDays reads the history_retention_days setting, defaulting to 0 — keep forever —
// if it's never been set (or is somehow corrupt), matching this codebase's convention that new
// settings default to the pre-existing (unbounded) behavior. Shared by GetSettings; the cleanup
// sweep in cmd/server/main.go reads this same key directly via settingsRepo.Get rather than
// calling this helper, to avoid an import cycle (see triggerJellyfinRefresh for precedent).
func HistoryRetentionDays(ctx context.Context, repo *repository.SettingsRepo) (int, error) {
	raw, err := repo.Get(ctx, models.SettingHistoryRetentionDays)
	if errors.Is(err, repository.ErrNotFound) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return 0, nil
	}
	return n, nil
}

// DownloadLogRetentionDays reads the download_log_retention_days setting, defaulting to 0 — keep
// forever — if it's never been set (or is somehow corrupt). Mirrors HistoryRetentionDays exactly;
// the download log is the same downloads table the live queue and Logs page read, so this only
// prunes terminal (non-active) rows — see DownloadsRepo.DeleteOlderThan. Shared by GetSettings; the
// cleanup sweep in cmd/server/main.go reads this same key directly via settingsRepo.Get rather than
// calling this helper, to avoid an import cycle (see triggerJellyfinRefresh for precedent).
func DownloadLogRetentionDays(ctx context.Context, repo *repository.SettingsRepo) (int, error) {
	raw, err := repo.Get(ctx, models.SettingDownloadLogRetentionDays)
	if errors.Is(err, repository.ErrNotFound) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return 0, nil
	}
	return n, nil
}

// LibraryView reads the library_view setting, defaulting to "grid" if it's
// never been set. Shared by GetSettings.
func LibraryView(ctx context.Context, repo *repository.SettingsRepo) (string, error) {
	raw, err := repo.Get(ctx, models.SettingLibraryView)
	if errors.Is(err, repository.ErrNotFound) {
		return "grid", nil
	}
	return raw, err
}

// LibrarySort reads the library_sort setting — stored as "<sortKey>:<sortDir>"
// (one key rather than two, since the two values are always read/written
// together) — defaulting to downloadedAt/desc if unset or malformed. Shared
// by GetSettings and UpdateSettings (which needs the current value to merge
// in a change to just one half of the pair).
func LibrarySort(ctx context.Context, repo *repository.SettingsRepo) (sortKey, sortDir string, err error) {
	raw, err := repo.Get(ctx, models.SettingLibrarySort)
	if errors.Is(err, repository.ErrNotFound) {
		return "downloadedAt", "desc", nil
	}
	if err != nil {
		return "", "", err
	}
	parts := strings.SplitN(raw, ":", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "downloadedAt", "desc", nil
	}
	return parts[0], parts[1], nil
}

// LibraryMode reads the library_mode setting, defaulting to "manage" if it's
// never been set. Shared by GetSettings.
func LibraryMode(ctx context.Context, repo *repository.SettingsRepo) (string, error) {
	raw, err := repo.Get(ctx, models.SettingLibraryMode)
	if errors.Is(err, repository.ErrNotFound) {
		return "manage", nil
	}
	if err != nil {
		return "manage", err
	}
	switch raw {
	case "manage", "view", "details":
		return raw, nil
	default:
		return "manage", nil
	}
}

// LibraryPaginationEnabled reads the library_pagination_enabled setting,
// defaulting to false (show everything) if it's never been set. Shared by
// GetSettings.
func LibraryPaginationEnabled(ctx context.Context, repo *repository.SettingsRepo) (bool, error) {
	raw, err := repo.Get(ctx, models.SettingLibraryPaginationEnabled)
	if errors.Is(err, repository.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return strconv.ParseBool(raw)
}

// LibraryPageSize reads the library_page_size setting, defaulting to 48 if
// it's never been set (or is somehow corrupt). Shared by GetSettings.
func LibraryPageSize(ctx context.Context, repo *repository.SettingsRepo) (int, error) {
	raw, err := repo.Get(ctx, models.SettingLibraryPageSize)
	if errors.Is(err, repository.ErrNotFound) {
		return 48, nil
	}
	if err != nil {
		return 48, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return 48, nil
	}
	return n, nil
}

// DownloadTimeoutMinutes reads the download_timeout_minutes setting, defaulting to 0 — no
// timeout — if it's never been set (or is somehow corrupt), matching this codebase's convention
// that new settings default to the pre-existing (unbounded) behavior. Shared by GetSettings; the
// queue manager reads this same key directly via settingsRepo.Get rather than calling this
// helper, to avoid an import cycle (see triggerJellyfinRefresh for the established precedent).
func DownloadTimeoutMinutes(ctx context.Context, repo *repository.SettingsRepo) (int, error) {
	raw, err := repo.Get(ctx, models.SettingDownloadTimeoutMinutes)
	if errors.Is(err, repository.ErrNotFound) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return 0, nil
	}
	return n, nil
}

// ThumbnailFrameCount reads the thumbnail_frame_count setting, defaulting to
// 4 if it's never been set (or is somehow corrupt). Shared by GetSettings
// and GetLibraryThumbnailCandidates.
func ThumbnailFrameCount(ctx context.Context, repo *repository.SettingsRepo) (int, error) {
	raw, err := repo.Get(ctx, models.SettingThumbnailFrameCount)
	if errors.Is(err, repository.ErrNotFound) {
		return 4, nil
	}
	if err != nil {
		return 4, err
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 4, nil
	}
	return n, nil
}

// PrivacyBlurStrength reads the privacy_blur_strength setting, defaulting to
// "default" if it's never been set (or is somehow corrupt) — this default
// keeps the pre-existing blur intensity unchanged for anyone who upgrades
// without touching the new setting. Shared by GetSettings.
func PrivacyBlurStrength(ctx context.Context, repo *repository.SettingsRepo) (string, error) {
	raw, err := repo.Get(ctx, models.SettingPrivacyBlurStrength)
	if errors.Is(err, repository.ErrNotFound) {
		return "default", nil
	}
	if err != nil {
		return "default", err
	}
	switch raw {
	case "weak", "default", "strong":
		return raw, nil
	default:
		return "default", nil
	}
}

// BrowseIgnorePrivacy reads the browse_ignore_privacy setting, defaulting to
// false — private/blurred items keep blurring everywhere, including Browse,
// unless explicitly turned off. When true, this only affects how the Browse
// page renders items client-side; it does not change what the API reports
// as blurred, and it has no effect on the Library/management pages. Shared
// by GetSettings.
func BrowseIgnorePrivacy(ctx context.Context, repo *repository.SettingsRepo) (bool, error) {
	raw, err := repo.Get(ctx, models.SettingBrowseIgnorePrivacy)
	if errors.Is(err, repository.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return strconv.ParseBool(raw)
}

// SkipDownloadPreview reads the skip_download_preview setting, defaulting to false (previews
// shown) if it's never been set (no migration seeds this key) — previews are on by default.
// Shared by GetSettings.
func SkipDownloadPreview(ctx context.Context, repo *repository.SettingsRepo) (bool, error) {
	raw, err := repo.Get(ctx, models.SettingSkipDownloadPreview)
	if errors.Is(err, repository.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return strconv.ParseBool(raw)
}

// JellyfinEnabled reads the jellyfin_enabled setting, defaulting to false
// (integration off) if it's never been set. Shared by GetSettings.
func JellyfinEnabled(ctx context.Context, repo *repository.SettingsRepo) (bool, error) {
	raw, err := repo.Get(ctx, models.SettingJellyfinEnabled)
	if errors.Is(err, repository.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return strconv.ParseBool(raw)
}

// JellyfinRefreshMode reads the jellyfin_refresh_mode setting, defaulting to
// "none" if it's never been set — preserves the pre-existing manual-only
// behavior for deployments upgrading into this setting's existence, rather
// than surprising them with a new automatic refresh.
func JellyfinRefreshMode(ctx context.Context, repo *repository.SettingsRepo) (string, error) {
	raw, err := repo.Get(ctx, models.SettingJellyfinRefreshMode)
	if errors.Is(err, repository.ErrNotFound) {
		return "none", nil
	}
	if err != nil {
		return "", err
	}
	return raw, nil
}

// LibraryAutoplay reads the library_autoplay setting, defaulting to true if
// it's never been set — the player already always autoplayed before this
// setting existed, so upgrading shouldn't silently change that. Shared by
// GetSettings.
func LibraryAutoplay(ctx context.Context, repo *repository.SettingsRepo) (bool, error) {
	raw, err := repo.Get(ctx, models.SettingLibraryAutoplay)
	if errors.Is(err, repository.ErrNotFound) {
		return true, nil
	}
	if err != nil {
		return true, err
	}
	return strconv.ParseBool(raw)
}

// YtdlpCookiesBrowser reads the ytdlp_cookies_browser setting, defaulting to
// "" (disabled) if it's never been set. Shared by GetSettings.
func YtdlpCookiesBrowser(ctx context.Context, repo *repository.SettingsRepo) (string, error) {
	raw, err := repo.Get(ctx, models.SettingYtdlpCookiesBrowser)
	if errors.Is(err, repository.ErrNotFound) {
		return "", nil
	}
	return raw, err
}

// YtdlpCookiesProfile reads the ytdlp_cookies_profile setting, defaulting to
// "" if it's never been set. Shared by GetSettings.
func YtdlpCookiesProfile(ctx context.Context, repo *repository.SettingsRepo) (string, error) {
	raw, err := repo.Get(ctx, models.SettingYtdlpCookiesProfile)
	if errors.Is(err, repository.ErrNotFound) {
		return "", nil
	}
	return raw, err
}

// YtdlpProxy reads the ytdlp_proxy setting, defaulting to "" (disabled) if
// it's never been set. Shared by GetSettings.
func YtdlpProxy(ctx context.Context, repo *repository.SettingsRepo) (string, error) {
	raw, err := repo.Get(ctx, models.SettingYtdlpProxy)
	if errors.Is(err, repository.ErrNotFound) {
		return "", nil
	}
	return raw, err
}

// YtdlpRateLimit reads the ytdlp_rate_limit setting, defaulting to ""
// (disabled) if it's never been set. Shared by GetSettings.
func YtdlpRateLimit(ctx context.Context, repo *repository.SettingsRepo) (string, error) {
	raw, err := repo.Get(ctx, models.SettingYtdlpRateLimit)
	if errors.Is(err, repository.ErrNotFound) {
		return "", nil
	}
	return raw, err
}

// YtdlpRetries reads the ytdlp_retries setting, defaulting to 0 — yt-dlp's
// own built-in default, not explicitly passed — if it's never been set (or
// is somehow corrupt). Shared by GetSettings.
func YtdlpRetries(ctx context.Context, repo *repository.SettingsRepo) (int, error) {
	raw, err := repo.Get(ctx, models.SettingYtdlpRetries)
	if errors.Is(err, repository.ErrNotFound) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return 0, nil
	}
	return n, nil
}

// GetSettings reports live state where it exists rather than a possibly
// stale DB copy: downloadDirectory comes from the actual MEDIA_ROOT config
// value (the DB row is legacy/display only), and maxConcurrentDownloads
// comes from the worker pool's current size (immediately reflects any
// UpdateSettings call, not just what was last persisted).
func GetSettings(repo *repository.SettingsRepo, mgr *queue.DownloadManager, mediaRoot string) gin.HandlerFunc {
	return func(c *gin.Context) {
		defaultQuality, err := repo.Get(c.Request.Context(), models.SettingDefaultQuality)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defaultDownloadType, err := repo.Get(c.Request.Context(), models.SettingDefaultDownloadType)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		downloadTimeoutMinutes, err := DownloadTimeoutMinutes(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		ignoredFolders, err := ImportIgnoredFolders(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		anonymizeHistory, err := HistoryAnonymizeURLs(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		historyRetentionDays, err := HistoryRetentionDays(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		downloadLogRetentionDays, err := DownloadLogRetentionDays(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		libraryView, err := LibraryView(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		librarySortKey, librarySortDir, err := LibrarySort(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		libraryMode, err := LibraryMode(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		libraryPaginationEnabled, err := LibraryPaginationEnabled(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		libraryPageSize, err := LibraryPageSize(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		thumbnailFrameCount, err := ThumbnailFrameCount(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		privacyBlurStrength, err := PrivacyBlurStrength(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		browseIgnorePrivacy, err := BrowseIgnorePrivacy(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		skipDownloadPreview, err := SkipDownloadPreview(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		jellyfinEnabled, err := JellyfinEnabled(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		jellyfinURL, err := repo.Get(c.Request.Context(), models.SettingJellyfinURL)
		if err != nil && !errors.Is(err, repository.ErrNotFound) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		jellyfinAPIKey, err := repo.Get(c.Request.Context(), models.SettingJellyfinAPIKey)
		if err != nil && !errors.Is(err, repository.ErrNotFound) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		jellyfinRefreshMode, err := JellyfinRefreshMode(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		libraryAutoplay, err := LibraryAutoplay(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		ytdlpCookiesBrowser, err := YtdlpCookiesBrowser(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		ytdlpCookiesProfile, err := YtdlpCookiesProfile(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		ytdlpProxy, err := YtdlpProxy(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		ytdlpRateLimit, err := YtdlpRateLimit(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		ytdlpRetries, err := YtdlpRetries(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, SettingsResponse{
			DownloadDirectory:        mediaRoot,
			MaxConcurrentDownloads:   mgr.WorkerCount(),
			DownloadTimeoutMinutes:   downloadTimeoutMinutes,
			DefaultQuality:           defaultQuality,
			DefaultDownloadType:      defaultDownloadType,
			ImportIgnoredFolders:     ignoredFolders,
			HistoryAnonymizeURLs:     anonymizeHistory,
			HistoryRetentionDays:     historyRetentionDays,
			DownloadLogRetentionDays: downloadLogRetentionDays,
			LibraryView:              libraryView,
			LibrarySortKey:           librarySortKey,
			LibrarySortDir:           librarySortDir,
			LibraryMode:              libraryMode,
			LibraryPaginationEnabled: libraryPaginationEnabled,
			LibraryPageSize:          libraryPageSize,
			ThumbnailFrameCount:      thumbnailFrameCount,
			PrivacyBlurStrength:      privacyBlurStrength,
			BrowseIgnorePrivacy:      browseIgnorePrivacy,
			SkipDownloadPreview:      skipDownloadPreview,
			JellyfinEnabled:          jellyfinEnabled,
			JellyfinURL:              jellyfinURL,
			JellyfinAPIKey:           jellyfinAPIKey,
			JellyfinRefreshMode:      jellyfinRefreshMode,
			LibraryAutoplay:          libraryAutoplay,
			YtdlpCookiesBrowser:      ytdlpCookiesBrowser,
			YtdlpCookiesProfile:      ytdlpCookiesProfile,
			YtdlpProxy:               ytdlpProxy,
			YtdlpRateLimit:           ytdlpRateLimit,
			YtdlpRetries:             ytdlpRetries,
		})
	}
}

// UpdateSettings persists any provided fields and, for concurrency,
// applies the change to the live worker pool immediately rather than
// waiting for a restart.
func UpdateSettings(repo *repository.SettingsRepo, mgr *queue.DownloadManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req UpdateSettingsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if req.MaxConcurrentDownloads != nil {
			if err := repo.Set(c.Request.Context(), models.SettingMaxConcurrentDownloads, strconv.Itoa(*req.MaxConcurrentDownloads)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			mgr.SetWorkerCount(*req.MaxConcurrentDownloads)
		}
		if req.DownloadTimeoutMinutes != nil {
			if err := repo.Set(c.Request.Context(), models.SettingDownloadTimeoutMinutes, strconv.Itoa(*req.DownloadTimeoutMinutes)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.DefaultQuality != nil {
			if err := repo.Set(c.Request.Context(), models.SettingDefaultQuality, *req.DefaultQuality); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.DefaultDownloadType != nil {
			if err := repo.Set(c.Request.Context(), models.SettingDefaultDownloadType, *req.DefaultDownloadType); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.ImportIgnoredFolders != nil {
			encoded, err := json.Marshal(*req.ImportIgnoredFolders)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if err := repo.Set(c.Request.Context(), models.SettingImportIgnoredFolders, string(encoded)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.HistoryAnonymizeURLs != nil {
			if err := repo.Set(c.Request.Context(), models.SettingHistoryAnonymizeURLs, strconv.FormatBool(*req.HistoryAnonymizeURLs)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.HistoryRetentionDays != nil {
			if err := repo.Set(c.Request.Context(), models.SettingHistoryRetentionDays, strconv.Itoa(*req.HistoryRetentionDays)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.DownloadLogRetentionDays != nil {
			if err := repo.Set(c.Request.Context(), models.SettingDownloadLogRetentionDays, strconv.Itoa(*req.DownloadLogRetentionDays)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.LibraryView != nil {
			if err := repo.Set(c.Request.Context(), models.SettingLibraryView, *req.LibraryView); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.LibrarySortKey != nil || req.LibrarySortDir != nil {
			// Stored together as one "<key>:<dir>" value — a request that only
			// changes one half still needs the other half's current value to
			// avoid clobbering it.
			sortKey, sortDir, err := LibrarySort(c.Request.Context(), repo)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if req.LibrarySortKey != nil {
				sortKey = *req.LibrarySortKey
			}
			if req.LibrarySortDir != nil {
				sortDir = *req.LibrarySortDir
			}
			if err := repo.Set(c.Request.Context(), models.SettingLibrarySort, sortKey+":"+sortDir); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.LibraryMode != nil {
			if err := repo.Set(c.Request.Context(), models.SettingLibraryMode, *req.LibraryMode); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.LibraryPaginationEnabled != nil {
			if err := repo.Set(c.Request.Context(), models.SettingLibraryPaginationEnabled, strconv.FormatBool(*req.LibraryPaginationEnabled)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.LibraryPageSize != nil {
			if err := repo.Set(c.Request.Context(), models.SettingLibraryPageSize, strconv.Itoa(*req.LibraryPageSize)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.ThumbnailFrameCount != nil {
			if err := repo.Set(c.Request.Context(), models.SettingThumbnailFrameCount, strconv.Itoa(*req.ThumbnailFrameCount)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.PrivacyBlurStrength != nil {
			if err := repo.Set(c.Request.Context(), models.SettingPrivacyBlurStrength, *req.PrivacyBlurStrength); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.BrowseIgnorePrivacy != nil {
			if err := repo.Set(c.Request.Context(), models.SettingBrowseIgnorePrivacy, strconv.FormatBool(*req.BrowseIgnorePrivacy)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.SkipDownloadPreview != nil {
			if err := repo.Set(c.Request.Context(), models.SettingSkipDownloadPreview, strconv.FormatBool(*req.SkipDownloadPreview)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.JellyfinEnabled != nil {
			if err := repo.Set(c.Request.Context(), models.SettingJellyfinEnabled, strconv.FormatBool(*req.JellyfinEnabled)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.JellyfinURL != nil {
			if err := repo.Set(c.Request.Context(), models.SettingJellyfinURL, *req.JellyfinURL); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.JellyfinRefreshMode != nil {
			if err := repo.Set(c.Request.Context(), models.SettingJellyfinRefreshMode, *req.JellyfinRefreshMode); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.JellyfinAPIKey != nil {
			if err := repo.Set(c.Request.Context(), models.SettingJellyfinAPIKey, *req.JellyfinAPIKey); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.LibraryAutoplay != nil {
			if err := repo.Set(c.Request.Context(), models.SettingLibraryAutoplay, strconv.FormatBool(*req.LibraryAutoplay)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.YtdlpCookiesBrowser != nil {
			if err := repo.Set(c.Request.Context(), models.SettingYtdlpCookiesBrowser, *req.YtdlpCookiesBrowser); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.YtdlpCookiesProfile != nil {
			if err := repo.Set(c.Request.Context(), models.SettingYtdlpCookiesProfile, *req.YtdlpCookiesProfile); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.YtdlpProxy != nil {
			if err := repo.Set(c.Request.Context(), models.SettingYtdlpProxy, *req.YtdlpProxy); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.YtdlpRateLimit != nil {
			if err := repo.Set(c.Request.Context(), models.SettingYtdlpRateLimit, *req.YtdlpRateLimit); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.YtdlpRetries != nil {
			if err := repo.Set(c.Request.Context(), models.SettingYtdlpRetries, strconv.Itoa(*req.YtdlpRetries)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		c.Status(http.StatusNoContent)
	}
}

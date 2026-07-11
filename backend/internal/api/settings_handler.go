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
		c.JSON(http.StatusOK, SettingsResponse{
			DownloadDirectory:      mediaRoot,
			MaxConcurrentDownloads: mgr.WorkerCount(),
			DefaultQuality:         defaultQuality,
			DefaultDownloadType:    defaultDownloadType,
			ImportIgnoredFolders:   ignoredFolders,
			HistoryAnonymizeURLs:   anonymizeHistory,
			LibraryView:            libraryView,
			LibrarySortKey:         librarySortKey,
			LibrarySortDir:         librarySortDir,
			LibraryMode:            libraryMode,
			ThumbnailFrameCount:    thumbnailFrameCount,
			PrivacyBlurStrength:    privacyBlurStrength,
			SkipDownloadPreview:    skipDownloadPreview,
			JellyfinEnabled:        jellyfinEnabled,
			JellyfinURL:            jellyfinURL,
			JellyfinAPIKey:         jellyfinAPIKey,
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
		if req.JellyfinAPIKey != nil {
			if err := repo.Set(c.Request.Context(), models.SettingJellyfinAPIKey, *req.JellyfinAPIKey); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		c.Status(http.StatusNoContent)
	}
}

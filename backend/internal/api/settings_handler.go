package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

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

		c.JSON(http.StatusOK, SettingsResponse{
			DownloadDirectory:      mediaRoot,
			MaxConcurrentDownloads: mgr.WorkerCount(),
			DefaultQuality:         defaultQuality,
			DefaultDownloadType:    defaultDownloadType,
			ImportIgnoredFolders:   ignoredFolders,
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

		c.Status(http.StatusNoContent)
	}
}

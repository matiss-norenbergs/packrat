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

	"packrat/backend/internal/backup"
	"packrat/backend/internal/downloader"
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

// defaultImageConvertFormat matches the existing convention that video
// thumbnails always get normalized to JPEG (yt-dlp's --convert-thumbnails
// jpg).
const defaultImageConvertFormat = "jpg"

// ImageConvertFormat reads the image_convert_format setting, defaulting to
// defaultImageConvertFormat if it's never been set or is corrupt. Shared by
// GetSettings.
func ImageConvertFormat(ctx context.Context, repo *repository.SettingsRepo) (string, error) {
	raw, err := repo.Get(ctx, models.SettingImageConvertFormat)
	if errors.Is(err, repository.ErrNotFound) {
		return defaultImageConvertFormat, nil
	}
	if err != nil {
		return defaultImageConvertFormat, err
	}
	switch raw {
	case "original", "jpg", "png", "webp":
		return raw, nil
	default:
		return defaultImageConvertFormat, nil
	}
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

// AutoBackupIntervalHours reads the auto_backup_interval_hours setting,
// defaulting to 0 — disabled — if it's never been set (or is corrupt).
// Shared by GetSettings; backup.RunScheduledBackupIfDue reads this same key
// directly via settingsRepo.Get rather than calling this helper, to avoid an
// import cycle (api already imports backup).
func AutoBackupIntervalHours(ctx context.Context, repo *repository.SettingsRepo) (int, error) {
	raw, err := repo.Get(ctx, models.SettingAutoBackupIntervalHours)
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

// BackupRetentionCount reads the backup_retention_count setting, defaulting
// to backup.DefaultBackupRetentionCount if it's never been set (or is
// corrupt/negative) — this default keeps pre-existing pruning behavior
// unchanged for anyone who upgrades without touching the new setting. 0
// means unlimited — every backup is kept, nothing is ever pruned.
// backup.RunBackup's pruneOldBackups reads this same key directly via
// settingsRepo.Get rather than calling this helper, to avoid an import
// cycle (api already imports backup). Shared by GetSettings.
func BackupRetentionCount(ctx context.Context, repo *repository.SettingsRepo) (int, error) {
	raw, err := repo.Get(ctx, models.SettingBackupRetentionCount)
	if errors.Is(err, repository.ErrNotFound) {
		return backup.DefaultBackupRetentionCount, nil
	}
	if err != nil {
		return backup.DefaultBackupRetentionCount, err
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return backup.DefaultBackupRetentionCount, nil
	}
	return n, nil
}

// defaultResolutionThresholdLow/High are the resolution-tier defaults used
// whenever the corresponding setting has never been set (or is corrupt) —
// 720p and 2160p bracket the most common "standard-def", "HD/2K", and "4K"
// buckets without requiring anyone to configure anything for sensible
// out-of-the-box coloring.
const (
	defaultResolutionThresholdLow  = 720
	defaultResolutionThresholdHigh = 2160
)

// ResolutionTierMediumEnabled reads the resolution_tier_medium_enabled
// setting, defaulting to true if it's never been set (or is corrupt) — the
// medium tier is on by default so newly-configured thresholds immediately
// produce a three-way low/medium/high split. Shared by GetSettings.
func ResolutionTierMediumEnabled(ctx context.Context, repo *repository.SettingsRepo) (bool, error) {
	raw, err := repo.Get(ctx, models.SettingResolutionTierMediumEnabled)
	if errors.Is(err, repository.ErrNotFound) {
		return true, nil
	}
	if err != nil {
		return true, err
	}
	b, err := strconv.ParseBool(raw)
	if err != nil {
		return true, nil
	}
	return b, nil
}

// ResolutionThresholdLow reads the resolution_threshold_low setting
// (heights at or below this are "low" quality), defaulting to
// defaultResolutionThresholdLow if it's never been set or is corrupt.
// Shared by GetSettings.
func ResolutionThresholdLow(ctx context.Context, repo *repository.SettingsRepo) (int, error) {
	raw, err := repo.Get(ctx, models.SettingResolutionThresholdLow)
	if errors.Is(err, repository.ErrNotFound) {
		return defaultResolutionThresholdLow, nil
	}
	if err != nil {
		return defaultResolutionThresholdLow, err
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return defaultResolutionThresholdLow, nil
	}
	return n, nil
}

// ResolutionThresholdHigh reads the resolution_threshold_high setting
// (heights at or above this are "high" quality), defaulting to
// defaultResolutionThresholdHigh if it's never been set or is corrupt.
// Shared by GetSettings.
func ResolutionThresholdHigh(ctx context.Context, repo *repository.SettingsRepo) (int, error) {
	raw, err := repo.Get(ctx, models.SettingResolutionThresholdHigh)
	if errors.Is(err, repository.ErrNotFound) {
		return defaultResolutionThresholdHigh, nil
	}
	if err != nil {
		return defaultResolutionThresholdHigh, err
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return defaultResolutionThresholdHigh, nil
	}
	return n, nil
}

// defaultThumbnailResolutionThresholdLow/High mirror
// defaultResolutionThresholdLow/High's role but for the separate thumbnail
// tier — lower, since a thumbnail is a small preview image that rarely
// exceeds 1080p, unlike a video's much wider practical range.
const (
	defaultThumbnailResolutionThresholdLow  = 480
	defaultThumbnailResolutionThresholdHigh = 1080
)

// ThumbnailResolutionTierMediumEnabled reads the
// thumbnail_resolution_tier_medium_enabled setting, defaulting to true if
// it's never been set (or is corrupt). Shared by GetSettings.
func ThumbnailResolutionTierMediumEnabled(ctx context.Context, repo *repository.SettingsRepo) (bool, error) {
	raw, err := repo.Get(ctx, models.SettingThumbnailResolutionTierMediumEnabled)
	if errors.Is(err, repository.ErrNotFound) {
		return true, nil
	}
	if err != nil {
		return true, err
	}
	b, err := strconv.ParseBool(raw)
	if err != nil {
		return true, nil
	}
	return b, nil
}

// ThumbnailResolutionThresholdLow reads the
// thumbnail_resolution_threshold_low setting (heights at or below this are
// "low" quality), defaulting to defaultThumbnailResolutionThresholdLow if
// it's never been set or is corrupt. Shared by GetSettings.
func ThumbnailResolutionThresholdLow(ctx context.Context, repo *repository.SettingsRepo) (int, error) {
	raw, err := repo.Get(ctx, models.SettingThumbnailResolutionThresholdLow)
	if errors.Is(err, repository.ErrNotFound) {
		return defaultThumbnailResolutionThresholdLow, nil
	}
	if err != nil {
		return defaultThumbnailResolutionThresholdLow, err
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return defaultThumbnailResolutionThresholdLow, nil
	}
	return n, nil
}

// ThumbnailResolutionThresholdHigh reads the
// thumbnail_resolution_threshold_high setting (heights at or above this are
// "high" quality), defaulting to defaultThumbnailResolutionThresholdHigh if
// it's never been set or is corrupt. Shared by GetSettings.
func ThumbnailResolutionThresholdHigh(ctx context.Context, repo *repository.SettingsRepo) (int, error) {
	raw, err := repo.Get(ctx, models.SettingThumbnailResolutionThresholdHigh)
	if errors.Is(err, repository.ErrNotFound) {
		return defaultThumbnailResolutionThresholdHigh, nil
	}
	if err != nil {
		return defaultThumbnailResolutionThresholdHigh, err
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return defaultThumbnailResolutionThresholdHigh, nil
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

// PrivacyEnabled reads the privacy_enabled setting, defaulting to false — the
// master switch for the whole privacy workflow starts off, so upgrading to
// this feature doesn't retroactively start blurring anything for anyone who
// already has private collections/tags marked; they opt in explicitly. When
// false, every privacy-derived `blurred` computation below is forced false,
// but the underlying isPrivate values on collections/tags are never touched
// — flipping this back on resumes blurring exactly where it left off. Shared
// by GetSettings.
func PrivacyEnabled(ctx context.Context, repo *repository.SettingsRepo) (bool, error) {
	raw, err := repo.Get(ctx, models.SettingPrivacyEnabled)
	if errors.Is(err, repository.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return strconv.ParseBool(raw)
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

// defaultThumbnailEnhancementUpscaler/MinDim/Factor are the AI thumbnail
// enhancement defaults used whenever their setting has never been set (or
// is corrupt) — R-ESRGAN 4x+ is A1111's standard general-purpose upscaler,
// 720 keeps anything already HD from being needlessly reprocessed, and 4x
// matches R-ESRGAN's own native scale factor.
const (
	defaultThumbnailEnhancementUpscaler   = "R-ESRGAN 4x+"
	defaultThumbnailEnhancementMinDim     = 720
	defaultThumbnailEnhancementFactor     = 4
	defaultThumbnailEnhancementTargetMode = "factor"
	defaultThumbnailEnhancementTargetDim  = 1920
	// defaultThumbnailEnhancementMaxPerSweep mirrors
	// thumbnailenhance.defaultMaxEnhancementsPerSweep — kept as a separate
	// constant since this package can't import that one's unexported value.
	defaultThumbnailEnhancementMaxPerSweep = 5
)

// ThumbnailEnhancementEnabled reads the thumbnail_enhancement_enabled
// setting, defaulting to false (opt-in) if it's never been set. Shared by
// GetSettings.
func ThumbnailEnhancementEnabled(ctx context.Context, repo *repository.SettingsRepo) (bool, error) {
	raw, err := repo.Get(ctx, models.SettingThumbnailEnhancementEnabled)
	if errors.Is(err, repository.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return strconv.ParseBool(raw)
}

// ThumbnailEnhancementUpscaler reads the thumbnail_enhancement_upscaler
// setting, defaulting to defaultThumbnailEnhancementUpscaler if it's never
// been set. Shared by GetSettings.
func ThumbnailEnhancementUpscaler(ctx context.Context, repo *repository.SettingsRepo) (string, error) {
	raw, err := repo.Get(ctx, models.SettingThumbnailEnhancementUpscaler)
	if errors.Is(err, repository.ErrNotFound) || raw == "" {
		return defaultThumbnailEnhancementUpscaler, nil
	}
	if err != nil {
		return defaultThumbnailEnhancementUpscaler, err
	}
	return raw, nil
}

// ThumbnailEnhancementMinDim reads the thumbnail_enhancement_min_dim
// setting, defaulting to defaultThumbnailEnhancementMinDim if it's never
// been set or is corrupt. Shared by GetSettings.
func ThumbnailEnhancementMinDim(ctx context.Context, repo *repository.SettingsRepo) (int, error) {
	raw, err := repo.Get(ctx, models.SettingThumbnailEnhancementMinDim)
	if errors.Is(err, repository.ErrNotFound) {
		return defaultThumbnailEnhancementMinDim, nil
	}
	if err != nil {
		return defaultThumbnailEnhancementMinDim, err
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return defaultThumbnailEnhancementMinDim, nil
	}
	return n, nil
}

// ThumbnailEnhancementFactor reads the thumbnail_enhancement_factor
// setting, defaulting to defaultThumbnailEnhancementFactor if it's never
// been set or is corrupt. Shared by GetSettings.
func ThumbnailEnhancementFactor(ctx context.Context, repo *repository.SettingsRepo) (int, error) {
	raw, err := repo.Get(ctx, models.SettingThumbnailEnhancementFactor)
	if errors.Is(err, repository.ErrNotFound) {
		return defaultThumbnailEnhancementFactor, nil
	}
	if err != nil {
		return defaultThumbnailEnhancementFactor, err
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return defaultThumbnailEnhancementFactor, nil
	}
	return n, nil
}

// ThumbnailEnhancementTargetMode reads the thumbnail_enhancement_target_mode
// setting ("factor" or "resolution"), defaulting to
// defaultThumbnailEnhancementTargetMode if it's never been set or is
// corrupt. Shared by GetSettings.
func ThumbnailEnhancementTargetMode(ctx context.Context, repo *repository.SettingsRepo) (string, error) {
	raw, err := repo.Get(ctx, models.SettingThumbnailEnhancementTargetMode)
	if errors.Is(err, repository.ErrNotFound) {
		return defaultThumbnailEnhancementTargetMode, nil
	}
	if err != nil {
		return defaultThumbnailEnhancementTargetMode, err
	}
	if raw != "factor" && raw != "resolution" {
		return defaultThumbnailEnhancementTargetMode, nil
	}
	return raw, nil
}

// ThumbnailEnhancementTargetDim reads the thumbnail_enhancement_target_dim
// setting, defaulting to defaultThumbnailEnhancementTargetDim if it's never
// been set or is corrupt. Shared by GetSettings.
func ThumbnailEnhancementTargetDim(ctx context.Context, repo *repository.SettingsRepo) (int, error) {
	raw, err := repo.Get(ctx, models.SettingThumbnailEnhancementTargetDim)
	if errors.Is(err, repository.ErrNotFound) {
		return defaultThumbnailEnhancementTargetDim, nil
	}
	if err != nil {
		return defaultThumbnailEnhancementTargetDim, err
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return defaultThumbnailEnhancementTargetDim, nil
	}
	return n, nil
}

// ThumbnailEnhancementScheduleEnabled reads the
// thumbnail_enhancement_schedule_enabled setting, defaulting to true (the
// pre-existing behavior — the hourly sweep ran whenever the feature itself
// was enabled) if it's never been set or is corrupt. Independent of
// ThumbnailEnhancementEnabled: turning this off keeps the feature usable
// purely on-demand via the manual "Enhance now" trigger without the
// background sweep ever running. Shared by GetSettings.
func ThumbnailEnhancementScheduleEnabled(ctx context.Context, repo *repository.SettingsRepo) (bool, error) {
	raw, err := repo.Get(ctx, models.SettingThumbnailEnhancementScheduleEnabled)
	if errors.Is(err, repository.ErrNotFound) {
		return true, nil
	}
	if err != nil {
		return true, err
	}
	b, err := strconv.ParseBool(raw)
	if err != nil {
		return true, nil
	}
	return b, nil
}

// ThumbnailEnhancementRetentionDays reads the
// thumbnail_enhancement_retention_days setting, defaulting to 0 — keep
// forever — if it's never been set (or is somehow corrupt). Mirrors
// HistoryRetentionDays/DownloadLogRetentionDays exactly. Shared by
// GetSettings; the cleanup sweep in cmd/server/main.go reads this same key
// directly via deps.SettingsRepo.Get rather than calling this helper, to
// avoid an import cycle (see HistoryRetentionDays for precedent).
func ThumbnailEnhancementRetentionDays(ctx context.Context, repo *repository.SettingsRepo) (int, error) {
	raw, err := repo.Get(ctx, models.SettingThumbnailEnhancementRetentionDays)
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

// ThumbnailEnhancementMaxPerSweep reads the
// thumbnail_enhancement_max_per_sweep setting, defaulting to
// defaultThumbnailEnhancementMaxPerSweep if it's never been set (or is
// corrupt/non-positive). Bounds how many items one batch run (a scheduled
// sweep or "Enhance now") processes — a direct per-item Enhance click
// always ignores this and processes just the one item picked. Shared by
// GetSettings.
func ThumbnailEnhancementMaxPerSweep(ctx context.Context, repo *repository.SettingsRepo) (int, error) {
	raw, err := repo.Get(ctx, models.SettingThumbnailEnhancementMaxPerSweep)
	if errors.Is(err, repository.ErrNotFound) {
		return defaultThumbnailEnhancementMaxPerSweep, nil
	}
	if err != nil {
		return defaultThumbnailEnhancementMaxPerSweep, err
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return defaultThumbnailEnhancementMaxPerSweep, nil
	}
	return n, nil
}

// ThumbnailEnhancementAutoApprove reads the thumbnail_enhancement_auto_approve
// setting, defaulting to false — when true, enhancements skip backing up
// the pre-enhancement thumbnail (see thumbnailenhance.config.autoApprove).
// Shared by GetSettings.
func ThumbnailEnhancementAutoApprove(ctx context.Context, repo *repository.SettingsRepo) (bool, error) {
	raw, err := repo.Get(ctx, models.SettingThumbnailEnhancementAutoApprove)
	if errors.Is(err, repository.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	b, err := strconv.ParseBool(raw)
	if err != nil {
		return false, nil
	}
	return b, nil
}

// ThumbnailEnhancementAutoOnDownload reads the
// thumbnail_enhancement_auto_on_download setting, defaulting to false —
// when true, a fresh download's thumbnail is enhanced right after the
// download completes if it's eligible (see
// thumbnailenhance.MaybeAutoEnhanceOnDownload). Shared by GetSettings.
func ThumbnailEnhancementAutoOnDownload(ctx context.Context, repo *repository.SettingsRepo) (bool, error) {
	raw, err := repo.Get(ctx, models.SettingThumbnailEnhancementAutoOnDownload)
	if errors.Is(err, repository.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	b, err := strconv.ParseBool(raw)
	if err != nil {
		return false, nil
	}
	return b, nil
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
func GetSettings(repo *repository.SettingsRepo, mgr *queue.DownloadManager, ytdlp *downloader.YtDlpService, mediaRoot string) gin.HandlerFunc {
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
		imageConvertFormat, err := ImageConvertFormat(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		privacyEnabled, err := PrivacyEnabled(c.Request.Context(), repo)
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
		autoBackupIntervalHours, err := AutoBackupIntervalHours(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		backupRetentionCount, err := BackupRetentionCount(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		resolutionTierMediumEnabled, err := ResolutionTierMediumEnabled(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		resolutionThresholdLow, err := ResolutionThresholdLow(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		resolutionThresholdHigh, err := ResolutionThresholdHigh(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		thumbnailResolutionTierMediumEnabled, err := ThumbnailResolutionTierMediumEnabled(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		thumbnailResolutionThresholdLow, err := ThumbnailResolutionThresholdLow(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		thumbnailResolutionThresholdHigh, err := ThumbnailResolutionThresholdHigh(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		thumbnailEnhancementEnabled, err := ThumbnailEnhancementEnabled(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		thumbnailEnhancementURL, err := repo.Get(c.Request.Context(), models.SettingThumbnailEnhancementURL)
		if err != nil && !errors.Is(err, repository.ErrNotFound) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		thumbnailEnhancementUsername, err := repo.Get(c.Request.Context(), models.SettingThumbnailEnhancementUsername)
		if err != nil && !errors.Is(err, repository.ErrNotFound) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		thumbnailEnhancementPassword, err := repo.Get(c.Request.Context(), models.SettingThumbnailEnhancementPassword)
		if err != nil && !errors.Is(err, repository.ErrNotFound) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		thumbnailEnhancementUpscaler, err := ThumbnailEnhancementUpscaler(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		thumbnailEnhancementMinDim, err := ThumbnailEnhancementMinDim(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		thumbnailEnhancementFactor, err := ThumbnailEnhancementFactor(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		thumbnailEnhancementTargetMode, err := ThumbnailEnhancementTargetMode(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		thumbnailEnhancementTargetDim, err := ThumbnailEnhancementTargetDim(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		thumbnailEnhancementScheduleEnabled, err := ThumbnailEnhancementScheduleEnabled(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		thumbnailEnhancementRetentionDays, err := ThumbnailEnhancementRetentionDays(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		thumbnailEnhancementAutoApprove, err := ThumbnailEnhancementAutoApprove(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		thumbnailEnhancementAutoOnDownload, err := ThumbnailEnhancementAutoOnDownload(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		thumbnailEnhancementMaxPerSweep, err := ThumbnailEnhancementMaxPerSweep(c.Request.Context(), repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, SettingsResponse{
			DownloadDirectory:           mediaRoot,
			MaxConcurrentDownloads:      mgr.WorkerCount(),
			MaxConcurrentTranscodes:     ytdlp.MaxConcurrentTranscodes(),
			DownloadTimeoutMinutes:      downloadTimeoutMinutes,
			DefaultQuality:              defaultQuality,
			DefaultDownloadType:         defaultDownloadType,
			ImportIgnoredFolders:        ignoredFolders,
			HistoryAnonymizeURLs:        anonymizeHistory,
			HistoryRetentionDays:        historyRetentionDays,
			DownloadLogRetentionDays:    downloadLogRetentionDays,
			LibraryView:                 libraryView,
			LibrarySortKey:              librarySortKey,
			LibrarySortDir:              librarySortDir,
			LibraryMode:                 libraryMode,
			LibraryPaginationEnabled:    libraryPaginationEnabled,
			LibraryPageSize:             libraryPageSize,
			ThumbnailFrameCount:         thumbnailFrameCount,
			ImageConvertFormat:          imageConvertFormat,
			PrivacyEnabled:              privacyEnabled,
			PrivacyBlurStrength:         privacyBlurStrength,
			BrowseIgnorePrivacy:         browseIgnorePrivacy,
			SkipDownloadPreview:         skipDownloadPreview,
			JellyfinEnabled:             jellyfinEnabled,
			JellyfinURL:                 jellyfinURL,
			JellyfinAPIKey:              jellyfinAPIKey,
			JellyfinRefreshMode:         jellyfinRefreshMode,
			LibraryAutoplay:             libraryAutoplay,
			YtdlpCookiesBrowser:         ytdlpCookiesBrowser,
			YtdlpCookiesProfile:         ytdlpCookiesProfile,
			YtdlpProxy:                  ytdlpProxy,
			YtdlpRateLimit:              ytdlpRateLimit,
			YtdlpRetries:                ytdlpRetries,
			AutoBackupIntervalHours:     autoBackupIntervalHours,
			BackupRetentionCount:        backupRetentionCount,
			ResolutionTierMediumEnabled: resolutionTierMediumEnabled,
			ResolutionThresholdLow:      resolutionThresholdLow,
			ResolutionThresholdHigh:     resolutionThresholdHigh,

			ThumbnailResolutionTierMediumEnabled: thumbnailResolutionTierMediumEnabled,
			ThumbnailResolutionThresholdLow:      thumbnailResolutionThresholdLow,
			ThumbnailResolutionThresholdHigh:     thumbnailResolutionThresholdHigh,

			ThumbnailEnhancementEnabled:         thumbnailEnhancementEnabled,
			ThumbnailEnhancementURL:             thumbnailEnhancementURL,
			ThumbnailEnhancementUsername:        thumbnailEnhancementUsername,
			ThumbnailEnhancementPassword:        thumbnailEnhancementPassword,
			ThumbnailEnhancementUpscaler:        thumbnailEnhancementUpscaler,
			ThumbnailEnhancementMinDim:          thumbnailEnhancementMinDim,
			ThumbnailEnhancementFactor:          thumbnailEnhancementFactor,
			ThumbnailEnhancementTargetMode:      thumbnailEnhancementTargetMode,
			ThumbnailEnhancementTargetDim:       thumbnailEnhancementTargetDim,
			ThumbnailEnhancementScheduleEnabled: thumbnailEnhancementScheduleEnabled,
			ThumbnailEnhancementRetentionDays:   thumbnailEnhancementRetentionDays,
			ThumbnailEnhancementAutoApprove:     thumbnailEnhancementAutoApprove,
			ThumbnailEnhancementAutoOnDownload:  thumbnailEnhancementAutoOnDownload,
			ThumbnailEnhancementMaxPerSweep:     thumbnailEnhancementMaxPerSweep,
		})
	}
}

// UpdateSettings persists any provided fields and, for concurrency,
// applies the change to the live worker pool immediately rather than
// waiting for a restart.
func UpdateSettings(repo *repository.SettingsRepo, mgr *queue.DownloadManager, ytdlp *downloader.YtDlpService) gin.HandlerFunc {
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
		if req.MaxConcurrentTranscodes != nil {
			if err := repo.Set(c.Request.Context(), models.SettingMaxConcurrentTranscodes, strconv.Itoa(*req.MaxConcurrentTranscodes)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			ytdlp.SetMaxConcurrentTranscodes(*req.MaxConcurrentTranscodes)
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
		if req.AutoBackupIntervalHours != nil {
			if err := repo.Set(c.Request.Context(), models.SettingAutoBackupIntervalHours, strconv.Itoa(*req.AutoBackupIntervalHours)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.BackupRetentionCount != nil {
			if err := repo.Set(c.Request.Context(), models.SettingBackupRetentionCount, strconv.Itoa(*req.BackupRetentionCount)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.ResolutionTierMediumEnabled != nil {
			if err := repo.Set(c.Request.Context(), models.SettingResolutionTierMediumEnabled, strconv.FormatBool(*req.ResolutionTierMediumEnabled)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		// The low/high thresholds are validated together (low must stay below
		// high) even though they're independently-optional fields — resolve
		// whichever side isn't in this request from what's currently stored,
		// so a lone update can't silently invert the pair.
		if req.ResolutionThresholdLow != nil || req.ResolutionThresholdHigh != nil {
			effectiveLow := 0
			if req.ResolutionThresholdLow != nil {
				effectiveLow = *req.ResolutionThresholdLow
			} else {
				var err error
				effectiveLow, err = ResolutionThresholdLow(c.Request.Context(), repo)
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
			}
			effectiveHigh := 0
			if req.ResolutionThresholdHigh != nil {
				effectiveHigh = *req.ResolutionThresholdHigh
			} else {
				var err error
				effectiveHigh, err = ResolutionThresholdHigh(c.Request.Context(), repo)
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
			}
			if effectiveLow >= effectiveHigh {
				c.JSON(http.StatusBadRequest, gin.H{"error": "resolution low threshold must be less than the high threshold"})
				return
			}
			if req.ResolutionThresholdLow != nil {
				if err := repo.Set(c.Request.Context(), models.SettingResolutionThresholdLow, strconv.Itoa(*req.ResolutionThresholdLow)); err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
			}
			if req.ResolutionThresholdHigh != nil {
				if err := repo.Set(c.Request.Context(), models.SettingResolutionThresholdHigh, strconv.Itoa(*req.ResolutionThresholdHigh)); err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
			}
		}
		if req.ThumbnailResolutionTierMediumEnabled != nil {
			if err := repo.Set(c.Request.Context(), models.SettingThumbnailResolutionTierMediumEnabled, strconv.FormatBool(*req.ThumbnailResolutionTierMediumEnabled)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		// Mirrors the video resolution threshold pair above — resolve
		// whichever side isn't in this request from what's currently stored
		// so a lone update can't invert the pair.
		if req.ThumbnailResolutionThresholdLow != nil || req.ThumbnailResolutionThresholdHigh != nil {
			effectiveLow := 0
			if req.ThumbnailResolutionThresholdLow != nil {
				effectiveLow = *req.ThumbnailResolutionThresholdLow
			} else {
				var err error
				effectiveLow, err = ThumbnailResolutionThresholdLow(c.Request.Context(), repo)
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
			}
			effectiveHigh := 0
			if req.ThumbnailResolutionThresholdHigh != nil {
				effectiveHigh = *req.ThumbnailResolutionThresholdHigh
			} else {
				var err error
				effectiveHigh, err = ThumbnailResolutionThresholdHigh(c.Request.Context(), repo)
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
			}
			if effectiveLow >= effectiveHigh {
				c.JSON(http.StatusBadRequest, gin.H{"error": "thumbnail resolution low threshold must be less than the high threshold"})
				return
			}
			if req.ThumbnailResolutionThresholdLow != nil {
				if err := repo.Set(c.Request.Context(), models.SettingThumbnailResolutionThresholdLow, strconv.Itoa(*req.ThumbnailResolutionThresholdLow)); err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
			}
			if req.ThumbnailResolutionThresholdHigh != nil {
				if err := repo.Set(c.Request.Context(), models.SettingThumbnailResolutionThresholdHigh, strconv.Itoa(*req.ThumbnailResolutionThresholdHigh)); err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
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
		if req.ImageConvertFormat != nil {
			if err := repo.Set(c.Request.Context(), models.SettingImageConvertFormat, *req.ImageConvertFormat); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.PrivacyEnabled != nil {
			if err := repo.Set(c.Request.Context(), models.SettingPrivacyEnabled, strconv.FormatBool(*req.PrivacyEnabled)); err != nil {
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
		if req.ThumbnailEnhancementEnabled != nil {
			if err := repo.Set(c.Request.Context(), models.SettingThumbnailEnhancementEnabled, strconv.FormatBool(*req.ThumbnailEnhancementEnabled)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.ThumbnailEnhancementURL != nil {
			if err := repo.Set(c.Request.Context(), models.SettingThumbnailEnhancementURL, *req.ThumbnailEnhancementURL); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.ThumbnailEnhancementUsername != nil {
			if err := repo.Set(c.Request.Context(), models.SettingThumbnailEnhancementUsername, *req.ThumbnailEnhancementUsername); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.ThumbnailEnhancementPassword != nil {
			if err := repo.Set(c.Request.Context(), models.SettingThumbnailEnhancementPassword, *req.ThumbnailEnhancementPassword); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.ThumbnailEnhancementUpscaler != nil {
			if err := repo.Set(c.Request.Context(), models.SettingThumbnailEnhancementUpscaler, *req.ThumbnailEnhancementUpscaler); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.ThumbnailEnhancementMinDim != nil {
			if err := repo.Set(c.Request.Context(), models.SettingThumbnailEnhancementMinDim, strconv.Itoa(*req.ThumbnailEnhancementMinDim)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.ThumbnailEnhancementFactor != nil {
			if err := repo.Set(c.Request.Context(), models.SettingThumbnailEnhancementFactor, strconv.Itoa(*req.ThumbnailEnhancementFactor)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.ThumbnailEnhancementTargetMode != nil {
			if err := repo.Set(c.Request.Context(), models.SettingThumbnailEnhancementTargetMode, *req.ThumbnailEnhancementTargetMode); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.ThumbnailEnhancementTargetDim != nil {
			if err := repo.Set(c.Request.Context(), models.SettingThumbnailEnhancementTargetDim, strconv.Itoa(*req.ThumbnailEnhancementTargetDim)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.ThumbnailEnhancementScheduleEnabled != nil {
			if err := repo.Set(c.Request.Context(), models.SettingThumbnailEnhancementScheduleEnabled, strconv.FormatBool(*req.ThumbnailEnhancementScheduleEnabled)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.ThumbnailEnhancementRetentionDays != nil {
			if err := repo.Set(c.Request.Context(), models.SettingThumbnailEnhancementRetentionDays, strconv.Itoa(*req.ThumbnailEnhancementRetentionDays)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.ThumbnailEnhancementAutoApprove != nil {
			if err := repo.Set(c.Request.Context(), models.SettingThumbnailEnhancementAutoApprove, strconv.FormatBool(*req.ThumbnailEnhancementAutoApprove)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.ThumbnailEnhancementAutoOnDownload != nil {
			if err := repo.Set(c.Request.Context(), models.SettingThumbnailEnhancementAutoOnDownload, strconv.FormatBool(*req.ThumbnailEnhancementAutoOnDownload)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		if req.ThumbnailEnhancementMaxPerSweep != nil {
			if err := repo.Set(c.Request.Context(), models.SettingThumbnailEnhancementMaxPerSweep, strconv.Itoa(*req.ThumbnailEnhancementMaxPerSweep)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		c.Status(http.StatusNoContent)
	}
}

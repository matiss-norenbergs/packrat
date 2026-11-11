package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/backup"
	"packrat/backend/internal/downloader"
	"packrat/backend/internal/features"
	"packrat/backend/internal/models"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/sysevents"
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

// dashboardWidgetIDs is the allowlist of Dashboard blocks that can be hidden;
// keep in sync with DASHBOARD_WIDGETS in the frontend.
var dashboardWidgetIDs = map[string]bool{
	"downloads":     true,
	"library":       true,
	"libraryGrowth": true,
	"mediaTypes":    true,
	"resolutions":   true,
	"storage":       true,
	"topArtists":    true,
	"topTags":       true,
}

// DashboardHiddenWidgets reads and JSON-decodes the dashboard_hidden_widgets
// setting, defaulting to an empty list (everything visible) if it's never been
// set. Unknown IDs (e.g. a widget since removed) are dropped. Shared by
// GetSettings.
func DashboardHiddenWidgets(ctx context.Context, repo *repository.SettingsRepo) ([]string, error) {
	raw, err := repo.Get(ctx, models.SettingDashboardHiddenWidgets)
	if errors.Is(err, repository.ErrNotFound) {
		return []string{}, nil
	}
	if err != nil {
		return nil, err
	}
	var ids []string
	if err := json.Unmarshal([]byte(raw), &ids); err != nil {
		return []string{}, nil
	}
	out, _ := normalizeDashboardWidgetIDs(ids)
	return out, nil
}

// normalizeDashboardWidgetIDs de-dupes ids (keeping first-seen order) and
// drops unknown ones, returning them as the second value so the PATCH handler
// can reject them while the reader just ignores them.
func normalizeDashboardWidgetIDs(ids []string) (valid, unknown []string) {
	seen := make(map[string]bool, len(ids))
	valid = make([]string, 0, len(ids))
	for _, id := range ids {
		if !dashboardWidgetIDs[id] {
			unknown = append(unknown, id)
			continue
		}
		if !seen[id] {
			seen[id] = true
			valid = append(valid, id)
		}
	}
	return valid, unknown
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

// defaultThumbnailFrameRangeLow/High are the pick-range defaults — the
// middle 5%-100% of the video, matching pickFrameTimestamps' historical
// hardcoded behavior before this became configurable.
const (
	defaultThumbnailFrameRangeLow  = 5
	defaultThumbnailFrameRangeHigh = 100
)

// ThumbnailFrameRangeLow reads the thumbnail_frame_range_low setting
// (percent of video duration), defaulting to defaultThumbnailFrameRangeLow
// if it's never been set or is corrupt. Shared by GetSettings and
// GetLibraryThumbnailCandidates/QuickGrabLibraryThumbnail.
func ThumbnailFrameRangeLow(ctx context.Context, repo *repository.SettingsRepo) (int, error) {
	raw, err := repo.Get(ctx, models.SettingThumbnailFrameRangeLow)
	if errors.Is(err, repository.ErrNotFound) {
		return defaultThumbnailFrameRangeLow, nil
	}
	if err != nil {
		return defaultThumbnailFrameRangeLow, err
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return defaultThumbnailFrameRangeLow, nil
	}
	return n, nil
}

// ThumbnailFrameRangeHigh mirrors ThumbnailFrameRangeLow for the range's
// upper bound.
func ThumbnailFrameRangeHigh(ctx context.Context, repo *repository.SettingsRepo) (int, error) {
	raw, err := repo.Get(ctx, models.SettingThumbnailFrameRangeHigh)
	if errors.Is(err, repository.ErrNotFound) {
		return defaultThumbnailFrameRangeHigh, nil
	}
	if err != nil {
		return defaultThumbnailFrameRangeHigh, err
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return defaultThumbnailFrameRangeHigh, nil
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

// YtdlpCookiesFile reads the ytdlp_cookies_file setting (raw cookies.txt
// content), defaulting to "" (disabled) if it's never been set. Shared by
// GetSettings.
func YtdlpCookiesFile(ctx context.Context, repo *repository.SettingsRepo) (string, error) {
	raw, err := repo.Get(ctx, models.SettingYtdlpCookiesFile)
	if errors.Is(err, repository.ErrNotFound) {
		return "", nil
	}
	return raw, err
}

// writeCookiesFile keeps the on-disk cookies file (see
// YtDlpService.CookiesFilePath) matching content: non-empty content is
// written, empty content removes the file rather than leaving a stale one
// yt-dlp would still pick up. 0600 since cookies.txt can carry live session
// cookies. It is the only place that touches the file, and reports whether
// it changed anything (a file that already matches is left alone).
func writeCookiesFile(path, content string) (changed bool, err error) {
	if path == "" {
		return false, nil
	}
	if content == "" {
		if err := os.Remove(path); err != nil {
			if os.IsNotExist(err) {
				return false, nil
			}
			return false, err
		}
		return true, nil
	}
	if current, err := os.ReadFile(path); err == nil && string(current) == content {
		return false, nil
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return false, err
	}
	return true, nil
}

// SyncCookiesFile makes the on-disk cookies file match the ytdlp_cookies_file
// setting. Called after a settings PATCH that includes the field, after a
// settings import / full restore (which write the row but not the file), and
// once at startup so a missing or stale file is reconciled with the database.
// The content is never logged.
func SyncCookiesFile(ctx context.Context, repo *repository.SettingsRepo, ytdlp *downloader.YtDlpService) (changed bool, err error) {
	if ytdlp == nil {
		return false, nil
	}
	content, err := YtdlpCookiesFile(ctx, repo)
	if err != nil {
		return false, err
	}
	return writeCookiesFile(ytdlp.CookiesFilePath, content)
}

// syncCookiesFileAfterRestore runs SyncCookiesFile for an import / restore.
// The settings are already committed, so a failure to write the file is
// logged rather than failing the whole restore.
func syncCookiesFileAfterRestore(ctx context.Context, repo *repository.SettingsRepo, ytdlp *downloader.YtDlpService) {
	if _, err := SyncCookiesFile(ctx, repo, ytdlp); err != nil {
		log.Printf("settings: syncing the yt-dlp cookies file after a restore failed: %v", err)
	}
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
			writeServerError(c, err)
			return
		}
		defaultDownloadType, err := repo.Get(c.Request.Context(), models.SettingDefaultDownloadType)
		if err != nil {
			writeServerError(c, err)
			return
		}

		downloadTimeoutMinutes, err := DownloadTimeoutMinutes(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		ignoredFolders, err := ImportIgnoredFolders(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		anonymizeHistory, err := HistoryAnonymizeURLs(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		historyRetentionDays, err := HistoryRetentionDays(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		downloadLogRetentionDays, err := DownloadLogRetentionDays(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		libraryView, err := LibraryView(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		libraryMode, err := LibraryMode(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		libraryPaginationEnabled, err := LibraryPaginationEnabled(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		dashboardHiddenWidgets, err := DashboardHiddenWidgets(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		libraryPageSize, err := LibraryPageSize(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		thumbnailFrameCount, err := ThumbnailFrameCount(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		thumbnailFrameRangeLow, err := ThumbnailFrameRangeLow(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		thumbnailFrameRangeHigh, err := ThumbnailFrameRangeHigh(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		imageConvertFormat, err := ImageConvertFormat(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		privacyEnabled, err := PrivacyEnabled(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		privacyBlurStrength, err := PrivacyBlurStrength(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		browseIgnorePrivacy, err := BrowseIgnorePrivacy(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		skipDownloadPreview, err := SkipDownloadPreview(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		jellyfinEnabled, err := JellyfinEnabled(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		jellyfinURL, err := repo.Get(c.Request.Context(), models.SettingJellyfinURL)
		if err != nil && !errors.Is(err, repository.ErrNotFound) {
			writeServerError(c, err)
			return
		}
		jellyfinAPIKey, err := repo.Get(c.Request.Context(), models.SettingJellyfinAPIKey)
		if err != nil && !errors.Is(err, repository.ErrNotFound) {
			writeServerError(c, err)
			return
		}
		jellyfinRefreshMode, err := JellyfinRefreshMode(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		libraryAutoplay, err := LibraryAutoplay(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		ytdlpCookiesBrowser, err := YtdlpCookiesBrowser(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		ytdlpCookiesProfile, err := YtdlpCookiesProfile(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		ytdlpCookiesFile, err := YtdlpCookiesFile(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		ytdlpProxy, err := YtdlpProxy(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		ytdlpRateLimit, err := YtdlpRateLimit(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		ytdlpRetries, err := YtdlpRetries(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		autoBackupIntervalHours, err := AutoBackupIntervalHours(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		backupRetentionCount, err := BackupRetentionCount(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		resolutionTierMediumEnabled, err := ResolutionTierMediumEnabled(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		resolutionThresholdLow, err := ResolutionThresholdLow(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		resolutionThresholdHigh, err := ResolutionThresholdHigh(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		thumbnailResolutionTierMediumEnabled, err := ThumbnailResolutionTierMediumEnabled(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		thumbnailResolutionThresholdLow, err := ThumbnailResolutionThresholdLow(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		thumbnailResolutionThresholdHigh, err := ThumbnailResolutionThresholdHigh(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		thumbnailEnhancementEnabled, err := ThumbnailEnhancementEnabled(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		thumbnailEnhancementURL, err := repo.Get(c.Request.Context(), models.SettingThumbnailEnhancementURL)
		if err != nil && !errors.Is(err, repository.ErrNotFound) {
			writeServerError(c, err)
			return
		}
		thumbnailEnhancementUsername, err := repo.Get(c.Request.Context(), models.SettingThumbnailEnhancementUsername)
		if err != nil && !errors.Is(err, repository.ErrNotFound) {
			writeServerError(c, err)
			return
		}
		thumbnailEnhancementPassword, err := repo.Get(c.Request.Context(), models.SettingThumbnailEnhancementPassword)
		if err != nil && !errors.Is(err, repository.ErrNotFound) {
			writeServerError(c, err)
			return
		}
		thumbnailEnhancementUpscaler, err := ThumbnailEnhancementUpscaler(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		thumbnailEnhancementMinDim, err := ThumbnailEnhancementMinDim(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		thumbnailEnhancementFactor, err := ThumbnailEnhancementFactor(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		thumbnailEnhancementTargetMode, err := ThumbnailEnhancementTargetMode(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		thumbnailEnhancementTargetDim, err := ThumbnailEnhancementTargetDim(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		thumbnailEnhancementScheduleEnabled, err := ThumbnailEnhancementScheduleEnabled(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		thumbnailEnhancementRetentionDays, err := ThumbnailEnhancementRetentionDays(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		thumbnailEnhancementAutoApprove, err := ThumbnailEnhancementAutoApprove(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		thumbnailEnhancementAutoOnDownload, err := ThumbnailEnhancementAutoOnDownload(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		thumbnailEnhancementMaxPerSweep, err := ThumbnailEnhancementMaxPerSweep(c.Request.Context(), repo)
		if err != nil {
			writeServerError(c, err)
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
			LibraryMode:                 libraryMode,
			LibraryPaginationEnabled:    libraryPaginationEnabled,
			LibraryPageSize:             libraryPageSize,
			DashboardHiddenWidgets:      dashboardHiddenWidgets,
			ThumbnailFrameCount:         thumbnailFrameCount,
			ThumbnailFrameRangeLow:      thumbnailFrameRangeLow,
			ThumbnailFrameRangeHigh:     thumbnailFrameRangeHigh,
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
			YtdlpCookiesFile:            ytdlpCookiesFile,
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

			FeatureSubscriptionsEnabled:         features.Enabled(c.Request.Context(), repo, models.SettingFeatureSubscriptionsEnabled),
			FeatureFrameMatchingEnabled:         features.Enabled(c.Request.Context(), repo, models.SettingFeatureFrameMatchingEnabled),
			FeatureCompareListEnabled:           features.Enabled(c.Request.Context(), repo, models.SettingFeatureCompareListEnabled),
			FeatureFileImportEnabled:            features.Enabled(c.Request.Context(), repo, models.SettingFeatureFileImportEnabled),
			FeatureSystemEventsEnabled:          features.Enabled(c.Request.Context(), repo, models.SettingFeatureSystemEventsEnabled),
			SystemEventsRetentionCount:          sysevents.RetentionCount(c.Request.Context(), repo),
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
// onSubscriptionsEnabled, if non-nil, is called after the Subscriptions feature
// goes from off to on, so subscriptions that came due while it was off run
// straight away instead of waiting for the next hourly sweep.
func UpdateSettings(repo *repository.SettingsRepo, mgr *queue.DownloadManager, ytdlp *downloader.YtDlpService, eventsRepo *repository.SystemEventsRepo, onSubscriptionsEnabled func()) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req UpdateSettingsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// Three phases: (1) validate everything and collect the writes into
		// pending, (2) commit them in one transaction, (3) apply the live side
		// effects. A request that fails validation changes nothing.
		pending := make(map[string]string)
		subscriptionsTurnedOn := false

		if req.MaxConcurrentDownloads != nil {
			if *req.MaxConcurrentDownloads > models.MaxConcurrentDownloadsLimit {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("maxConcurrentDownloads must be between 1 and %d", models.MaxConcurrentDownloadsLimit)})
				return
			}
			pending[models.SettingMaxConcurrentDownloads] = strconv.Itoa(*req.MaxConcurrentDownloads)
		}
		if req.MaxConcurrentTranscodes != nil {
			pending[models.SettingMaxConcurrentTranscodes] = strconv.Itoa(*req.MaxConcurrentTranscodes)
		}
		if req.DownloadTimeoutMinutes != nil {
			pending[models.SettingDownloadTimeoutMinutes] = strconv.Itoa(*req.DownloadTimeoutMinutes)
		}
		if req.DefaultQuality != nil {
			pending[models.SettingDefaultQuality] = *req.DefaultQuality
		}
		if req.DefaultDownloadType != nil {
			pending[models.SettingDefaultDownloadType] = *req.DefaultDownloadType
		}
		if req.ImportIgnoredFolders != nil {
			encoded, err := json.Marshal(*req.ImportIgnoredFolders)
			if err != nil {
				writeServerError(c, err)
				return
			}
			pending[models.SettingImportIgnoredFolders] = string(encoded)
		}
		if req.HistoryAnonymizeURLs != nil {
			pending[models.SettingHistoryAnonymizeURLs] = strconv.FormatBool(*req.HistoryAnonymizeURLs)
		}
		if req.HistoryRetentionDays != nil {
			pending[models.SettingHistoryRetentionDays] = strconv.Itoa(*req.HistoryRetentionDays)
		}
		if req.DownloadLogRetentionDays != nil {
			pending[models.SettingDownloadLogRetentionDays] = strconv.Itoa(*req.DownloadLogRetentionDays)
		}
		if req.AutoBackupIntervalHours != nil {
			pending[models.SettingAutoBackupIntervalHours] = strconv.Itoa(*req.AutoBackupIntervalHours)
		}
		if req.BackupRetentionCount != nil {
			pending[models.SettingBackupRetentionCount] = strconv.Itoa(*req.BackupRetentionCount)
		}
		if req.ResolutionTierMediumEnabled != nil {
			pending[models.SettingResolutionTierMediumEnabled] = strconv.FormatBool(*req.ResolutionTierMediumEnabled)
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
					writeServerError(c, err)
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
					writeServerError(c, err)
					return
				}
			}
			if effectiveLow >= effectiveHigh {
				c.JSON(http.StatusBadRequest, gin.H{"error": "resolution low threshold must be less than the high threshold"})
				return
			}
			if req.ResolutionThresholdLow != nil {
				pending[models.SettingResolutionThresholdLow] = strconv.Itoa(*req.ResolutionThresholdLow)
			}
			if req.ResolutionThresholdHigh != nil {
				pending[models.SettingResolutionThresholdHigh] = strconv.Itoa(*req.ResolutionThresholdHigh)
			}
		}
		if req.ThumbnailResolutionTierMediumEnabled != nil {
			pending[models.SettingThumbnailResolutionTierMediumEnabled] = strconv.FormatBool(*req.ThumbnailResolutionTierMediumEnabled)
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
					writeServerError(c, err)
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
					writeServerError(c, err)
					return
				}
			}
			if effectiveLow >= effectiveHigh {
				c.JSON(http.StatusBadRequest, gin.H{"error": "thumbnail resolution low threshold must be less than the high threshold"})
				return
			}
			if req.ThumbnailResolutionThresholdLow != nil {
				pending[models.SettingThumbnailResolutionThresholdLow] = strconv.Itoa(*req.ThumbnailResolutionThresholdLow)
			}
			if req.ThumbnailResolutionThresholdHigh != nil {
				pending[models.SettingThumbnailResolutionThresholdHigh] = strconv.Itoa(*req.ThumbnailResolutionThresholdHigh)
			}
		}
		if req.LibraryView != nil {
			pending[models.SettingLibraryView] = *req.LibraryView
		}
		if req.LibraryMode != nil {
			pending[models.SettingLibraryMode] = *req.LibraryMode
		}
		if req.LibraryPaginationEnabled != nil {
			pending[models.SettingLibraryPaginationEnabled] = strconv.FormatBool(*req.LibraryPaginationEnabled)
		}
		if req.LibraryPageSize != nil {
			pending[models.SettingLibraryPageSize] = strconv.Itoa(*req.LibraryPageSize)
		}
		if req.DashboardHiddenWidgets != nil {
			ids, unknown := normalizeDashboardWidgetIDs(*req.DashboardHiddenWidgets)
			if len(unknown) > 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "unknown dashboard widget: " + unknown[0]})
				return
			}
			encoded, err := json.Marshal(ids)
			if err != nil {
				writeServerError(c, err)
				return
			}
			pending[models.SettingDashboardHiddenWidgets] = string(encoded)
		}
		if req.ThumbnailFrameCount != nil {
			pending[models.SettingThumbnailFrameCount] = strconv.Itoa(*req.ThumbnailFrameCount)
		}
		// Mirrors the resolution threshold pairs above — resolve whichever
		// side isn't in this request from what's currently stored, so a lone
		// update can't invert the pair.
		if req.ThumbnailFrameRangeLow != nil || req.ThumbnailFrameRangeHigh != nil {
			effectiveLow := 0
			if req.ThumbnailFrameRangeLow != nil {
				effectiveLow = *req.ThumbnailFrameRangeLow
			} else {
				var err error
				effectiveLow, err = ThumbnailFrameRangeLow(c.Request.Context(), repo)
				if err != nil {
					writeServerError(c, err)
					return
				}
			}
			effectiveHigh := 0
			if req.ThumbnailFrameRangeHigh != nil {
				effectiveHigh = *req.ThumbnailFrameRangeHigh
			} else {
				var err error
				effectiveHigh, err = ThumbnailFrameRangeHigh(c.Request.Context(), repo)
				if err != nil {
					writeServerError(c, err)
					return
				}
			}
			if effectiveLow >= effectiveHigh {
				c.JSON(http.StatusBadRequest, gin.H{"error": "thumbnail frame range low must be less than the high bound"})
				return
			}
			if req.ThumbnailFrameRangeLow != nil {
				pending[models.SettingThumbnailFrameRangeLow] = strconv.Itoa(*req.ThumbnailFrameRangeLow)
			}
			if req.ThumbnailFrameRangeHigh != nil {
				pending[models.SettingThumbnailFrameRangeHigh] = strconv.Itoa(*req.ThumbnailFrameRangeHigh)
			}
		}
		if req.ImageConvertFormat != nil {
			pending[models.SettingImageConvertFormat] = *req.ImageConvertFormat
		}
		if req.PrivacyEnabled != nil {
			pending[models.SettingPrivacyEnabled] = strconv.FormatBool(*req.PrivacyEnabled)
		}
		if req.PrivacyBlurStrength != nil {
			pending[models.SettingPrivacyBlurStrength] = *req.PrivacyBlurStrength
		}
		if req.BrowseIgnorePrivacy != nil {
			pending[models.SettingBrowseIgnorePrivacy] = strconv.FormatBool(*req.BrowseIgnorePrivacy)
		}
		if req.SkipDownloadPreview != nil {
			pending[models.SettingSkipDownloadPreview] = strconv.FormatBool(*req.SkipDownloadPreview)
		}
		if req.JellyfinEnabled != nil {
			pending[models.SettingJellyfinEnabled] = strconv.FormatBool(*req.JellyfinEnabled)
		}
		if req.JellyfinURL != nil {
			pending[models.SettingJellyfinURL] = *req.JellyfinURL
		}
		if req.JellyfinRefreshMode != nil {
			pending[models.SettingJellyfinRefreshMode] = *req.JellyfinRefreshMode
		}
		if req.JellyfinAPIKey != nil {
			pending[models.SettingJellyfinAPIKey] = *req.JellyfinAPIKey
		}
		if req.LibraryAutoplay != nil {
			pending[models.SettingLibraryAutoplay] = strconv.FormatBool(*req.LibraryAutoplay)
		}
		if req.YtdlpCookiesBrowser != nil {
			pending[models.SettingYtdlpCookiesBrowser] = *req.YtdlpCookiesBrowser
		}
		if req.YtdlpCookiesProfile != nil {
			pending[models.SettingYtdlpCookiesProfile] = *req.YtdlpCookiesProfile
		}
		if req.YtdlpCookiesFile != nil {
			pending[models.SettingYtdlpCookiesFile] = *req.YtdlpCookiesFile
		}
		if req.YtdlpProxy != nil {
			pending[models.SettingYtdlpProxy] = *req.YtdlpProxy
		}
		if req.YtdlpRateLimit != nil {
			pending[models.SettingYtdlpRateLimit] = *req.YtdlpRateLimit
		}
		if req.YtdlpRetries != nil {
			pending[models.SettingYtdlpRetries] = strconv.Itoa(*req.YtdlpRetries)
		}
		for _, f := range []struct {
			val *bool
			key string
		}{
			{req.FeatureSubscriptionsEnabled, models.SettingFeatureSubscriptionsEnabled},
			{req.FeatureFrameMatchingEnabled, models.SettingFeatureFrameMatchingEnabled},
			{req.FeatureCompareListEnabled, models.SettingFeatureCompareListEnabled},
			{req.FeatureFileImportEnabled, models.SettingFeatureFileImportEnabled},
			{req.FeatureSystemEventsEnabled, models.SettingFeatureSystemEventsEnabled},
		} {
			if f.val == nil {
				continue
			}
			wasOn := features.Enabled(c.Request.Context(), repo, f.key)
			pending[f.key] = strconv.FormatBool(*f.val)
			if f.key == models.SettingFeatureSubscriptionsEnabled && *f.val && !wasOn {
				subscriptionsTurnedOn = true
			}
		}
		if req.SystemEventsRetentionCount != nil {
			pending[models.SettingSystemEventsRetentionCount] = strconv.Itoa(*req.SystemEventsRetentionCount)
		}
		if req.ThumbnailEnhancementEnabled != nil {
			pending[models.SettingThumbnailEnhancementEnabled] = strconv.FormatBool(*req.ThumbnailEnhancementEnabled)
		}
		if req.ThumbnailEnhancementURL != nil {
			pending[models.SettingThumbnailEnhancementURL] = *req.ThumbnailEnhancementURL
		}
		if req.ThumbnailEnhancementUsername != nil {
			pending[models.SettingThumbnailEnhancementUsername] = *req.ThumbnailEnhancementUsername
		}
		if req.ThumbnailEnhancementPassword != nil {
			pending[models.SettingThumbnailEnhancementPassword] = *req.ThumbnailEnhancementPassword
		}
		if req.ThumbnailEnhancementUpscaler != nil {
			pending[models.SettingThumbnailEnhancementUpscaler] = *req.ThumbnailEnhancementUpscaler
		}
		if req.ThumbnailEnhancementMinDim != nil {
			pending[models.SettingThumbnailEnhancementMinDim] = strconv.Itoa(*req.ThumbnailEnhancementMinDim)
		}
		if req.ThumbnailEnhancementFactor != nil {
			pending[models.SettingThumbnailEnhancementFactor] = strconv.Itoa(*req.ThumbnailEnhancementFactor)
		}
		if req.ThumbnailEnhancementTargetMode != nil {
			pending[models.SettingThumbnailEnhancementTargetMode] = *req.ThumbnailEnhancementTargetMode
		}
		if req.ThumbnailEnhancementTargetDim != nil {
			pending[models.SettingThumbnailEnhancementTargetDim] = strconv.Itoa(*req.ThumbnailEnhancementTargetDim)
		}
		if req.ThumbnailEnhancementScheduleEnabled != nil {
			pending[models.SettingThumbnailEnhancementScheduleEnabled] = strconv.FormatBool(*req.ThumbnailEnhancementScheduleEnabled)
		}
		if req.ThumbnailEnhancementRetentionDays != nil {
			pending[models.SettingThumbnailEnhancementRetentionDays] = strconv.Itoa(*req.ThumbnailEnhancementRetentionDays)
		}
		if req.ThumbnailEnhancementAutoApprove != nil {
			pending[models.SettingThumbnailEnhancementAutoApprove] = strconv.FormatBool(*req.ThumbnailEnhancementAutoApprove)
		}
		if req.ThumbnailEnhancementAutoOnDownload != nil {
			pending[models.SettingThumbnailEnhancementAutoOnDownload] = strconv.FormatBool(*req.ThumbnailEnhancementAutoOnDownload)
		}
		if req.ThumbnailEnhancementMaxPerSweep != nil {
			pending[models.SettingThumbnailEnhancementMaxPerSweep] = strconv.Itoa(*req.ThumbnailEnhancementMaxPerSweep)
		}

		if len(pending) > 0 {
			if err := repo.SetMany(c.Request.Context(), pending); err != nil {
				writeServerError(c, err)
				return
			}
		}

		// Phase 3: the write is committed, so apply the live side effects.
		applySettingsSideEffects(pending, mgr, ytdlp)
		if _, ok := pending[models.SettingYtdlpCookiesFile]; ok {
			if _, err := SyncCookiesFile(c.Request.Context(), repo, ytdlp); err != nil {
				writeServerError(c, err)
				return
			}
		}
		// A lower (or newly set) retention count takes effect now, not at the next hourly sweep.
		if _, ok := pending[models.SettingSystemEventsRetentionCount]; ok {
			sysevents.Prune(c.Request.Context(), eventsRepo, repo)
		}
		if subscriptionsTurnedOn && onSubscriptionsEnabled != nil {
			onSubscriptionsEnabled()
		}
		c.Status(http.StatusNoContent)
	}
}

// applySettingsSideEffects pushes the live-process settings from a just-written
// settings map into the running components: GetSettings reports
// maxConcurrentDownloads from the worker pool, not the row, so writing the row
// alone does not change it. Shared by UpdateSettings, ImportSettings and the
// full-restore path. Only keys present in the map are applied; values that are
// not a positive integer (imported settings are written verbatim) are skipped.
// Call it only after the write has committed.
func applySettingsSideEffects(settings map[string]string, mgr *queue.DownloadManager, ytdlp *downloader.YtDlpService) {
	if raw, ok := settings[models.SettingMaxConcurrentDownloads]; ok && mgr != nil {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			mgr.SetWorkerCount(n)
		}
	}
	if raw, ok := settings[models.SettingMaxConcurrentTranscodes]; ok && ytdlp != nil {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			ytdlp.SetMaxConcurrentTranscodes(n)
		}
	}
}

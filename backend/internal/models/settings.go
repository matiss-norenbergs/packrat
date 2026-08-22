package models

// Settings keys stored in the key/value settings table. The spec's yt-dlp
// and ffmpeg Settings sections are not wired up yet.
const (
	SettingDownloadDirectory        = "download_directory"
	SettingMaxConcurrentDownloads   = "max_concurrent_downloads"
	SettingMaxConcurrentTranscodes  = "max_concurrent_ffmpeg_transcodes"
	SettingDownloadTimeoutMinutes   = "download_timeout_minutes" // minutes; 0 = no timeout (default)
	SettingDefaultQuality           = "default_quality"
	SettingDefaultDownloadType      = "default_download_type"
	SettingImportIgnoredFolders     = "import_ignored_folders"
	SettingHistoryAnonymizeURLs     = "history_anonymize_urls"
	SettingHistoryRetentionDays     = "history_retention_days"      // days; 0 = keep forever (default)
	SettingDownloadLogRetentionDays = "download_log_retention_days" // days; 0 = keep forever (default)
	SettingLibraryView              = "library_view"
	SettingLibrarySort              = "library_sort"               // stored as "<sortKey>:<sortDir>", e.g. "title:asc"
	SettingLibraryMode              = "library_mode"               // "manage" | "details"
	SettingLibraryPaginationEnabled = "library_pagination_enabled" // bool, default false — off shows every item
	SettingLibraryPageSize          = "library_page_size"
	SettingThumbnailFrameCount      = "thumbnail_frame_count"
	// SettingImageConvertFormat controls what format a downloaded "image"
	// item's file gets converted to on ingest — "original" leaves it as
	// fetched. Matches the existing convention that video thumbnails always
	// get normalized to JPEG (yt-dlp's --convert-thumbnails jpg).
	SettingImageConvertFormat = "image_convert_format" // "original" | "jpg" | "png" | "webp"; default "jpg"
	SettingPrivacyEnabled           = "privacy_enabled"       // bool, default false — master switch for the whole privacy workflow
	SettingPrivacyBlurStrength      = "privacy_blur_strength" // "weak" | "default" | "strong"
	SettingBrowseIgnorePrivacy      = "browse_ignore_privacy" // bool, default false — Browse-page-only override, doesn't affect Library
	SettingSkipDownloadPreview      = "skip_download_preview" // bool, true = skip the New Download preview card
	SettingJellyfinEnabled          = "jellyfin_enabled"
	SettingJellyfinURL              = "jellyfin_url"
	SettingJellyfinAPIKey           = "jellyfin_api_key"
	SettingJellyfinRefreshMode      = "jellyfin_refresh_mode"      // "entire" | "specific" | "none"; default "none"
	SettingLibraryAutoplay          = "library_autoplay"           // bool, default true — matches the player's pre-existing hardcoded behavior
	SettingYtdlpCookiesBrowser      = "ytdlp_cookies_browser"      // "" | one of yt-dlp's supported browser names; "" = disabled
	SettingYtdlpCookiesProfile      = "ytdlp_cookies_profile"      // optional profile name, only meaningful when CookiesBrowser is set
	SettingYtdlpProxy               = "ytdlp_proxy"                // e.g. "socks5://127.0.0.1:1080"; "" = disabled
	SettingYtdlpRateLimit           = "ytdlp_rate_limit"           // e.g. "500K"; "" = disabled
	SettingYtdlpRetries             = "ytdlp_retries"              // int as string; 0 = yt-dlp's own default (10), not passed explicitly
	SettingAutoBackupIntervalHours  = "auto_backup_interval_hours" // hours; 0 = disabled (default)
	SettingBackupRetentionCount     = "backup_retention_count"     // count; 0 = unlimited; default backup.DefaultBackupRetentionCount

	SettingResolutionTierMediumEnabled = "resolution_tier_medium_enabled" // bool, default true
	SettingResolutionThresholdLow      = "resolution_threshold_low"       // height in px; default 720 — at/below is "low"
	SettingResolutionThresholdHigh     = "resolution_threshold_high"      // height in px; default 2160 — at/above is "high"

	// Thumbnail resolution tiers — separate from the tiers above, since a
	// thumbnail is a small preview image with a much narrower practical
	// range than a video (rarely exceeds 1080p), so it needs lower defaults
	// rather than sharing the video thresholds.
	SettingThumbnailResolutionTierMediumEnabled = "thumbnail_resolution_tier_medium_enabled" // bool, default true
	SettingThumbnailResolutionThresholdLow      = "thumbnail_resolution_threshold_low"        // height in px; default 480 — at/below is "low"
	SettingThumbnailResolutionThresholdHigh     = "thumbnail_resolution_threshold_high"       // height in px; default 1080 — at/above is "high"

	// AI thumbnail enhancement — opt-in, off by default. Upscales library
	// thumbnails via a user-supplied local Stable Diffusion WebUI
	// (AUTOMATIC1111-compatible) instance's /sdapi/v1/extra-single-image
	// endpoint. Username/Password are only meaningful if that instance was
	// launched with --api-auth.
	SettingThumbnailEnhancementEnabled  = "thumbnail_enhancement_enabled"
	SettingThumbnailEnhancementURL      = "thumbnail_enhancement_url"
	SettingThumbnailEnhancementUsername = "thumbnail_enhancement_username"
	SettingThumbnailEnhancementPassword = "thumbnail_enhancement_password"
	SettingThumbnailEnhancementUpscaler = "thumbnail_enhancement_upscaler" // default "R-ESRGAN 4x+"
	SettingThumbnailEnhancementMinDim   = "thumbnail_enhancement_min_dim"  // int as string; default "720"
	SettingThumbnailEnhancementFactor   = "thumbnail_enhancement_factor"   // int as string; default "4"
	// SettingThumbnailEnhancementTargetMode picks what Factor above means:
	// "factor" (default) multiplies the original dimensions by
	// SettingThumbnailEnhancementFactor; "resolution" instead scales each
	// thumbnail so its longest side lands at SettingThumbnailEnhancementTargetDim,
	// computing a per-image multiplier on the fly (A1111's upscaling_resize
	// accepts a fractional multiplier, so this doesn't require a different
	// API call — just a different number).
	SettingThumbnailEnhancementTargetMode = "thumbnail_enhancement_target_mode" // "factor" | "resolution"; default "factor"
	SettingThumbnailEnhancementTargetDim  = "thumbnail_enhancement_target_dim"  // int as string; default "1920" (1080p on a 16:9 thumbnail)
	// SettingThumbnailEnhancementScheduleEnabled controls only the hourly
	// automatic sweep (RunDueEnhancements) — the manual "Enhance now"
	// trigger (RunOnce) ignores it and only checks the master Enabled flag
	// above, so turning this off lets the feature stay usable purely
	// on-demand without the background sweep ever running.
	SettingThumbnailEnhancementScheduleEnabled = "thumbnail_enhancement_schedule_enabled" // bool, default true
	// SettingThumbnailEnhancementRetentionDays mirrors SettingHistoryRetentionDays/
	// SettingDownloadLogRetentionDays — how long completed history rows (and, for
	// the last row referencing a given item, its original-thumbnail backup) are
	// kept before the hourly sweep deletes them.
	SettingThumbnailEnhancementRetentionDays = "thumbnail_enhancement_retention_days" // days; 0 = keep forever (default)
	// SettingThumbnailEnhancementAutoApprove, when true, skips backing up the
	// pre-enhancement thumbnail entirely — the enhanced result just commits,
	// with no Compare/Revert available for that item. Applies globally,
	// across every trigger (manual, scheduled, auto-on-download), not just
	// the auto-on-download one below.
	SettingThumbnailEnhancementAutoApprove = "thumbnail_enhancement_auto_approve" // bool, default false
	// SettingThumbnailEnhancementAutoOnDownload, when true, enhances a
	// freshly-downloaded item's thumbnail immediately after the download
	// completes (if it's under the configured minDim), rather than waiting
	// for the next scheduled sweep. Fresh downloads only, not redownloads.
	SettingThumbnailEnhancementAutoOnDownload = "thumbnail_enhancement_auto_on_download" // bool, default false
	// SettingThumbnailEnhancementMaxPerSweep bounds how many items one batch
	// run (a scheduled sweep or a manual "Enhance now" click) processes, so
	// a large backlog can't run unboundedly long against a local, often
	// slow, upscaler. Doesn't apply to a direct per-item Enhance click,
	// which always processes exactly the one item picked.
	SettingThumbnailEnhancementMaxPerSweep = "thumbnail_enhancement_max_per_sweep" // int as string; default "5"
)

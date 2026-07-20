package models

// Settings keys stored in the key/value settings table. The spec's yt-dlp
// and ffmpeg Settings sections are not wired up yet.
const (
	SettingDownloadDirectory        = "download_directory"
	SettingMaxConcurrentDownloads   = "max_concurrent_downloads"
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
	SettingPrivacyBlurStrength      = "privacy_blur_strength" // "weak" | "default" | "strong"
	SettingSkipDownloadPreview      = "skip_download_preview" // bool, true = skip the New Download preview card
	SettingJellyfinEnabled          = "jellyfin_enabled"
	SettingJellyfinURL              = "jellyfin_url"
	SettingJellyfinAPIKey           = "jellyfin_api_key"
	SettingJellyfinRefreshMode      = "jellyfin_refresh_mode" // "entire" | "specific" | "none"; default "none"
	SettingLibraryAutoplay          = "library_autoplay"      // bool, default true — matches the player's pre-existing hardcoded behavior
	SettingYtdlpCookiesBrowser      = "ytdlp_cookies_browser" // "" | one of yt-dlp's supported browser names; "" = disabled
	SettingYtdlpCookiesProfile      = "ytdlp_cookies_profile" // optional profile name, only meaningful when CookiesBrowser is set
	SettingYtdlpProxy               = "ytdlp_proxy"           // e.g. "socks5://127.0.0.1:1080"; "" = disabled
	SettingYtdlpRateLimit           = "ytdlp_rate_limit"      // e.g. "500K"; "" = disabled
	SettingYtdlpRetries             = "ytdlp_retries"         // int as string; 0 = yt-dlp's own default (10), not passed explicitly
)

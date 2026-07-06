package models

// Settings keys stored in the key/value settings table. The spec's yt-dlp
// and ffmpeg Settings sections are not wired up yet.
const (
	SettingDownloadDirectory      = "download_directory"
	SettingMaxConcurrentDownloads = "max_concurrent_downloads"
	SettingDefaultQuality         = "default_quality"
	SettingDefaultDownloadType    = "default_download_type"
	SettingImportIgnoredFolders   = "import_ignored_folders"
	SettingHistoryAnonymizeURLs   = "history_anonymize_urls"
	SettingLibraryView            = "library_view"
	SettingLibrarySort            = "library_sort" // stored as "<sortKey>:<sortDir>", e.g. "title:asc"
	SettingThumbnailFrameCount    = "thumbnail_frame_count"
	SettingPrivacyBlurStrength    = "privacy_blur_strength" // "weak" | "default" | "strong"
	SettingSkipDownloadPreview    = "skip_download_preview" // bool, true = skip the New Download preview card
	SettingJellyfinEnabled        = "jellyfin_enabled"
	SettingJellyfinURL            = "jellyfin_url"
	SettingJellyfinAPIKey         = "jellyfin_api_key"
)

package models

// Settings keys stored in the key/value settings table. Only these four are
// used by the working skeleton (General + Appearance); the rest of the
// spec's Settings sections (yt-dlp, ffmpeg, Jellyfin) are not wired up yet.
const (
	SettingDownloadDirectory      = "download_directory"
	SettingMaxConcurrentDownloads = "max_concurrent_downloads"
	SettingDefaultQuality         = "default_quality"
	SettingDefaultDownloadType    = "default_download_type"
)

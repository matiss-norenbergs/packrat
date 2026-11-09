package fsutil

import (
	"path/filepath"
	"strings"
)

// AudioFormatFromExtension infers a download type/audio format from a
// library item's own filename, for callers that lost the originating
// Download row (cleared download log, retention sweep, a library export made
// after that). Only recognizes the formats yt-dlp can actually produce via
// --audio-format (matching CreateDownloadRequest's accepted values) —
// anything else returns "" so the caller falls back to its own default.
func AudioFormatFromExtension(filename string) (downloadType, audioFormat string) {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".mp3", ".flac", ".m4a", ".aac", ".wav":
		return "audio", strings.TrimPrefix(ext, ".")
	default:
		return "", ""
	}
}

// imageExtensions are the extensions MediaTypeFromExtension calls "image".
var imageExtensions = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".webp": true,
	".gif": true, ".bmp": true, ".avif": true, ".tiff": true,
}

// MediaTypeFromExtension infers a library item's media type ("audio" or
// "image") from its filename, for rows that predate the explicit media_type
// column. Anything else returns "" — the caller treats it as unknown rather
// than guessing "video".
func MediaTypeFromExtension(filename string) string {
	if t, _ := AudioFormatFromExtension(filename); t != "" {
		return t
	}
	if imageExtensions[strings.ToLower(filepath.Ext(filename))] {
		return "image"
	}
	return ""
}

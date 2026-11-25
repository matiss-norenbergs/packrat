package api

import (
	"path"
	"strings"

	"github.com/gin-gonic/gin"
)

// filesCSP is sent on every /media-files and /local-images response. Files on
// the inline allowlist get inlineFilesCSP: no script, no frames, no network
// from the file itself. Everything else is an attachment and also gets
// `sandbox` (no allow-scripts / allow-same-origin), so even if a browser
// rendered it, it would run in an opaque origin without script and could not
// reach the admin API with the session cookie.
//
// `sandbox` is deliberately NOT sent with inline media: a video or audio file
// opened directly in a tab is a browser-made document whose <video>/<audio>
// loads the file again from an opaque origin (no session cookie, CSP-blocked
// in Chromium), so the player would never load. A CSP on a *subresource*
// response does not affect how the embedding page uses it, so <img>, <video>,
// <audio> and <track> loads work as before (the desktop/Android apps load them
// cross-origin).
const (
	inlineFilesCSP  = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'"
	sandboxFilesCSP = "sandbox; " + inlineFilesCSP
)

// inlineFileTypes is the allowlist of file extensions that may be shown inline,
// each with the Content-Type we send for it. It is deliberately explicit and
// does not use mime.TypeByExtension: the Docker runtime image (Alpine) has no
// /etc/mime.types, so Go would fall back to its tiny built-in table and to
// byte sniffing. Everything not listed (svg, html, xml, nfo, json, no
// extension, unknown ...) is sent as an octet-stream attachment.
//
// Built from what Packrat creates, imports and plays: yt-dlp video containers
// and --audio-format outputs, the importer's recognized extensions, the image
// types imagefetch/imageproc/thumbwrite write, and subtitle sidecars.
var inlineFileTypes = map[string]string{
	// images (imagefetch contentTypeExt, imageproc, thumbwrite, importer sidecars)
	".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
	".gif": "image/gif", ".bmp": "image/bmp", ".avif": "image/avif",
	".tif": "image/tiff", ".tiff": "image/tiff",

	// video (yt-dlp merge/remux containers, importer recognizedExtensions, trim)
	".mp4": "video/mp4", ".m4v": "video/mp4", ".mkv": "video/x-matroska", ".webm": "video/webm",
	".mov": "video/quicktime", ".avi": "video/x-msvideo", ".flv": "video/x-flv", ".ts": "video/mp2t",
	".3gp": "video/3gpp", ".ogv": "video/ogg", ".mpg": "video/mpeg", ".mpeg": "video/mpeg",

	// audio (yt-dlp --audio-format: aac, flac, m4a (also alac), mp3, opus, vorbis (.ogg), wav)
	".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".flac": "audio/flac", ".ogg": "audio/ogg",
	".oga": "audio/ogg", ".opus": "audio/ogg", ".wav": "audio/wav", ".aac": "audio/aac",
	".weba": "audio/webm", ".mka": "audio/x-matroska",

	// subtitle sidecars (text; inert under nosniff + the CSP)
	".vtt": "text/vtt; charset=utf-8", ".srt": "text/plain; charset=utf-8", ".ass": "text/plain; charset=utf-8",
}

// fileExt returns the lower-cased final extension of the last path segment.
func fileExt(p string) string {
	return strings.ToLower(path.Ext(path.Base(p)))
}

// ServedFileHeaders hardens the file routes (/media-files, /local-images):
// every response (200, 206, 304, HEAD, 404, 401) gets nosniff and a CSP
// (sandboxed for non-inline files); files whose extension is not in inlineFileTypes are forced to download
// as application/octet-stream. Content-Type is set before the handler runs;
// http.ServeContent keeps a Content-Type that is already set. Nothing else
// about the response (Range, ETag, Last-Modified, Cache-Control) is touched.
func ServedFileHeaders(c *gin.Context) {
	h := c.Writer.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	if ct, ok := inlineFileTypes[fileExt(c.Request.URL.Path)]; ok {
		h.Set("Content-Security-Policy", inlineFilesCSP)
		h.Set("Content-Type", ct)
	} else {
		h.Set("Content-Security-Policy", sandboxFilesCSP)
		h.Set("Content-Type", "application/octet-stream")
		h.Set("Content-Disposition", "attachment")
	}
	c.Next()
}

// BaselineHeaders adds the low-risk security headers to every response. There
// is deliberately no app-wide Content-Security-Policy (see docs/TODO.md).
func BaselineHeaders(c *gin.Context) {
	h := c.Writer.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Referrer-Policy", "same-origin")
	c.Next()
}

// spaContentTypes are set explicitly by serveSPA for the files a Vite build
// emits, so nosniff never meets a wrong or sniffed type when the host has no
// /etc/mime.types (Alpine). Anything else keeps Go's own detection.
var spaContentTypes = map[string]string{
	".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
	".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json",
	".map": "application/json", ".txt": "text/plain; charset=utf-8",
	".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
	".ico": "image/x-icon", ".wasm": "application/wasm",
}

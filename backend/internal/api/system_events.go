package api

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/ratelimit"
	"packrat/backend/internal/sysevents"
)

// eventsKey is where the router parks the system-log recorder for the handlers of a request, so
// recording an event does not widen every handler constructor. A request without it (a handler
// wired by hand in a test) records nothing.
const eventsKey = "systemEvents"

func eventsMiddleware(rec *sysevents.Recorder) gin.HandlerFunc {
	return func(c *gin.Context) {
		if rec != nil {
			c.Set(eventsKey, rec)
		}
		c.Next()
	}
}

// eventsOf returns the request's recorder (nil is valid and records nothing).
func eventsOf(c *gin.Context) *sysevents.Recorder {
	v, _ := c.Get(eventsKey)
	rec, _ := v.(*sysevents.Recorder)
	return rec
}

// recordEvent writes a system-log event for this request. Call it only after the operation has
// committed and no transaction or mutex is held; it never fails and never blocks the response
// noticeably. Privacy: see the sysevents package comment (no URLs, titles, file names, tokens,
// passwords, file contents).
func recordEvent(c *gin.Context, level, category, message string, details map[string]any) {
	eventsOf(c).Record(c.Request.Context(), level, category, message, details)
}

// recordSecurityEvent is recordEvent plus the client address, taken the same way the login rate
// limiter takes it (c.ClientIP, which honours TRUSTED_PROXIES). Only security events carry an IP.
func recordSecurityEvent(c *gin.Context, level, message string, details map[string]any) {
	if details == nil {
		details = map[string]any{}
	}
	details["ip"] = c.ClientIP()
	recordEvent(c, level, sysevents.CategorySecurity, message, details)
}

// lockoutRecorder is the limiter hook: it records one event per lockout that starts (never per
// failed attempt).
func lockoutRecorder(rec *sysevents.Recorder) func(ratelimit.Lockout) {
	return func(lo ratelimit.Lockout) {
		msg := "Login blocked for an address after repeated failures"
		if lo.Global {
			msg = "Login attempts are temporarily blocked for everyone after repeated failures"
		}
		rec.Record(context.Background(), sysevents.LevelWarning, sysevents.CategorySecurity, msg, map[string]any{
			"ip":             lo.IP,
			"step":           string(lo.Kind),
			"blockedSeconds": int(lo.Duration / time.Second),
			"blocksEveryone": lo.Global,
		})
	}
}

// Restore / import kinds, as shown in the event message.
const (
	restoreSettingsImport  = "Settings import"
	restoreLibraryImport   = "Library import"
	restoreFullFromHistory = "Full restore from backup history"
	restoreFullFromUpload  = "Full restore from an uploaded file"
)

// maskedError is err's text with credentials masked by the yt-dlp redaction helper (URLs are also
// scrubbed by the recorder). Never pass anything but an error here: file contents and backup
// passwords must not reach the log.
func maskedError(err error) string {
	if err == nil {
		return ""
	}
	return downloader.RedactText(err.Error())
}

func recordRestoreDone(c *gin.Context, kind string, details map[string]any) {
	recordEvent(c, sysevents.LevelInfo, sysevents.CategoryRestore, kind+" completed", details)
}

// recordRestoreRefused is a restore the server turned away before changing anything (unreadable
// file, wrong password, wrong kind of file).
func recordRestoreRefused(c *gin.Context, kind string, err error) {
	var details map[string]any
	if err != nil {
		details = map[string]any{"error": maskedError(err)}
	}
	recordEvent(c, sysevents.LevelWarning, sysevents.CategoryRestore, kind+" refused", details)
}

func recordRestoreFailed(c *gin.Context, kind string, err error) {
	recordEvent(c, sysevents.LevelError, sysevents.CategoryRestore, kind+" failed", map[string]any{"error": maskedError(err)})
}

func libraryRestoreDetails(r BackupImportLibraryResponse) map[string]any {
	return map[string]any{
		"collectionsEnsured": r.CollectionsEnsured,
		"tagsCreated":        r.TagsCreated,
		"artistsCreated":     r.ArtistsCreated,
		"ghostsCreated":      r.GhostsCreated,
		"downloadsQueued":    r.DownloadsQueued,
	}
}

func fullRestoreDetails(r BackupRestoreFullResponse) map[string]any {
	d := libraryRestoreDetails(r.Library)
	d["settingsApplied"] = r.SettingsApplied
	return d
}

package main

import (
	"context"
	"path/filepath"
	"time"

	"packrat/backend/internal/db"
	"packrat/backend/internal/downloader"
	"packrat/backend/internal/sysevents"
	"packrat/backend/internal/version"
)

// recordMigration writes the "migrations applied" system event, only when something was applied.
// It runs after migrating: the system_events table is created by a migration, so the event cannot
// be written before it. A migration that fails is therefore never recorded (stdout only), as the
// log lives in the very database being migrated. byAdmin marks the admin CLI path.
func recordMigration(ctx context.Context, rec *sysevents.Recorder, res db.MigrationResult, byAdmin bool) {
	if !res.Applied {
		return
	}
	details := map[string]any{
		"fromVersion": res.From,
		"toVersion":   res.To,
		"durationMs":  res.Duration.Milliseconds(),
	}
	if res.SnapshotPath != "" {
		details["snapshotFile"] = filepath.Base(res.SnapshotPath)
		details["snapshotBytes"] = res.SnapshotSize
	}
	msg := "Database migrated"
	if byAdmin {
		details["appliedBy"] = "admin command"
		msg = "Database migrated by an admin command"
	}
	rec.Record(ctx, sysevents.LevelInfo, sysevents.CategoryMigration, msg, details)
}

// recordStartup gathers the tool versions off the startup path and records one startup event.
func recordStartup(ctx context.Context, rec *sysevents.Recorder, schemaVersion int, ytdlp *downloader.YtDlpService, ffmpegPath string) {
	vctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	details := map[string]any{
		"appVersion":    version.Version,
		"schemaVersion": schemaVersion,
	}
	if v, err := ytdlp.Version(vctx); err == nil {
		details["ytdlpVersion"] = v
	}
	if v, err := downloader.FFmpegVersion(vctx, ffmpegPath); err == nil {
		details["ffmpegVersion"] = v
	}
	rec.Record(ctx, sysevents.LevelInfo, sysevents.CategoryStartup, "Packrat started", details)
}

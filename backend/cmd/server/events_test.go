package main

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"packrat/backend/internal/db"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/sysevents"
)

func newTestRecorder(t *testing.T) (*sysevents.Recorder, *repository.SystemEventsRepo) {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "p.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	dir, _ := filepath.Abs("../../../database/migrations")
	if err := db.Migrate(conn, dir); err != nil {
		t.Fatal(err)
	}
	repo := repository.NewSystemEventsRepo(conn)
	return sysevents.New(repo, repository.NewSettingsRepo(conn)), repo
}

func TestRecordMigration_OnlyWhenApplied(t *testing.T) {
	rec, repo := newTestRecorder(t)
	ctx := context.Background()

	recordMigration(ctx, rec, db.MigrationResult{From: 5, To: 5}, false)
	if _, total, _ := repo.Query(ctx, repository.SystemEventQuery{}); total != 0 {
		t.Fatalf("nothing applied must record nothing, got %d", total)
	}

	recordMigration(ctx, rec, db.MigrationResult{Applied: true, From: 5, To: 9, Duration: 1500 * time.Millisecond,
		SnapshotPath: filepath.Join("data", "pre-migration", "packrat-pre-migration-v5-to-v9.db"), SnapshotSize: 4096}, false)
	items, total, _ := repo.Query(ctx, repository.SystemEventQuery{})
	if total != 1 || items[0].Category != "migration" || items[0].Level != "info" {
		t.Fatalf("%+v", items)
	}
	var d map[string]any
	if err := json.Unmarshal(items[0].Details, &d); err != nil {
		t.Fatal(err)
	}
	if d["fromVersion"] != float64(5) || d["toVersion"] != float64(9) || d["durationMs"] != float64(1500) ||
		d["snapshotFile"] != "packrat-pre-migration-v5-to-v9.db" || d["snapshotBytes"] != float64(4096) {
		t.Fatalf("details: %v", d)
	}
	if _, ok := d["appliedBy"]; ok {
		t.Fatal("server start must not claim an admin command")
	}
}

func TestRecordMigration_AdminCommandIsMarked(t *testing.T) {
	rec, repo := newTestRecorder(t)
	ctx := context.Background()
	recordMigration(ctx, rec, db.MigrationResult{Applied: true, From: 1, To: 2}, true)
	items, _, _ := repo.Query(ctx, repository.SystemEventQuery{})
	var d map[string]any
	_ = json.Unmarshal(items[0].Details, &d)
	if d["appliedBy"] != "admin command" {
		t.Fatalf("details: %v", d)
	}
	if _, ok := d["snapshotFile"]; ok {
		t.Fatal("no snapshot was made")
	}
}

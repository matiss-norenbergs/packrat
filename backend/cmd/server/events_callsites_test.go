package main

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/repository"
)

func eventsOf(t *testing.T, repo *repository.SystemEventsRepo) []map[string]any {
	t.Helper()
	items, _, err := repo.Query(context.Background(), repository.SystemEventQuery{Sort: "createdAt"})
	if err != nil {
		t.Fatal(err)
	}
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		m := map[string]any{"level": it.Level, "category": it.Category, "message": it.Message}
		if len(it.Details) > 0 {
			var d map[string]any
			if err := json.Unmarshal(it.Details, &d); err != nil {
				t.Fatal(err)
			}
			m["details"] = d
		}
		out = append(out, m)
	}
	return out
}

func TestRecordStartup(t *testing.T) {
	rec, repo := newTestRecorder(t)
	// Missing binaries: the versions are simply left out, the event is still recorded.
	svc := &downloader.YtDlpService{BinPath: "packrat-test-missing-yt-dlp"}
	recordStartup(context.Background(), rec, 54, svc, "packrat-test-missing-ffmpeg")
	evs := eventsOf(t, repo)
	if len(evs) != 1 || evs[0]["level"] != "info" || evs[0]["category"] != "startup" {
		t.Fatalf("%v", evs)
	}
	d := evs[0]["details"].(map[string]any)
	if d["schemaVersion"] != float64(54) || d["appVersion"] == nil {
		t.Fatalf("details: %v", d)
	}
	if _, ok := d["ytdlpVersion"]; ok {
		t.Fatalf("a missing yt-dlp must not produce a version: %v", d)
	}
}

func TestRecordRecovery_OnlyWhenCountAboveZero(t *testing.T) {
	rec, repo := newTestRecorder(t)
	ctx := context.Background()
	recordRecovery(ctx, rec, 0, 0)
	if len(eventsOf(t, repo)) != 0 {
		t.Fatal("zero counts must record nothing")
	}
	recordRecovery(ctx, rec, 3, 0)
	recordRecovery(ctx, rec, 0, 2)
	evs := eventsOf(t, repo)
	if len(evs) != 2 {
		t.Fatalf("%v", evs)
	}
	for _, e := range evs {
		if e["level"] != "warning" || e["category"] != "recovery" {
			t.Fatalf("%v", e)
		}
	}
	if evs[0]["details"].(map[string]any)["downloads"] != float64(3) || evs[1]["details"].(map[string]any)["items"] != float64(2) {
		t.Fatalf("%v", evs)
	}
}

func TestRecordShutdown_CleanAndTimedOut(t *testing.T) {
	rec, repo := newTestRecorder(t)
	recordShutdown(rec, 0, 1200*time.Millisecond)
	recordShutdown(rec, 4, 15*time.Second)
	evs := eventsOf(t, repo)
	if len(evs) != 2 {
		t.Fatalf("%v", evs)
	}
	if evs[0]["level"] != "info" || evs[0]["category"] != "shutdown" {
		t.Fatalf("clean: %v", evs[0])
	}
	d := evs[1]["details"].(map[string]any)
	if evs[1]["level"] != "warning" || d["jobsLeft"] != float64(4) {
		t.Fatalf("timed out: %v", evs[1])
	}
}

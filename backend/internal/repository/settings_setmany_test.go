package repository

import (
	"context"
	"fmt"
	"testing"

	"packrat/backend/internal/models"
)

func TestSettingsRepo_SetMany_WritesAllKeys(t *testing.T) {
	ctx := context.Background()
	repo := NewSettingsRepo(openTestDB(t).db)

	err := repo.SetMany(ctx, map[string]string{
		models.SettingDefaultQuality: "720p",
		"brand_new_key":              "hello",
	})
	if err != nil {
		t.Fatalf("SetMany: %v", err)
	}
	if got, _ := repo.Get(ctx, models.SettingDefaultQuality); got != "720p" {
		t.Fatalf("existing key not updated, got %q", got)
	}
	if got, _ := repo.Get(ctx, "brand_new_key"); got != "hello" {
		t.Fatalf("missing key not inserted, got %q", got)
	}
	if err := repo.SetMany(ctx, nil); err != nil {
		t.Fatalf("empty SetMany should be a no-op, got %v", err)
	}
}

func TestSettingsRepo_SetMany_FailureLeavesNothingChanged(t *testing.T) {
	ctx := context.Background()
	conn := openTestDB(t).db
	repo := NewSettingsRepo(conn)

	// A trigger that rejects one specific key, so the batch fails partway.
	if _, err := conn.Exec(`CREATE TRIGGER reject_bad BEFORE INSERT ON settings WHEN NEW.key = 'bad_key'
		BEGIN SELECT RAISE(ABORT, 'rejected'); END`); err != nil {
		t.Fatal(err)
	}

	before, err := repo.GetAll(ctx)
	if err != nil {
		t.Fatal(err)
	}
	batch := map[string]string{
		models.SettingDefaultQuality:      "144p",
		models.SettingDefaultDownloadType: "audio",
		"bad_key":                         "x",
	}
	for i := 0; i < 20; i++ { // map order is random; many extra keys make a partial write likely
		batch[fmt.Sprintf("extra_%d", i)] = "v"
	}
	if err := repo.SetMany(ctx, batch); err == nil {
		t.Fatal("expected SetMany to fail")
	}

	after, err := repo.GetAll(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(before) {
		t.Fatalf("row count changed: %d -> %d", len(before), len(after))
	}
	for k, v := range before {
		if after[k] != v {
			t.Fatalf("key %q changed from %q to %q", k, v, after[k])
		}
	}
}

func TestSettingsRepo_SetMany_CancelledContext(t *testing.T) {
	conn := openTestDB(t).db
	repo := NewSettingsRepo(conn)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := repo.SetMany(ctx, map[string]string{models.SettingDefaultQuality: "144p"}); err == nil {
		t.Fatal("expected error from cancelled context")
	}
	if got, _ := repo.Get(context.Background(), models.SettingDefaultQuality); got != "best" {
		t.Fatalf("value changed despite failure: %q", got)
	}
}

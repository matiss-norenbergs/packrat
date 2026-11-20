package repository

import (
	"context"
	"path/filepath"
	"testing"

	"packrat/backend/internal/db"
	"packrat/backend/internal/models"
)

func TestListThumbnailEnhancementCandidatesExcludesImageItems(t *testing.T) {
	ctx := context.Background()
	conn, err := db.Open(filepath.Join(t.TempDir(), "cand.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	migrations, _ := filepath.Abs("../../../database/migrations")
	if err := db.Migrate(conn, migrations); err != nil {
		t.Fatal(err)
	}
	repo := NewLibraryRepo(conn)

	str := func(s string) *string { return &s }
	small := 100
	add := func(name, filename string, mediaType *string) int64 {
		t.Helper()
		id, err := repo.Create(ctx, &models.LibraryItem{
			Title: name, Filename: filename, Path: "d/" + filename, MediaType: mediaType,
			Thumbnail: str("d/" + name + ".jpg"), ThumbnailWidth: &small, ThumbnailHeight: &small, Status: "completed",
		})
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	video := add("video", "v.mp4", str("video"))
	audio := add("audio", "a.mp3", str("audio"))
	legacyVideo := add("legacy-video", "lv.mp4", nil)
	_ = add("image", "i.png", str("image"))
	// Legacy rows predate media_type; the file extension says it is an image.
	_ = add("legacy-image", "li.jpg", nil)
	// An unknown extension with no media type is kept (not guessed to be an image).
	legacyUnknown := add("legacy-unknown", "x.bin", nil)

	got, err := repo.ListThumbnailEnhancementCandidates(ctx, 720)
	if err != nil {
		t.Fatal(err)
	}
	have := map[int64]bool{}
	for _, it := range got {
		have[it.ID] = true
	}
	want := map[int64]bool{video: true, audio: true, legacyVideo: true, legacyUnknown: true}
	if len(have) != len(want) {
		t.Fatalf("candidates = %v, want exactly %v", have, want)
	}
	for id := range want {
		if !have[id] {
			t.Errorf("item %d should be a candidate", id)
		}
	}
}

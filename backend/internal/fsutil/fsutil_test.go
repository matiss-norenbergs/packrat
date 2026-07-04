package fsutil

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRenamePair(t *testing.T) {
	dir := t.TempDir()

	oldMedia := filepath.Join(dir, "old.mp4")
	oldThumb := filepath.Join(dir, "old.jpg")
	if err := os.WriteFile(oldMedia, []byte("video"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(oldThumb, []byte("thumb"), 0o644); err != nil {
		t.Fatal(err)
	}

	newMedia := filepath.Join(dir, "new.mp4")
	newThumb := filepath.Join(dir, "new.jpg")
	if err := RenamePair(oldMedia, newMedia, oldThumb, newThumb); err != nil {
		t.Fatalf("RenamePair: %v", err)
	}

	if _, err := os.Stat(oldMedia); !os.IsNotExist(err) {
		t.Fatalf("expected old media gone, got err=%v", err)
	}
	if _, err := os.Stat(oldThumb); !os.IsNotExist(err) {
		t.Fatalf("expected old thumb gone, got err=%v", err)
	}
	if b, err := os.ReadFile(newMedia); err != nil || string(b) != "video" {
		t.Fatalf("new media missing or wrong content: %v %q", err, b)
	}
	if b, err := os.ReadFile(newThumb); err != nil || string(b) != "thumb" {
		t.Fatalf("new thumb missing or wrong content: %v %q", err, b)
	}
}

func TestRenamePair_MissingThumbnailSourceIsNotAnError(t *testing.T) {
	dir := t.TempDir()
	oldMedia := filepath.Join(dir, "old.mp4")
	if err := os.WriteFile(oldMedia, []byte("v"), 0o644); err != nil {
		t.Fatal(err)
	}
	newMedia := filepath.Join(dir, "new.mp4")

	err := RenamePair(oldMedia, newMedia, filepath.Join(dir, "missing.jpg"), filepath.Join(dir, "new.jpg"))
	if err != nil {
		t.Fatalf("expected no error when thumbnail source is missing, got %v", err)
	}
	if _, err := os.Stat(newMedia); err != nil {
		t.Fatalf("expected media renamed, got %v", err)
	}
}

func TestRenamePair_RollsBackMediaRenameIfThumbnailRenameFails(t *testing.T) {
	dir := t.TempDir()
	oldMedia := filepath.Join(dir, "old.mp4")
	oldThumb := filepath.Join(dir, "old.jpg")
	if err := os.WriteFile(oldMedia, []byte("v"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(oldThumb, []byte("t"), 0o644); err != nil {
		t.Fatal(err)
	}
	newMedia := filepath.Join(dir, "new.mp4")
	badThumbDest := filepath.Join(dir, "nonexistent-dir", "new.jpg")

	err := RenamePair(oldMedia, newMedia, oldThumb, badThumbDest)
	if err == nil {
		t.Fatal("expected an error when the thumbnail rename target directory does not exist")
	}
	if _, err := os.Stat(oldMedia); err != nil {
		t.Fatalf("expected media file rolled back to original path, got %v", err)
	}
	if _, err := os.Stat(newMedia); !os.IsNotExist(err) {
		t.Fatalf("expected media file not left at new path, got err=%v", err)
	}
}

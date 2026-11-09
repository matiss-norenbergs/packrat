package fsutil

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// renamePair is the media+thumbnail case of RenameAll (the old RenamePair shape).
func renamePair(oldMedia, newMedia, oldThumb, newThumb string) error {
	steps := []RenameStep{{Old: oldMedia, New: newMedia, Label: "media file"}}
	if oldThumb != "" {
		steps = append(steps, RenameStep{Old: oldThumb, New: newThumb, Label: "thumbnail"})
	}
	return RenameAll(steps)
}

func TestRenameAll_Pair(t *testing.T) {
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
	if err := renamePair(oldMedia, newMedia, oldThumb, newThumb); err != nil {
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

func TestRenameAll_Pair_MissingThumbnailSourceIsNotAnError(t *testing.T) {
	dir := t.TempDir()
	oldMedia := filepath.Join(dir, "old.mp4")
	if err := os.WriteFile(oldMedia, []byte("v"), 0o644); err != nil {
		t.Fatal(err)
	}
	newMedia := filepath.Join(dir, "new.mp4")

	err := renamePair(oldMedia, newMedia, filepath.Join(dir, "missing.jpg"), filepath.Join(dir, "new.jpg"))
	if err != nil {
		t.Fatalf("expected no error when thumbnail source is missing, got %v", err)
	}
	if _, err := os.Stat(newMedia); err != nil {
		t.Fatalf("expected media renamed, got %v", err)
	}
}

func TestRenameAll_Pair_RollsBackMediaRenameIfThumbnailRenameFails(t *testing.T) {
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

	err := renamePair(oldMedia, newMedia, oldThumb, badThumbDest)
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

func TestRenameAll_Pair_RejectsMediaDestinationCollision(t *testing.T) {
	dir := t.TempDir()
	oldMedia := filepath.Join(dir, "old.mp4")
	newMedia := filepath.Join(dir, "new.mp4")
	if err := os.WriteFile(oldMedia, []byte("v"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(newMedia, []byte("already here"), 0o644); err != nil {
		t.Fatal(err)
	}

	err := renamePair(oldMedia, newMedia, "", "")
	if !errors.Is(err, ErrDestinationExists) {
		t.Fatalf("expected ErrDestinationExists, got %v", err)
	}
	if b, err := os.ReadFile(newMedia); err != nil || string(b) != "already here" {
		t.Fatalf("expected existing destination file left untouched, got %v %q", err, b)
	}
	if _, err := os.Stat(oldMedia); err != nil {
		t.Fatalf("expected source file left in place after rejected rename, got %v", err)
	}
}

func TestRenameAll_Pair_RejectsThumbnailDestinationCollision(t *testing.T) {
	dir := t.TempDir()
	oldMedia := filepath.Join(dir, "old.mp4")
	newMedia := filepath.Join(dir, "new.mp4")
	oldThumb := filepath.Join(dir, "old.jpg")
	newThumb := filepath.Join(dir, "new.jpg")
	if err := os.WriteFile(oldMedia, []byte("v"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(oldThumb, []byte("t"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(newThumb, []byte("already here"), 0o644); err != nil {
		t.Fatal(err)
	}

	err := renamePair(oldMedia, newMedia, oldThumb, newThumb)
	if !errors.Is(err, ErrDestinationExists) {
		t.Fatalf("expected ErrDestinationExists, got %v", err)
	}
	if _, err := os.Stat(oldMedia); err != nil {
		t.Fatalf("expected media file left in place when the collision is only on the thumbnail, got %v", err)
	}
	if b, err := os.ReadFile(newThumb); err != nil || string(b) != "already here" {
		t.Fatalf("expected existing thumbnail destination left untouched, got %v %q", err, b)
	}
}

func TestUniquePath(t *testing.T) {
	dir := t.TempDir()
	touch := func(name string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p := filepath.Join(dir, "Name.mp4")
	if got := UniquePath(p); got != p {
		t.Fatalf("free path changed: %q", got)
	}
	touch("Name.mp4")
	if got, want := UniquePath(p), filepath.Join(dir, "Name (2).mp4"); got != want {
		t.Fatalf("got %q want %q", got, want)
	}
	touch("Name (2).mp4")
	touch("Name (3).mp4")
	if got, want := UniquePath(p), filepath.Join(dir, "Name (4).mp4"); got != want {
		t.Fatalf("got %q want %q", got, want)
	}
	// No extension: counter goes at the end.
	touch("README")
	if got, want := UniquePath(filepath.Join(dir, "README")), filepath.Join(dir, "README (2)"); got != want {
		t.Fatalf("got %q want %q", got, want)
	}
	// Dots in the stem stay in the stem.
	touch("a.b.mkv")
	if got, want := UniquePath(filepath.Join(dir, "a.b.mkv")), filepath.Join(dir, "a.b (2).mkv"); got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestUniquePathBounded(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "f.txt")
	os.WriteFile(p, nil, 0o644)
	for i := 2; i <= maxUniqueAttempts; i++ {
		os.WriteFile(filepath.Join(dir, fmt.Sprintf("f (%d).txt", i)), nil, 0o644)
	}
	got := UniquePath(p)
	if _, err := os.Lstat(got); !os.IsNotExist(err) {
		t.Fatalf("fallback path %q is not free (err=%v)", got, err)
	}
	if filepath.Ext(got) != ".txt" {
		t.Fatalf("fallback lost extension: %q", got)
	}
}

func TestAudioFormatAndMediaTypeFromExtension(t *testing.T) {
	for name, want := range map[string]string{"a.mp3": "mp3", "a.M4A": "m4a", "a.flac": "flac", "a.aac": "aac", "a.wav": "wav"} {
		typ, format := AudioFormatFromExtension(name)
		if typ != "audio" || format != want {
			t.Errorf("AudioFormatFromExtension(%q) = %q, %q", name, typ, format)
		}
		if MediaTypeFromExtension(name) != "audio" {
			t.Errorf("MediaTypeFromExtension(%q) != audio", name)
		}
	}
	for _, name := range []string{"a.jpg", "a.JPEG", "a.png", "a.webp", "a.gif", "a.bmp", "a.avif", "a.tiff"} {
		if got := MediaTypeFromExtension(name); got != "image" {
			t.Errorf("MediaTypeFromExtension(%q) = %q, want image", name, got)
		}
		if typ, _ := AudioFormatFromExtension(name); typ != "" {
			t.Errorf("AudioFormatFromExtension(%q) type = %q, want empty", name, typ)
		}
	}
	for _, name := range []string{"a.mp4", "a.mkv", "a.ogg", "noext", ""} {
		if got := MediaTypeFromExtension(name); got != "" {
			t.Errorf("MediaTypeFromExtension(%q) = %q, want empty", name, got)
		}
	}
}

// threeFiles lays out old.mp4 / old.jpg / old.nfo and the matching steps.
func threeFiles(t *testing.T) (dir string, steps []RenameStep) {
	t.Helper()
	dir = t.TempDir()
	for _, n := range []string{"old.mp4", "old.jpg", "old.nfo"} {
		if err := os.WriteFile(filepath.Join(dir, n), []byte(n), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	steps = []RenameStep{
		{Old: filepath.Join(dir, "old.mp4"), New: filepath.Join(dir, "new.mp4"), Label: "media file"},
		{Old: filepath.Join(dir, "old.jpg"), New: filepath.Join(dir, "new.jpg"), Label: "thumbnail"},
		{Old: filepath.Join(dir, "old.nfo"), New: filepath.Join(dir, "new.nfo"), Label: "NFO sidecar"},
	}
	return dir, steps
}

func exists(p string) bool { _, err := os.Lstat(p); return err == nil }

func TestRenameAll_MovesEveryFile(t *testing.T) {
	dir, steps := threeFiles(t)
	if err := RenameAll(steps); err != nil {
		t.Fatal(err)
	}
	for _, n := range []string{"new.mp4", "new.jpg", "new.nfo"} {
		if !exists(filepath.Join(dir, n)) {
			t.Errorf("%s missing", n)
		}
	}
	for _, n := range []string{"old.mp4", "old.jpg", "old.nfo"} {
		if exists(filepath.Join(dir, n)) {
			t.Errorf("%s still exists", n)
		}
	}
}

func TestRenameAll_SkipsMissingOptionalSources(t *testing.T) {
	dir, steps := threeFiles(t)
	os.Remove(filepath.Join(dir, "old.nfo"))
	os.Remove(filepath.Join(dir, "old.jpg"))
	if err := RenameAll(steps); err != nil {
		t.Fatal(err)
	}
	if !exists(filepath.Join(dir, "new.mp4")) || exists(filepath.Join(dir, "new.nfo")) || exists(filepath.Join(dir, "new.jpg")) {
		t.Fatal("only the media file should have moved")
	}
}

func TestRenameAll_OccupiedDestinationRenamesNothing(t *testing.T) {
	for _, occupied := range []string{"new.mp4", "new.jpg", "new.nfo"} {
		t.Run(occupied, func(t *testing.T) {
			dir, steps := threeFiles(t)
			if err := os.WriteFile(filepath.Join(dir, occupied), []byte("foreign"), 0o644); err != nil {
				t.Fatal(err)
			}
			err := RenameAll(steps)
			if !errors.Is(err, ErrDestinationExists) {
				t.Fatalf("err = %v, want ErrDestinationExists", err)
			}
			for _, n := range []string{"old.mp4", "old.jpg", "old.nfo"} {
				if !exists(filepath.Join(dir, n)) {
					t.Errorf("%s was moved despite the collision", n)
				}
			}
			if b, _ := os.ReadFile(filepath.Join(dir, occupied)); string(b) != "foreign" {
				t.Errorf("occupied destination was touched: %q", b)
			}
			if err := CheckRenameDestinations(steps); !errors.Is(err, ErrDestinationExists) {
				t.Fatalf("CheckRenameDestinations = %v, want ErrDestinationExists", err)
			}
		})
	}
}

func TestRenameAll_OccupiedDestinationBlocksEvenWithoutSource(t *testing.T) {
	dir, steps := threeFiles(t)
	os.Remove(filepath.Join(dir, "old.nfo"))
	os.WriteFile(filepath.Join(dir, "new.nfo"), []byte("stale"), 0o644)
	if err := RenameAll(steps); !errors.Is(err, ErrDestinationExists) {
		t.Fatalf("err = %v, want ErrDestinationExists", err)
	}
	if !exists(filepath.Join(dir, "old.mp4")) {
		t.Fatal("media moved")
	}
}

func TestRenameAll_LastFailureRollsBackInReverse(t *testing.T) {
	dir, steps := threeFiles(t)
	var calls [][2]string
	restore := SetRenameFuncForTest(func(o, n string) error {
		calls = append(calls, [2]string{filepath.Base(o), filepath.Base(n)})
		if filepath.Base(n) == "new.nfo" {
			return errors.New("boom")
		}
		return os.Rename(o, n)
	})
	defer restore()

	err := RenameAll(steps)
	if err == nil || errors.Is(err, ErrDestinationExists) {
		t.Fatalf("err = %v, want a rename failure", err)
	}
	for _, n := range []string{"old.mp4", "old.jpg", "old.nfo"} {
		if !exists(filepath.Join(dir, n)) {
			t.Errorf("%s not back at its old path", n)
		}
	}
	for _, n := range []string{"new.mp4", "new.jpg", "new.nfo"} {
		if exists(filepath.Join(dir, n)) {
			t.Errorf("%s left at the new path", n)
		}
	}
	want := [][2]string{{"old.mp4", "new.mp4"}, {"old.jpg", "new.jpg"}, {"old.nfo", "new.nfo"}, {"new.jpg", "old.jpg"}, {"new.mp4", "old.mp4"}}
	if fmt.Sprint(calls) != fmt.Sprint(want) {
		t.Fatalf("rename calls = %v, want %v (rollback in reverse order)", calls, want)
	}
}

func TestRenameAll_ReportsFailedRollback(t *testing.T) {
	_, steps := threeFiles(t)
	restore := SetRenameFuncForTest(func(o, n string) error {
		if filepath.Base(n) == "new.nfo" || filepath.Base(n) == "old.jpg" {
			return errors.New("boom")
		}
		return os.Rename(o, n)
	})
	defer restore()
	err := RenameAll(steps)
	if err == nil || !strings.Contains(err.Error(), "rollback also failed") {
		t.Fatalf("err = %v, want it to mention the failed rollback", err)
	}
}

// For an image item the "thumbnail" is the media file itself: after the media
// step moved it the thumbnail step finds nothing to move and must not fail.
func TestRenameAll_ThumbnailThatIsTheMediaFile(t *testing.T) {
	dir := t.TempDir()
	old, nw := filepath.Join(dir, "a.png"), filepath.Join(dir, "b.png")
	os.WriteFile(old, []byte("img"), 0o644)
	err := RenameAll([]RenameStep{{Old: old, New: nw, Label: "media file"}, {Old: old, New: nw, Label: "thumbnail"}})
	if err != nil {
		t.Fatal(err)
	}
	if !exists(nw) || exists(old) {
		t.Fatal("image not moved")
	}
}

func TestRenameAll_NoOpStepsAreIgnored(t *testing.T) {
	dir, steps := threeFiles(t)
	steps[1].New = steps[1].Old         // thumbnail keeps its name
	steps = append(steps, RenameStep{}) // empty step
	if err := RenameAll(steps); err != nil {
		t.Fatal(err)
	}
	if !exists(filepath.Join(dir, "old.jpg")) || !exists(filepath.Join(dir, "new.mp4")) {
		t.Fatal("unexpected layout")
	}
}

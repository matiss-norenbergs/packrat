package downloader

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"packrat/backend/internal/fsutil"
)

// The test binary doubles as a fake ffmpeg: with PACKRAT_FAKE_FFMPEG set it
// copies the -i input to the last argument (like a -c copy remux), appends
// the output path to PACKRAT_FAKE_FFMPEG_LOG, optionally sleeps and optionally
// fails. Cross-platform, unlike a shell-script stub.
func TestMain(m *testing.M) {
	if os.Getenv("PACKRAT_FAKE_FFMPEG") == "1" {
		os.Exit(fakeFFmpeg())
	}
	os.Exit(m.Run())
}

func fakeFFmpeg() int {
	args := os.Args[1:]
	var src string
	for i, a := range args {
		if a == "-i" && i+1 < len(args) {
			src = args[i+1]
		}
	}
	out := args[len(args)-1]
	if logPath := os.Getenv("PACKRAT_FAKE_FFMPEG_LOG"); logPath != "" {
		if f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
			f.WriteString(out + "\n")
			f.Close()
		}
	}
	if os.Getenv("PACKRAT_FAKE_FFMPEG_SLEEP") != "" {
		time.Sleep(300 * time.Millisecond)
	}
	if os.Getenv("PACKRAT_FAKE_FFMPEG_FAIL") == "1" {
		os.WriteFile(out, []byte("partial"), 0o644)
		return 1
	}
	data, err := os.ReadFile(src)
	if err != nil {
		return 2
	}
	if err := os.WriteFile(out, append(data, []byte("+tagged")...), 0o644); err != nil {
		return 3
	}
	return 0
}

func fakeSvc(t *testing.T) *YtDlpService {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("PACKRAT_FAKE_FFMPEG", "1")
	return &YtDlpService{FFmpegPath: exe}
}

func dirNames(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

func TestEmbedMetadataConcurrentCallsUseDistinctTempFiles(t *testing.T) {
	svc := fakeSvc(t)
	dir := t.TempDir()
	logPath := filepath.Join(t.TempDir(), "ffmpeg.log")
	t.Setenv("PACKRAT_FAKE_FFMPEG_LOG", logPath)
	t.Setenv("PACKRAT_FAKE_FFMPEG_SLEEP", "1")
	media := filepath.Join(dir, "a.mp4")
	if err := os.WriteFile(media, []byte("video"), 0o644); err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs[i] = svc.EmbedMetadata(t.Context(), media, "T", nil, nil, nil, nil)
		}()
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatalf("embed: %v", err)
		}
	}

	raw, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	outs := strings.Fields(string(raw))
	if len(outs) != 2 || outs[0] == outs[1] {
		t.Fatalf("ffmpeg outputs = %v, want two distinct temp paths", outs)
	}
	for _, o := range outs {
		if filepath.Dir(o) != dir || !fsutil.IsEmbedTmpName(filepath.Base(o)) || filepath.Ext(o) != ".mp4" {
			t.Fatalf("temp path %q: want same dir, embed-tmp name, original extension", o)
		}
	}
	if names := dirNames(t, dir); len(names) != 1 || names[0] != "a.mp4" {
		t.Fatalf("directory after embeds = %v, want only a.mp4", names)
	}
}

func TestEmbedMetadataGuardVetoDiscardsTempAndKeepsOriginal(t *testing.T) {
	svc := fakeSvc(t)
	dir := t.TempDir()
	media := filepath.Join(dir, "a.mp4")
	os.WriteFile(media, []byte("video"), 0o644)

	err := svc.EmbedMetadataGuarded(t.Context(), media, "T", nil, nil, nil, nil, func() bool { return false })
	if !errors.Is(err, ErrEmbedSkipped) {
		t.Fatalf("err = %v, want ErrEmbedSkipped", err)
	}
	if got, _ := os.ReadFile(media); string(got) != "video" {
		t.Fatalf("original changed: %q", got)
	}
	if names := dirNames(t, dir); len(names) != 1 {
		t.Fatalf("leftover files: %v", names)
	}
}

// A file that disappears mid-run (deleted or moved) must not be recreated.
func TestEmbedMetadataDoesNotRecreateMovedFile(t *testing.T) {
	svc := fakeSvc(t)
	dir := t.TempDir()
	media := filepath.Join(dir, "a.mp4")
	os.WriteFile(media, []byte("video"), 0o644)

	err := svc.EmbedMetadataGuarded(t.Context(), media, "T", nil, nil, nil, nil, func() bool {
		os.Remove(media) // simulates the move/delete landing during the remux
		_, statErr := os.Stat(media)
		return statErr == nil
	})
	if !errors.Is(err, ErrEmbedSkipped) {
		t.Fatalf("err = %v, want ErrEmbedSkipped", err)
	}
	if names := dirNames(t, dir); len(names) != 0 {
		t.Fatalf("files left behind / recreated: %v", names)
	}
}

func TestEmbedMetadataFailureRemovesTemp(t *testing.T) {
	svc := fakeSvc(t)
	t.Setenv("PACKRAT_FAKE_FFMPEG_FAIL", "1")
	dir := t.TempDir()
	media := filepath.Join(dir, "a.mp4")
	os.WriteFile(media, []byte("video"), 0o644)

	if err := svc.EmbedMetadata(t.Context(), media, "T", nil, nil, nil, nil); err == nil {
		t.Fatal("expected error")
	}
	if names := dirNames(t, dir); len(names) != 1 || names[0] != "a.mp4" {
		t.Fatalf("directory = %v, want only a.mp4", names)
	}
}

func TestEmbedMetadataSuccessReplacesFile(t *testing.T) {
	svc := fakeSvc(t)
	dir := t.TempDir()
	media := filepath.Join(dir, "a.mp4")
	os.WriteFile(media, []byte("video"), 0o644)

	if err := svc.EmbedMetadata(t.Context(), media, "T", nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(media); string(got) != "video+tagged" {
		t.Fatalf("content = %q", got)
	}
	if names := dirNames(t, dir); len(names) != 1 {
		t.Fatalf("leftover files: %v", names)
	}
}

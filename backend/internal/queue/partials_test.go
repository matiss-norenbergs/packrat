package queue

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"packrat/backend/internal/models"
)

// The "partial" marker of fakeYtDlp makes it report
// "[download] Destination: <dir>/Clip.f137.mp4", write Clip.f137.mp4.part and
// .ytdl and then hang (or exit 1 with "fail"; "nodest" skips the report).

// partialRun starts such a download plus two unrelated files in its
// destination directory, and returns that directory and a channel closed when
// the run ends.
func partialRun(t *testing.T, e *ghostEnv, flags ...string) (id int64, dir string, done chan struct{}) {
	t.Helper()
	e.flag("partial", true)
	for _, f := range flags {
		e.flag(f, true)
	}
	id = e.newDownload(models.Download{Folder: "sub"})
	dir = filepath.Join(e.mediaRoot, "sub")
	done = make(chan struct{})
	go func() { e.mgr.runOne(context.Background(), id); close(done) }()
	waitFor(t, "partial files", func() bool { return exists(filepath.Join(dir, "Clip.f137.mp4.ytdl")) })
	for _, name := range []string{"Clip.nfo", "Clip.f140.m4a", "Clip.f137.mp4.part-other"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("keep"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return id, dir, done
}

func assertUnrelatedKept(t *testing.T, dir string) {
	t.Helper()
	for _, name := range []string{"Clip.nfo", "Clip.f140.m4a", "Clip.f137.mp4.part-other"} {
		if !exists(filepath.Join(dir, name)) {
			t.Errorf("%s was removed", name)
		}
	}
}

func TestCancelRemovesReportedPartialFiles(t *testing.T) {
	e := newGhostEnv(t)
	id, dir, done := partialRun(t, e)
	// Give the run time to read the Destination line before cancelling.
	waitFor(t, "downloading", func() bool { return e.download(id).Status == models.StatusDownloading })
	if err := e.mgr.Cancel(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	<-done

	for _, name := range []string{"Clip.f137.mp4.part", "Clip.f137.mp4.ytdl"} {
		if exists(filepath.Join(dir, name)) {
			t.Errorf("%s survived a user cancel", name)
		}
	}
	assertUnrelatedKept(t, dir)
	if e.download(id).Status != models.StatusCancelled {
		t.Fatalf("status = %s", e.download(id).Status)
	}
}

func TestFailedRunKeepsPartialFiles(t *testing.T) {
	e := newGhostEnv(t)
	id, dir, done := partialRun(t, e, "fail")
	<-done

	if e.download(id).Status != models.StatusFailed {
		t.Fatalf("status = %s", e.download(id).Status)
	}
	for _, name := range []string{"Clip.f137.mp4.part", "Clip.f137.mp4.ytdl"} {
		if !exists(filepath.Join(dir, name)) {
			t.Errorf("%s removed by a failed run (a retry resumes from it)", name)
		}
	}
	assertUnrelatedKept(t, dir)
}

func TestTimeoutKeepsPartialFiles(t *testing.T) {
	e := newGhostEnv(t)
	dir := filepath.Join(e.mediaRoot, "sub")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(dir, "Clip.f137.mp4")
	for _, n := range []string{dest + ".part", dest + ".ytdl"} {
		if err := os.WriteFile(n, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	id := e.newDownload(models.Download{Folder: "sub"})
	runCtx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	if !errors.Is(runCtx.Err(), context.DeadlineExceeded) {
		t.Fatalf("setup: runCtx.Err() = %v", runCtx.Err())
	}
	e.mgr.finishErrorKeepingPartials(context.Background(), runCtx, id, "u", "boom", "", "", partialFiles{dir: dir, destinations: []string{dest}})
	for _, n := range []string{dest + ".part", dest + ".ytdl"} {
		if !exists(n) {
			t.Errorf("%s removed by a timeout", filepath.Base(n))
		}
	}
}

func TestShutdownCancelKeepsPartialFiles(t *testing.T) {
	e := newGhostEnv(t)
	dir := t.TempDir()
	dest := filepath.Join(dir, "Clip.f137.mp4")
	if err := os.WriteFile(dest+".part", []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	id := e.newDownload(models.Download{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // parent and run context both done: the server is stopping
	e.mgr.finishErrorKeepingPartials(ctx, ctx, id, "u", "boom", "", "", partialFiles{dir: dir, destinations: []string{dest}})
	if !exists(dest + ".part") {
		t.Error("a shutdown must keep the partial file")
	}
}

func TestCancelWithoutReportedDestinationRemovesNothing(t *testing.T) {
	e := newGhostEnv(t)
	id, dir, done := partialRun(t, e, "nodest")
	waitFor(t, "downloading", func() bool { return e.download(id).Status == models.StatusDownloading })
	if err := e.mgr.Cancel(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	<-done

	for _, name := range []string{"Clip.f137.mp4.part", "Clip.f137.mp4.ytdl"} {
		if !exists(filepath.Join(dir, name)) {
			t.Errorf("%s removed although no destination was reported", name)
		}
	}
	assertUnrelatedKept(t, dir)
}

func TestRemovePartialFilesScope(t *testing.T) {
	dir := t.TempDir()
	outside := t.TempDir()
	write := func(d, name string) string {
		p := filepath.Join(d, name)
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		return p
	}
	dest := filepath.Join(dir, "Clip.f137.mp4")
	removed := []string{
		write(dir, "Clip.f137.mp4.part"), write(dir, "Clip.f137.mp4.ytdl"),
		write(dir, "Clip.f137.mp4.part-Frag3"), write(dir, "Clip.f137.mp4.part-Frag12.part"),
	}
	kept := []string{
		write(dir, "Clip.f137.mp4"), write(dir, "Clip.f137.mp4.nfo"), write(dir, "Clip.f137.mp4.jpg"),
		write(dir, "Clip.f140.m4a.part"), write(dir, "Clip.part"), write(dir, "Clip.f137.mp4.part-FragX"),
		write(outside, "Clip.f137.mp4.part"),
	}
	// A directory that happens to carry a partial-looking name is not a file.
	if err := os.Mkdir(filepath.Join(dir, "Clip.f137.mp4.part-Frag1"), 0o755); err != nil {
		t.Fatal(err)
	}
	kept = append(kept, filepath.Join(dir, "Clip.f137.mp4.part-Frag1"))

	removePartialFiles(partialFiles{dir: dir, destinations: []string{
		dest, dest, "relative/Clip.f137.mp4", filepath.Join(outside, "Clip.f137.mp4"),
	}})
	for _, p := range removed {
		if exists(p) {
			t.Errorf("%s should have been removed", filepath.Base(p))
		}
	}
	for _, p := range kept {
		if !exists(p) {
			t.Errorf("%s should have been kept", p)
		}
	}
	removePartialFiles(partialFiles{destinations: []string{dest}}) // no directory known: no-op
}

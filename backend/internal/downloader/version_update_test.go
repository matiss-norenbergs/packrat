package downloader

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// updateFixture builds a YtDlpService whose pip and yt-dlp are shell fakes sharing one folder:
// the fake yt-dlp prints the content of <dir>/version and fails when that file is missing (a
// "broken" install); the fake pip logs every call to <dir>/calls and then runs pipBody.
type updateFixture struct {
	dir string
	svc *YtDlpService
}

func newUpdateFixture(t *testing.T, version, pipBody string) *updateFixture {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fakes need a POSIX shell")
	}
	dir := t.TempDir()
	write := func(name, body string) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte("#!/bin/sh\n"+body), 0o755); err != nil {
			t.Fatal(err)
		}
		return p
	}
	if version != "" {
		if err := os.WriteFile(filepath.Join(dir, "version"), []byte(version), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	ytdlp := write("yt-dlp", fmt.Sprintf("cat %q/version 2>/dev/null || exit 1\n", dir))
	pip := write("pip", fmt.Sprintf("D=%q\necho \"$@\" >> \"$D/calls\"\n%s\n", dir, pipBody))
	f := &updateFixture{dir: dir, svc: &YtDlpService{BinPath: ytdlp, PipPath: pip}}
	return f
}

func (f *updateFixture) path(name string) string { return filepath.Join(f.dir, name) }

func (f *updateFixture) exists(name string) bool {
	_, err := os.Stat(f.path(name))
	return err == nil
}

func (f *updateFixture) calls() []string {
	b, _ := os.ReadFile(f.path("calls"))
	s := strings.TrimSpace(string(b))
	if s == "" {
		return nil
	}
	return strings.Split(s, "\n")
}

func (f *updateFixture) waitFor(t *testing.T, name string) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !f.exists(name) {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", name)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func setUpdateTimings(t *testing.T, timeout, grace time.Duration) {
	t.Helper()
	oldT, oldG := updateTimeout, updateStopGrace
	updateTimeout, updateStopGrace = timeout, grace
	t.Cleanup(func() { updateTimeout, updateStopGrace = oldT, oldG })
}

// slowPip: writes "started", takes a moment, installs the new version, writes "finished".
const slowPip = `touch "$D/started"
sleep 1
echo 2.0 > "$D/version"
touch "$D/finished"`

type updateResult struct {
	version string
	err     error
}

func TestUpdateSecondConcurrentCallIsRejectedAndFirstCompletes(t *testing.T) {
	f := newUpdateFixture(t, "1.0", slowPip)
	first := make(chan updateResult, 1)
	go func() {
		v, err := f.svc.Update(context.Background())
		first <- updateResult{v, err}
	}()
	f.waitFor(t, "started")

	if _, err := f.svc.Update(context.Background()); !errors.Is(err, ErrUpdateInProgress) {
		t.Fatalf("second update: err = %v, want ErrUpdateInProgress", err)
	}
	r := <-first
	if r.err != nil || r.version != "2.0" {
		t.Fatalf("first update = %q, %v", r.version, r.err)
	}
	if n := len(f.calls()); n != 1 {
		t.Fatalf("pip ran %d times, want 1: %v", n, f.calls())
	}
	// The lock is released afterwards.
	if _, err := f.svc.Update(context.Background()); err != nil {
		t.Fatalf("update after release: %v", err)
	}
}

func TestUpdateKeepsRunningWhenRequestContextIsCancelled(t *testing.T) {
	f := newUpdateFixture(t, "1.0", slowPip)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan updateResult, 1)
	go func() {
		v, err := f.svc.Update(ctx)
		done <- updateResult{v, err}
	}()
	f.waitFor(t, "started")
	cancel() // the tab was closed while pip is installing

	r := <-done
	if r.err != nil || r.version != "2.0" {
		t.Fatalf("update = %q, %v (a cancelled request must not stop pip)", r.version, r.err)
	}
	if !f.exists("finished") {
		t.Fatal("pip did not run to completion")
	}
}

func TestUpdateTimeoutSendsSIGINTFirstSoPipCanRollBack(t *testing.T) {
	setUpdateTimings(t, 300*time.Millisecond, 5*time.Second)
	f := newUpdateFixture(t, "1.0", `trap 'touch "$D/rolled-back"; exit 1' INT
touch "$D/started"
while true; do sleep 0.1; done`)

	start := time.Now()
	_, err := f.svc.Update(context.Background())
	if err == nil {
		t.Fatal("want an error from the timed-out update")
	}
	if !f.exists("rolled-back") {
		t.Fatal("pip was not interrupted with SIGINT before being killed")
	}
	if time.Since(start) > 4*time.Second {
		t.Fatalf("took %v: the kill timer should not have been needed", time.Since(start))
	}
	// yt-dlp still works, so no repair runs.
	if n := len(f.calls()); n != 1 || strings.Contains(err.Error(), "reinstalled") {
		t.Fatalf("calls = %v, err = %v", f.calls(), err)
	}
}

func TestUpdateTimeoutKillsPipOnlyAfterTheGraceWhenItIgnoresSIGINT(t *testing.T) {
	const timeout, grace = 300 * time.Millisecond, 600 * time.Millisecond
	setUpdateTimings(t, timeout, grace)
	f := newUpdateFixture(t, "1.0", `trap '' INT
echo $$ > "$D/pid"
touch "$D/started"
while true; do sleep 0.1; done`)

	start := time.Now()
	_, err := f.svc.Update(context.Background())
	if err == nil {
		t.Fatal("want an error")
	}
	if el := time.Since(start); el < timeout+grace {
		t.Fatalf("returned after %v, before the grace (%v) elapsed: pip was killed too early", el, timeout+grace)
	}
	pidText, _ := os.ReadFile(f.path("pid"))
	pid, _ := strconv.Atoi(strings.TrimSpace(string(pidText)))
	if pid == 0 || syscall.Kill(pid, 0) == nil {
		t.Fatalf("pip (pid %d) is still alive after the grace", pid)
	}
}

func TestUpdateFailureWithWorkingYtDlpRunsNoRepair(t *testing.T) {
	f := newUpdateFixture(t, "1.0", `echo "network down"; exit 1`)
	_, err := f.svc.Update(context.Background())
	if err == nil || !strings.Contains(err.Error(), "network down") {
		t.Fatalf("err = %v", err)
	}
	if strings.Contains(err.Error(), "reinstalled") || strings.Contains(err.Error(), "repaired") {
		t.Fatalf("message mentions a repair that did not happen: %v", err)
	}
	if n := len(f.calls()); n != 1 {
		t.Fatalf("pip calls = %v, want only the upgrade", f.calls())
	}
}

// A failed upgrade that removed yt-dlp: exactly one force-reinstall brings it back.
func TestUpdateFailureThatBreaksYtDlpIsRepairedOnce(t *testing.T) {
	f := newUpdateFixture(t, "1.0", `case "$*" in
*--force-reinstall*) echo 1.0 > "$D/version" ;;
*) rm -f "$D/version"; echo "boom"; exit 1 ;;
esac`)
	_, err := f.svc.Update(context.Background())
	if err == nil || !strings.Contains(err.Error(), "the update failed and yt-dlp was reinstalled") {
		t.Fatalf("err = %v", err)
	}
	calls := f.calls()
	if len(calls) != 2 || !strings.Contains(calls[1], "--force-reinstall") || strings.Contains(calls[0], "--force-reinstall") {
		t.Fatalf("calls = %v, want upgrade then exactly one force-reinstall", calls)
	}
	if v, verr := f.svc.Version(context.Background()); verr != nil || v != "1.0" {
		t.Fatalf("yt-dlp after repair = %q, %v", v, verr)
	}
}

func TestUpdateRepairFailureIsReported(t *testing.T) {
	f := newUpdateFixture(t, "1.0", `rm -f "$D/version"; echo "still broken"; exit 1`)
	_, err := f.svc.Update(context.Background())
	if err == nil || !strings.Contains(err.Error(), "the update failed and yt-dlp could not be repaired") ||
		!strings.Contains(err.Error(), "still broken") {
		t.Fatalf("err = %v", err)
	}
	if n := len(f.calls()); n != 2 {
		t.Fatalf("pip calls = %v, want upgrade + one repair attempt", f.calls())
	}
}

// Old pip without --break-system-packages: the retry still works, for upgrade and repair alike.
func TestUpdateRetriesWithoutBreakSystemPackages(t *testing.T) {
	f := newUpdateFixture(t, "1.0", `case "$*" in
*--break-system-packages*) echo "no such option: --break-system-packages"; exit 2 ;;
esac
echo 2.0 > "$D/version"`)
	v, err := f.svc.Update(context.Background())
	if err != nil || v != "2.0" {
		t.Fatalf("update = %q, %v", v, err)
	}
	if n := len(f.calls()); n != 2 {
		t.Fatalf("calls = %v", f.calls())
	}
}

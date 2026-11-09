package downloader

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const versionCheckTimeout = 10 * time.Second

// Version runs `yt-dlp --version` and returns the trimmed output (e.g. "2024.08.06").
func (s *YtDlpService) Version(ctx context.Context) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, versionCheckTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, s.BinPath, "--version")
	out, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok && len(exitErr.Stderr) > 0 {
			return "", fmt.Errorf("checking yt-dlp version: %w: %s", err, strings.TrimSpace(string(exitErr.Stderr)))
		}
		return "", fmt.Errorf("checking yt-dlp version: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}

type pypiResponse struct {
	Info struct {
		Version string `json:"version"`
	} `json:"info"`
}

// LatestVersion queries PyPI's JSON API for yt-dlp's latest published release — matching how
// yt-dlp is actually installed here (pip), so "latest" means what an upgrade would actually
// fetch. Any failure (network, bad JSON) is returned as an error — callers should treat that as
// "unknown," not fatal to the whole version check.
func (s *YtDlpService) LatestVersion(ctx context.Context) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, versionCheckTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://pypi.org/pypi/yt-dlp/json", nil)
	if err != nil {
		return "", fmt.Errorf("building PyPI request: %w", err)
	}

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("calling PyPI: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode >= 300 {
		return "", fmt.Errorf("PyPI returned status %d", res.StatusCode)
	}

	var parsed pypiResponse
	if err := json.NewDecoder(res.Body).Decode(&parsed); err != nil {
		return "", fmt.Errorf("parsing PyPI response: %w", err)
	}
	if parsed.Info.Version == "" {
		return "", fmt.Errorf("PyPI response had no version")
	}
	return parsed.Info.Version, nil
}

// updateTimeout bounds one pip run of the yt-dlp update (the upgrade, and separately the repair).
// Generous on purpose: killing pip between "uninstall old" and "install new" leaves no yt-dlp, so
// a slow link must not be cut off mid-install. A variable only so tests can shorten it.
const defaultUpdateTimeout = 5 * time.Minute

// defaultUpdateStopGrace is how long pip gets after SIGINT to roll back its own uninstall before
// the process tree is killed.
const defaultUpdateStopGrace = 20 * time.Second

var (
	updateTimeout   = defaultUpdateTimeout
	updateStopGrace = defaultUpdateStopGrace
)

// ErrUpdateInProgress is returned by Update when another update (or repair) is still running.
var ErrUpdateInProgress = errors.New("yt-dlp is already being updated. Try again in a moment.")

// Update runs `pip install --upgrade --break-system-packages yt-dlp` and, on success, returns the
// new version by calling Version again. If pip rejects --break-system-packages (older pip that
// predates PEP 668 support), retries once without that flag — so this also works for a non-Docker
// pip that doesn't need or recognize it. Deliberately goes through pip (the tool that actually
// installed yt-dlp here) rather than yt-dlp's own -U/--update, which is documented as unreliable
// for pip installs — it only reliably self-replaces standalone release binaries.
//
// Safety, because pip uninstalls the old package before installing the new one:
//   - One update at a time (TryLock); a concurrent call returns ErrUpdateInProgress.
//   - The pip work runs on a context detached from ctx (context.WithoutCancel) with its own
//     timeout, so a closed tab or cancelled request never stops it.
//   - Stopping (timeout) sends SIGINT first so pip can roll back, and only kills after a grace.
//   - After a failed or timed-out update, if yt-dlp no longer runs, one bounded
//     `pip install --force-reinstall yt-dlp` is attempted, and the error says what happened.
func (s *YtDlpService) Update(ctx context.Context) (string, error) {
	if !s.updateMu.TryLock() {
		return "", ErrUpdateInProgress
	}
	defer s.updateMu.Unlock()

	base := context.WithoutCancel(ctx)

	upCtx, cancel := context.WithTimeout(base, updateTimeout)
	out, err := s.runPip(upCtx, "--upgrade")
	cancel()
	if err != nil {
		upErr := fmt.Errorf("updating yt-dlp: %w: %s", err, strings.TrimSpace(out))
		if _, verr := s.Version(base); verr == nil {
			return "", upErr
		}
		return "", s.repair(base, upErr)
	}

	return s.Version(base)
}

// repair reinstalls yt-dlp after a failed update left it unusable, and returns upErr annotated
// with the outcome. The update lock is held by the caller.
func (s *YtDlpService) repair(base context.Context, upErr error) error {
	rCtx, cancel := context.WithTimeout(base, updateTimeout)
	defer cancel()
	out, err := s.runPip(rCtx, "--force-reinstall")
	if err == nil {
		_, err = s.Version(base)
	}
	if err != nil {
		return fmt.Errorf("%w; the update failed and yt-dlp could not be repaired: %v %s", upErr, err, strings.TrimSpace(out))
	}
	return fmt.Errorf("%w; the update failed and yt-dlp was reinstalled", upErr)
}

// runPip runs `pip install <mode> [--break-system-packages] yt-dlp`, retrying once without the
// flag when pip does not know it.
func (s *YtDlpService) runPip(ctx context.Context, mode string) (string, error) {
	out, err := s.runPipOnce(ctx, mode, true)
	if err != nil && strings.Contains(strings.ToLower(out), "no such option") {
		out, err = s.runPipOnce(ctx, mode, false)
	}
	return out, err
}

func (s *YtDlpService) runPipOnce(ctx context.Context, mode string, breakSystemPackages bool) (string, error) {
	args := []string{"install", mode}
	if breakSystemPackages {
		args = append(args, "--break-system-packages")
	}
	args = append(args, "yt-dlp")

	cmd, done := newGracefulStopCmd(ctx, updateStopGrace, s.PipPath, args...)
	defer done()
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// newGracefulStopCmd is newTreeKillCmd's gentler sibling for commands that must not be
// SIGKILLed first (pip mid-install): on cancel/timeout it sends SIGINT to the process group
// (a plain kill on Windows, which has no child SIGINT), then kills the tree if it is still
// alive after grace. The returned func must be called once the command has finished; it
// disarms the pending kill.
func newGracefulStopCmd(ctx context.Context, grace time.Duration, name string, args ...string) (*exec.Cmd, func()) {
	cmd := exec.CommandContext(ctx, name, args...)
	configureProcessGroup(cmd)
	var (
		mu    sync.Mutex
		timer *time.Timer
		over  bool
	)
	cmd.Cancel = func() error {
		err := interruptProcessTree(cmd)
		mu.Lock()
		defer mu.Unlock()
		if !over {
			timer = time.AfterFunc(grace, func() { _ = killProcessTree(cmd) })
		}
		return err
	}
	// Backstop only: the timer above kills the tree first; this closes pipes held by strays.
	cmd.WaitDelay = grace + processTreeKillGrace
	return cmd, func() {
		mu.Lock()
		defer mu.Unlock()
		over = true
		if timer != nil {
			timer.Stop()
		}
	}
}

// VersionsEqual compares a yt-dlp --version string (zero-padded date, e.g.
// "2026.07.04") against a PyPI version string (PEP 440-normalized, leading
// zeros stripped per segment, e.g. "2026.7.4") — confirmed live that these
// two sources format the same release differently, so a naive string
// comparison would report a false "update available" for users already on
// the latest version.
func VersionsEqual(a, b string) bool {
	return normalizeVersion(a) == normalizeVersion(b)
}

func normalizeVersion(v string) string {
	parts := strings.Split(v, ".")
	for i, p := range parts {
		trimmed := strings.TrimLeft(p, "0")
		if trimmed == "" {
			trimmed = "0"
		}
		parts[i] = trimmed
	}
	return strings.Join(parts, ".")
}

// FFmpegVersion runs `ffmpeg -version` and returns the version token of the first line (e.g.
// "6.1.1"), or "" with an error when the binary cannot be run.
func FFmpegVersion(ctx context.Context, ffmpegPath string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, versionCheckTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, ffmpegPath, "-version").Output()
	if err != nil {
		return "", fmt.Errorf("checking ffmpeg version: %w", err)
	}
	first, _, _ := strings.Cut(string(out), "\n")
	fields := strings.Fields(first)
	if len(fields) >= 3 && fields[0] == "ffmpeg" && fields[1] == "version" {
		return fields[2], nil
	}
	return strings.TrimSpace(first), nil
}

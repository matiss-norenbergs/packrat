package downloader

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
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

const updateTimeout = 2 * time.Minute

// Update runs `pip install --upgrade --break-system-packages yt-dlp` and, on success, returns the
// new version by calling Version again. If pip rejects --break-system-packages (older pip that
// predates PEP 668 support), retries once without that flag — so this also works for a non-Docker
// pip that doesn't need or recognize it. Deliberately goes through pip (the tool that actually
// installed yt-dlp here) rather than yt-dlp's own -U/--update, which is documented as unreliable
// for pip installs — it only reliably self-replaces standalone release binaries.
func (s *YtDlpService) Update(ctx context.Context) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, updateTimeout)
	defer cancel()

	out, err := s.runPipUpgrade(ctx, true)
	if err != nil && strings.Contains(strings.ToLower(out), "no such option") {
		out, err = s.runPipUpgrade(ctx, false)
	}
	if err != nil {
		return "", fmt.Errorf("updating yt-dlp: %w: %s", err, strings.TrimSpace(out))
	}

	return s.Version(ctx)
}

func (s *YtDlpService) runPipUpgrade(ctx context.Context, breakSystemPackages bool) (string, error) {
	args := []string{"install", "--upgrade"}
	if breakSystemPackages {
		args = append(args, "--break-system-packages")
	}
	args = append(args, "yt-dlp")

	cmd := exec.CommandContext(ctx, s.PipPath, args...)
	out, err := cmd.CombinedOutput()
	return string(out), err
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

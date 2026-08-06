package version

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Repo is Packrat's own GitHub repo, queried for the latest published
// release. Hardcoded rather than user-configurable — same treatment as the
// yt-dlp version checker's PyPI URL.
const Repo = "matiss-norenbergs/packrat"

const latestCheckTimeout = 10 * time.Second

type githubRelease struct {
	TagName string `json:"tag_name"`
}

// Latest queries GitHub's releases API for Repo's latest published release
// tag (e.g. "v0.2.0"), stripped of its leading "v". Any failure (network,
// no releases yet, bad JSON) is returned as an error — callers should treat
// that as "unknown," not fatal, exactly like the yt-dlp PyPI lookup.
func Latest(ctx context.Context) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, latestCheckTimeout)
	defer cancel()

	url := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", Repo)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", fmt.Errorf("building GitHub request: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.github+json")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("calling GitHub: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode >= 300 {
		return "", fmt.Errorf("GitHub returned status %d", res.StatusCode)
	}

	var parsed githubRelease
	if err := json.NewDecoder(res.Body).Decode(&parsed); err != nil {
		return "", fmt.Errorf("parsing GitHub response: %w", err)
	}
	if parsed.TagName == "" {
		return "", fmt.Errorf("GitHub response had no tag_name")
	}
	return strings.TrimPrefix(parsed.TagName, "v"), nil
}

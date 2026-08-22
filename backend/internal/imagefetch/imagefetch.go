// Package imagefetch fetches a single static image from a direct URL — no
// yt-dlp involved. yt-dlp's extractors don't reliably handle a bare image
// link (it's built for video-hosting pages), so the "image" download type,
// and the New Download dialog's live preview of one, both bypass it in
// favor of a plain HTTP GET.
package imagefetch

import (
	"context"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"
)

const fetchTimeout = 5 * time.Minute

// previewTimeout bounds Open specifically — a live dialog preview shouldn't
// be able to hang a request for as long as a real download is allowed to.
const previewTimeout = 20 * time.Second

// contentTypeExt maps a normalized (charset-stripped) image Content-Type to
// the extension Fetch writes. Anything not in this set is rejected rather
// than guessed — the "image" download type is scoped to a single direct
// image link, so a URL that doesn't serve a recognized image/* type (e.g.
// an HTML gallery page) fails fast with a clear error instead of silently
// writing a misleadingly-named file. Also doubles as Open's allowlist of
// what it'll proxy through to a preview <img>.
var contentTypeExt = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
	"image/gif":  ".gif",
	"image/bmp":  ".bmp",
	"image/avif": ".avif",
	"image/tiff": ".tiff",
}

// newClient builds an http.Client that routes through proxyURL — the same
// value (and same http/https/socks5 schemes) already accepted by the
// ytdlp_proxy setting/yt-dlp's own --proxy flag — or connects directly when
// proxyURL is "". A malformed proxyURL is a real error, not silently
// downgraded to a direct connection, since that would defeat the point of
// configuring one in the first place.
func newClient(proxyURL string, timeout time.Duration) (*http.Client, error) {
	transport := http.DefaultTransport
	if proxyURL != "" {
		parsed, err := url.Parse(proxyURL)
		if err != nil {
			return nil, fmt.Errorf("invalid proxy URL: %w", err)
		}
		transport = &http.Transport{Proxy: http.ProxyURL(parsed)}
	}
	return &http.Client{Timeout: timeout, Transport: transport}, nil
}

// open issues the GET shared by Fetch and Open, validating the response is
// one of the recognized image Content-Types. No deadline is applied here —
// ctx and timeout (via newClient) are entirely the caller's to manage, since
// Fetch fully drains the body before returning (safe to bound with a defer)
// while Open hands the still-open body back to a caller that reads it after
// this function has already returned (a deferred cancel here would abort
// that read immediately). On any error the response body is closed before
// returning; on success the caller owns closing it.
func open(ctx context.Context, targetURL, proxyURL string, timeout time.Duration) (resp *http.Response, ext string, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return nil, "", fmt.Errorf("building request: %w", err)
	}

	client, err := newClient(proxyURL, timeout)
	if err != nil {
		return nil, "", err
	}
	resp, err = client.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("fetching image: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		resp.Body.Close()
		return nil, "", fmt.Errorf("fetching image: unexpected status %s", resp.Status)
	}

	mediaType, _, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if err != nil {
		resp.Body.Close()
		return nil, "", fmt.Errorf("fetching image: no usable Content-Type: %w", err)
	}
	ext, ok := contentTypeExt[mediaType]
	if !ok {
		resp.Body.Close()
		return nil, "", fmt.Errorf("fetching image: unsupported Content-Type %q — this only accepts a direct link to an image file", mediaType)
	}
	return resp, ext, nil
}

// Fetch downloads targetURL and writes it to destDir/baseFilename<ext>,
// where <ext> is derived from the response's Content-Type header. Downloads
// to a temp file in destDir first, then os.Rename()s over the final path
// (same-filesystem rename is atomic), so a timeout/cancel/crash mid-download
// never leaves a truncated file at the real destination. If forceOverwrite
// is false and the destination already exists, fails without touching it —
// mirrors downloader.DownloadJob.ForceOverwrite's --no-force-overwrites
// default. See newClient for proxyURL's meaning.
func Fetch(ctx context.Context, targetURL, destDir, baseFilename string, forceOverwrite bool, proxyURL string) (finalPath string, sizeBytes int64, err error) {
	ctx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()

	resp, ext, err := open(ctx, targetURL, proxyURL, fetchTimeout)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()

	finalPath = filepath.Join(destDir, baseFilename+ext)
	if !forceOverwrite {
		if _, statErr := os.Stat(finalPath); statErr == nil {
			return "", 0, fmt.Errorf("fetching image: %s already exists", finalPath)
		}
	}

	tmp, err := os.CreateTemp(destDir, baseFilename+"-*.tmp")
	if err != nil {
		return "", 0, fmt.Errorf("creating temp file: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath) // no-op once the rename below succeeds

	written, err := io.Copy(tmp, resp.Body)
	if err != nil {
		tmp.Close()
		return "", 0, fmt.Errorf("writing image: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return "", 0, fmt.Errorf("writing image: %w", err)
	}

	if err := os.Rename(tmpPath, finalPath); err != nil {
		return "", 0, fmt.Errorf("finalizing image: %w", err)
	}

	return finalPath, written, nil
}

// Open fetches targetURL the same way Fetch does — same proxy handling,
// same Content-Type allowlist — but returns the live response body for
// streaming straight through to an HTTP client instead of writing it to
// disk. Used by the New Download dialog's live image preview (both the
// direct-image-URL preview and the yt-dlp-reported thumbnail preview), so
// that fetch goes out from the backend — through the configured proxy —
// rather than as a direct client-side <img> request that would bypass it
// entirely.
//
// The caller must close the returned body, and defer the returned cancel
// after that (in that order) — cancel exists so the previewTimeout deadline
// is actually enforced (an abandoned read that never closes body would
// otherwise leak the timer/goroutine), but calling it before body is fully
// read/closed would abort the stream.
func Open(ctx context.Context, targetURL, proxyURL string) (body io.ReadCloser, contentType string, size int64, cancel func(), err error) {
	ctx, cancel = context.WithTimeout(ctx, previewTimeout)
	resp, _, err := open(ctx, targetURL, proxyURL, previewTimeout)
	if err != nil {
		cancel()
		return nil, "", 0, func() {}, err
	}
	return resp.Body, resp.Header.Get("Content-Type"), resp.ContentLength, cancel, nil
}

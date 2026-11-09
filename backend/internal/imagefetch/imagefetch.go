// Package imagefetch fetches a single static image from a direct URL — no
// yt-dlp involved. yt-dlp's extractors don't reliably handle a bare image
// link (it's built for video-hosting pages), so the "image" download type,
// and the New Download dialog's live preview of one, both bypass it in
// favor of a plain HTTP GET.
package imagefetch

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const fetchTimeout = 5 * time.Minute

// previewTimeout bounds Open specifically — a live dialog preview shouldn't
// be able to hang a request for as long as a real download is allowed to.
const previewTimeout = 20 * time.Second

// Size limits, in one place.
const (
	MaxThumbnailBytes     int64 = 25 << 20  // thumbnails and live previews
	MaxImageDownloadBytes int64 = 200 << 20 // image-type downloads
)

const maxRedirects = 10

// Policy says how much a fetch's URL is trusted and how large a body it may
// return. BlockPrivate is for URLs a remote party chose (a thumbnail named in
// a page's metadata): it refuses loopback, link-local (incl. the cloud
// metadata address), private, CGNAT, multicast and other non-public
// destinations. URLs the admin typed themselves stay unblocked — fetching
// from a LAN host is legitimate there — and get only the size cap.
type Policy struct {
	// BlockPrivate refuses non-public destinations (see blockedAddr).
	BlockPrivate bool
	// MaxBytes caps the body; 0 means MaxThumbnailBytes.
	MaxBytes int64
}

var (
	// ThumbnailPolicy is for a thumbnail URL taken from remote metadata.
	ThumbnailPolicy = Policy{BlockPrivate: true, MaxBytes: MaxThumbnailBytes}
	// PreviewPolicy is for the New Download dialog's preview: the URL is the
	// admin's (typed, or a thumbnail yt-dlp reported for it), so size cap only.
	PreviewPolicy = Policy{MaxBytes: MaxThumbnailBytes}
	// DownloadPolicy is for an admin-typed image download: size cap only.
	DownloadPolicy = Policy{MaxBytes: MaxImageDownloadBytes}
)

// ErrBlockedAddress is returned (wrapped) when BlockPrivate refuses a
// destination.
var ErrBlockedAddress = errors.New("refusing to connect to a private or non-public address")

func (p Policy) maxBytes() int64 {
	if p.MaxBytes <= 0 {
		return MaxThumbnailBytes
	}
	return p.MaxBytes
}

func limitMessage(n int64) string {
	return fmt.Sprintf("image larger than the %d MB limit", n>>20)
}

var (
	cgnat       = netip.MustParsePrefix("100.64.0.0/10")
	reservedV4  = netip.MustParsePrefix("240.0.0.0/4") // incl. 255.255.255.255
	thisNetwork = netip.MustParsePrefix("0.0.0.0/8")
	nat64       = netip.MustParsePrefix("64:ff9b::/96")
)

// blockedAddr reports whether ip is not a public unicast address. IPv4-mapped
// (and NAT64-embedded) IPv6 forms are unwrapped first.
func blockedAddr(ip netip.Addr) bool {
	ip = ip.Unmap().WithZone("")
	if ip.Is6() && nat64.Contains(ip) {
		b := ip.As16()
		ip = netip.AddrFrom4([4]byte{b[12], b[13], b[14], b[15]})
	}
	switch {
	case !ip.IsValid(), ip.IsLoopback(), ip.IsUnspecified(), ip.IsLinkLocalUnicast(),
		ip.IsLinkLocalMulticast(), ip.IsInterfaceLocalMulticast(), ip.IsMulticast(), ip.IsPrivate():
		return true
	}
	return ip.Is4() && (cgnat.Contains(ip) || reservedV4.Contains(ip) || thisNetwork.Contains(ip))
}

// isBlockedAddr is blockedAddr behind a variable so tests can treat their
// httptest servers (which live on 127.0.0.1) as public.
var isBlockedAddr = blockedAddr

// guardControl is a net.Dialer Control hook: it sees the resolved IP actually
// being connected to, so one rule covers DNS rebinding and every redirect hop.
func guardControl(_, address string, _ syscall.RawConn) error {
	ap, err := netip.ParseAddrPort(address)
	if err != nil {
		return fmt.Errorf("%w: %s", ErrBlockedAddress, address)
	}
	if isBlockedAddr(ap.Addr()) {
		return fmt.Errorf("%w: %s", ErrBlockedAddress, ap.Addr().Unmap())
	}
	return nil
}

// checkHostLiteral is the pre-flight used in proxy mode, where the dialer only
// ever sees the proxy: it refuses "localhost", "*.localhost" and literal IPs
// in blocked ranges. Other names are the proxy's responsibility.
func checkHostLiteral(u *url.URL) error {
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return fmt.Errorf("%w: %s", ErrBlockedAddress, host)
	}
	if ip, err := netip.ParseAddr(host); err == nil && isBlockedAddr(ip) {
		return fmt.Errorf("%w: %s", ErrBlockedAddress, host)
	}
	return nil
}

// checkURL validates one hop's URL: http(s) only, plus the literal-host
// pre-flight when an untrusted fetch goes through a proxy.
func checkURL(u *url.URL, proxied bool, policy Policy) error {
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("unsupported URL scheme %q", u.Scheme)
	}
	if policy.BlockPrivate && proxied {
		return checkHostLiteral(u)
	}
	return nil
}

// newClient builds an http.Client that routes through proxyURL — the same
// value (and same http/https/socks5 schemes) already accepted by the
// ytdlp_proxy setting/yt-dlp's own --proxy flag — or connects directly when
// proxyURL is "". A malformed proxyURL is a real error, not silently
// downgraded to a direct connection, since that would defeat the point of
// configuring one in the first place.
//
// With policy.BlockPrivate and a direct connection, the transport's dialer
// refuses blocked addresses at connect time. With a proxy the dialer connects
// to the proxy (which must stay reachable even on the LAN), so the request URL
// and each redirect target get the literal check instead. The environment
// proxy (HTTP_PROXY) is not consulted for untrusted direct fetches.
func newClient(proxyURL string, timeout time.Duration, policy Policy) (*http.Client, error) {
	var transport http.RoundTripper = http.DefaultTransport
	proxied := false
	if proxyURL != "" {
		// The shared per-proxy transport (see ProxyTransport): connections to the
		// proxy are reused across fetches. Only this trusted-proxy path shares it;
		// the untrusted direct path below keeps its own guarded transport.
		t, err := ProxyTransport(proxyURL)
		if err != nil {
			return nil, err
		}
		transport = t
		proxied = true
	} else if policy.BlockPrivate {
		t := http.DefaultTransport.(*http.Transport).Clone()
		t.Proxy = nil
		d := &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second, Control: guardControl}
		t.DialContext = d.DialContext
		transport = t
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirects {
				return fmt.Errorf("stopped after %d redirects", maxRedirects)
			}
			return checkURL(req.URL, proxied, policy)
		},
	}, nil
}

// limitedBody errors (rather than silently truncating) once the server tries
// to send more than max bytes, so a hostile server can't stream forever.
type limitedBody struct {
	rc   io.ReadCloser
	left int64
	max  int64
}

func (l *limitedBody) Read(p []byte) (int, error) {
	if l.left <= 0 {
		// At the limit: only a clean EOF is acceptable.
		var one [1]byte
		n, err := l.rc.Read(one[:])
		if n > 0 {
			return 0, errors.New(limitMessage(l.max))
		}
		return 0, err
	}
	if int64(len(p)) > l.left {
		p = p[:l.left]
	}
	n, err := l.rc.Read(p)
	l.left -= int64(n)
	return n, err
}

func (l *limitedBody) Close() error { return l.rc.Close() }

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

// open issues the GET shared by Fetch and Open, validating the response is
// one of the recognized image Content-Types and its declared length is within
// policy. No deadline is applied here —
// ctx and timeout (via newClient) are entirely the caller's to manage, since
// Fetch fully drains the body before returning (safe to bound with a defer)
// while Open hands the still-open body back to a caller that reads it after
// this function has already returned (a deferred cancel here would abort
// that read immediately). On any error the response body is closed before
// returning; on success the caller owns closing it.
func open(ctx context.Context, targetURL, proxyURL string, timeout time.Duration, policy Policy) (resp *http.Response, ext string, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return nil, "", fmt.Errorf("building request: %w", err)
	}
	if err := checkURL(req.URL, proxyURL != "", policy); err != nil {
		return nil, "", fmt.Errorf("fetching image: %w", err)
	}

	client, err := newClient(proxyURL, timeout, policy)
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
	if resp.ContentLength > policy.maxBytes() {
		resp.Body.Close()
		return nil, "", fmt.Errorf("fetching image: %s", limitMessage(policy.maxBytes()))
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
// default. See newClient for proxyURL's meaning and Policy for policy; a body
// over policy.MaxBytes fails and leaves no temp file behind.
func Fetch(ctx context.Context, targetURL, destDir, baseFilename string, forceOverwrite bool, proxyURL string, policy Policy) (finalPath string, sizeBytes int64, err error) {
	ctx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()

	resp, ext, err := open(ctx, targetURL, proxyURL, fetchTimeout, policy)
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

	limit := policy.maxBytes()
	written, err := io.Copy(tmp, io.LimitReader(resp.Body, limit+1))
	if err == nil && written > limit {
		err = errors.New(limitMessage(limit))
	}
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
// entirely. The returned body errors once the server sends more than
// policy.MaxBytes.
//
// The caller must close the returned body, and defer the returned cancel
// after that (in that order) — cancel exists so the previewTimeout deadline
// is actually enforced (an abandoned read that never closes body would
// otherwise leak the timer/goroutine), but calling it before body is fully
// read/closed would abort the stream.
func Open(ctx context.Context, targetURL, proxyURL string, policy Policy) (body io.ReadCloser, contentType string, size int64, cancel func(), err error) {
	ctx, cancel = context.WithTimeout(ctx, previewTimeout)
	resp, _, err := open(ctx, targetURL, proxyURL, previewTimeout, policy)
	if err != nil {
		cancel()
		return nil, "", 0, func() {}, err
	}
	lim := policy.maxBytes()
	return &limitedBody{rc: resp.Body, left: lim, max: lim}, resp.Header.Get("Content-Type"), resp.ContentLength, cancel, nil
}

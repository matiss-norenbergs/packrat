package config

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"packrat/backend/internal/hostactions"
)

// DefaultCORSAllowedOrigins are the origins the Packrat desktop app (Tauri) loads its UI from:
// macOS/Linux use tauri://localhost, Windows http(s)://tauri.localhost.
var DefaultCORSAllowedOrigins = []string{
	"tauri://localhost",
	"http://tauri.localhost",
	"https://tauri.localhost",
}

type Config struct {
	Port                    string
	DBPath                  string
	MediaRoot               string
	ImagesRoot              string
	BackupsRoot             string
	CacheRoot               string
	MaxConcurrentDownloads  int
	MaxConcurrentTranscodes int
	YtDlpPath               string
	FFmpegPath              string
	FFProbePath             string
	PipPath                 string
	// HostActions are the sidebar Actions menu entries, from PACKRAT_ACTION_<N>_* env vars.
	HostActions []hostactions.Action
	// CORSAllowedOrigins is CORS_ALLOWED_ORIGINS (comma-separated): origins besides the server's
	// own that may call the API from a browser context — the desktop app's. Defaults to the Tauri
	// origins.
	CORSAllowedOrigins []string
	// TrustedProxies is TRUSTED_PROXIES (comma-separated IPs/CIDRs): reverse proxies whose
	// X-Forwarded-For is believed when determining the client IP. Empty (default) trusts none.
	TrustedProxies []string
}

func Load() (Config, error) {
	cfg := Config{
		Port:                    getEnv("PORT", "50505"),
		DBPath:                  getEnv("DB_PATH", "./data/db/packrat.db"),
		MediaRoot:               getEnv("MEDIA_ROOT", "./data/media"),
		ImagesRoot:              getEnv("IMAGES_ROOT", "./data/images"),
		BackupsRoot:             getEnv("BACKUPS_ROOT", "./data/backups"),
		CacheRoot:               getEnv("CACHE_ROOT", "./data/cache"),
		MaxConcurrentDownloads:  2,
		MaxConcurrentTranscodes: 2,
		YtDlpPath:               getEnv("YTDLP_PATH", "yt-dlp"),
		FFmpegPath:              getEnv("FFMPEG_PATH", "ffmpeg"),
		FFProbePath:             getEnv("FFPROBE_PATH", "ffprobe"),
		PipPath:                 getEnv("PIP_PATH", "pip"),
	}

	if raw := os.Getenv("MAX_CONCURRENT_DOWNLOADS"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			return Config{}, fmt.Errorf("invalid MAX_CONCURRENT_DOWNLOADS %q: must be a positive integer", raw)
		}
		cfg.MaxConcurrentDownloads = n
	}

	if raw := os.Getenv("MAX_CONCURRENT_FFMPEG_TRANSCODES"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			return Config{}, fmt.Errorf("invalid MAX_CONCURRENT_FFMPEG_TRANSCODES %q: must be a positive integer", raw)
		}
		cfg.MaxConcurrentTranscodes = n
	}

	cfg.CORSAllowedOrigins = DefaultCORSAllowedOrigins
	if raw := os.Getenv("CORS_ALLOWED_ORIGINS"); raw != "" {
		origins, err := parseOrigins(raw)
		if err != nil {
			return Config{}, fmt.Errorf("invalid CORS_ALLOWED_ORIGINS: %w", err)
		}
		cfg.CORSAllowedOrigins = origins
	}

	if raw := os.Getenv("TRUSTED_PROXIES"); raw != "" {
		proxies, err := parseTrustedProxies(raw)
		if err != nil {
			return Config{}, fmt.Errorf("invalid TRUSTED_PROXIES: %w", err)
		}
		cfg.TrustedProxies = proxies
	}

	actions, err := hostactions.Parse(os.Environ())
	if err != nil {
		return Config{}, fmt.Errorf("invalid host action config: %w", err)
	}
	cfg.HostActions = actions

	mediaRoot, err := filepath.Abs(cfg.MediaRoot)
	if err != nil {
		return Config{}, fmt.Errorf("resolving MEDIA_ROOT: %w", err)
	}
	if err := os.MkdirAll(mediaRoot, 0o755); err != nil {
		return Config{}, fmt.Errorf("creating MEDIA_ROOT %q: %w", mediaRoot, err)
	}
	cfg.MediaRoot = mediaRoot

	imagesRoot, err := filepath.Abs(cfg.ImagesRoot)
	if err != nil {
		return Config{}, fmt.Errorf("resolving IMAGES_ROOT: %w", err)
	}
	if err := os.MkdirAll(imagesRoot, 0o755); err != nil {
		return Config{}, fmt.Errorf("creating IMAGES_ROOT %q: %w", imagesRoot, err)
	}
	cfg.ImagesRoot = imagesRoot

	backupsRoot, err := filepath.Abs(cfg.BackupsRoot)
	if err != nil {
		return Config{}, fmt.Errorf("resolving BACKUPS_ROOT: %w", err)
	}
	if err := os.MkdirAll(backupsRoot, 0o755); err != nil {
		return Config{}, fmt.Errorf("creating BACKUPS_ROOT %q: %w", backupsRoot, err)
	}
	cfg.BackupsRoot = backupsRoot

	// Not created here: the resizer creates it (and its shard dirs) on first
	// use, so an unused cache leaves nothing behind.
	cacheRoot, err := filepath.Abs(cfg.CacheRoot)
	if err != nil {
		return Config{}, fmt.Errorf("resolving CACHE_ROOT: %w", err)
	}
	cfg.CacheRoot = cacheRoot

	dbDir := filepath.Dir(cfg.DBPath)
	if err := os.MkdirAll(dbDir, 0o755); err != nil {
		return Config{}, fmt.Errorf("creating DB_PATH directory %q: %w", dbDir, err)
	}

	return cfg, nil
}

// parseOrigins splits a comma-separated origin list, dropping blanks and trailing slashes. A bare
// "*" is rejected: the API is meant to be callable only from named origins.
func parseOrigins(raw string) ([]string, error) {
	var out []string
	for _, o := range strings.Split(raw, ",") {
		o = strings.TrimRight(strings.TrimSpace(o), "/")
		if o == "" {
			continue
		}
		if o == "*" {
			return nil, fmt.Errorf("wildcard origins are not supported; list each origin explicitly")
		}
		out = append(out, o)
	}
	return out, nil
}

// parseTrustedProxies splits a comma-separated list of IPs and CIDRs, rejecting anything else.
func parseTrustedProxies(raw string) ([]string, error) {
	var out []string
	for _, p := range strings.Split(raw, ",") {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if _, _, err := net.ParseCIDR(p); err != nil && net.ParseIP(p) == nil {
			return nil, fmt.Errorf("%q is not an IP address or CIDR", p)
		}
		out = append(out, p)
	}
	return out, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

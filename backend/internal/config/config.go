package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

type Config struct {
	Port                   string
	DBPath                 string
	MediaRoot              string
	MaxConcurrentDownloads int
	YtDlpPath              string
	FFmpegPath             string
}

func Load() (Config, error) {
	cfg := Config{
		Port:                   getEnv("PORT", "8080"),
		DBPath:                 getEnv("DB_PATH", "./data/db/packrat.db"),
		MediaRoot:              getEnv("MEDIA_ROOT", "./data/media"),
		MaxConcurrentDownloads: 2,
		YtDlpPath:              getEnv("YTDLP_PATH", "yt-dlp"),
		FFmpegPath:             getEnv("FFMPEG_PATH", "ffmpeg"),
	}

	if raw := os.Getenv("MAX_CONCURRENT_DOWNLOADS"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			return Config{}, fmt.Errorf("invalid MAX_CONCURRENT_DOWNLOADS %q: must be a positive integer", raw)
		}
		cfg.MaxConcurrentDownloads = n
	}

	mediaRoot, err := filepath.Abs(cfg.MediaRoot)
	if err != nil {
		return Config{}, fmt.Errorf("resolving MEDIA_ROOT: %w", err)
	}
	if err := os.MkdirAll(mediaRoot, 0o755); err != nil {
		return Config{}, fmt.Errorf("creating MEDIA_ROOT %q: %w", mediaRoot, err)
	}
	cfg.MediaRoot = mediaRoot

	dbDir := filepath.Dir(cfg.DBPath)
	if err := os.MkdirAll(dbDir, 0o755); err != nil {
		return Config{}, fmt.Errorf("creating DB_PATH directory %q: %w", dbDir, err)
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

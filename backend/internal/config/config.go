package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

type Config struct {
	Port                    string
	DBPath                  string
	MediaRoot               string
	ImagesRoot              string
	BackupsRoot             string
	MaxConcurrentDownloads  int
	MaxConcurrentTranscodes int
	YtDlpPath               string
	FFmpegPath              string
	FFProbePath             string
	PipPath                 string
}

func Load() (Config, error) {
	cfg := Config{
		Port:                    getEnv("PORT", "50505"),
		DBPath:                  getEnv("DB_PATH", "./data/db/packrat.db"),
		MediaRoot:               getEnv("MEDIA_ROOT", "./data/media"),
		ImagesRoot:              getEnv("IMAGES_ROOT", "./data/images"),
		BackupsRoot:             getEnv("BACKUPS_ROOT", "./data/backups"),
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

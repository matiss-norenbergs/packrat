package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"packrat/backend/internal/api"
	"packrat/backend/internal/config"
	"packrat/backend/internal/db"
	"packrat/backend/internal/downloader"
	"packrat/backend/internal/jellyfin"
	"packrat/backend/internal/models"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/ws"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

// historyCleanupInterval is how often the retention sweep checks in — an
// implementation detail, not user-facing (the user only configures *how
// long* to keep history, via SettingHistoryRetentionDays; how often the
// sweep runs doesn't need its own setting).
const historyCleanupInterval = time.Hour

// cleanupHistory deletes history entries older than the configured
// retention window. A zero/unset/corrupt setting means "keep forever," so
// this is a no-op by default until the user opts in.
func cleanupHistory(ctx context.Context, historyRepo *repository.HistoryRepo, settingsRepo *repository.SettingsRepo) {
	raw, err := settingsRepo.Get(ctx, models.SettingHistoryRetentionDays)
	days, convErr := strconv.Atoi(raw)
	if err != nil || convErr != nil || days <= 0 {
		return
	}
	cutoff := time.Now().AddDate(0, 0, -days)
	n, err := historyRepo.DeleteOlderThan(ctx, cutoff)
	if err != nil {
		log.Printf("history cleanup failed: %v", err)
		return
	}
	if n > 0 {
		log.Printf("history cleanup: removed %d entries older than %d days", n, days)
	}
}

// cleanupDownloadLog deletes download log entries (the downloads table —
// same rows the live queue and Logs page read) older than the configured
// retention window. Mirrors cleanupHistory exactly; DeleteOlderThan itself
// guards against ever touching a still-active row regardless of age.
func cleanupDownloadLog(ctx context.Context, downloadsRepo *repository.DownloadsRepo, settingsRepo *repository.SettingsRepo) {
	raw, err := settingsRepo.Get(ctx, models.SettingDownloadLogRetentionDays)
	days, convErr := strconv.Atoi(raw)
	if err != nil || convErr != nil || days <= 0 {
		return
	}
	cutoff := time.Now().AddDate(0, 0, -days)
	n, err := downloadsRepo.DeleteOlderThan(ctx, cutoff)
	if err != nil {
		log.Printf("download log cleanup failed: %v", err)
		return
	}
	if n > 0 {
		log.Printf("download log cleanup: removed %d entries older than %d days", n, days)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log.Printf("config loaded: port=%s dbPath=%s mediaRoot=%s maxConcurrentDownloads=%d",
		cfg.Port, cfg.DBPath, cfg.MediaRoot, cfg.MaxConcurrentDownloads)

	conn, err := db.Open(cfg.DBPath)
	if err != nil {
		return err
	}
	defer conn.Close()

	migrationsDir := os.Getenv("MIGRATIONS_DIR")
	if migrationsDir == "" {
		migrationsDir = "../database/migrations"
	}
	if err := db.Migrate(conn, migrationsDir); err != nil {
		return err
	}
	log.Println("migrations applied")

	downloadsRepo := repository.NewDownloadsRepo(conn)
	libraryRepo := repository.NewLibraryRepo(conn)
	collectionsRepo := repository.NewCollectionsRepo(conn)
	settingsRepo := repository.NewSettingsRepo(conn)
	historyRepo := repository.NewHistoryRepo(conn)
	tagsRepo := repository.NewTagsRepo(conn)
	artistsRepo := repository.NewArtistsRepo(conn)
	usersRepo := repository.NewUsersRepo(conn)
	ytdlpSvc := downloader.NewYtDlpService(cfg.YtDlpPath, cfg.FFmpegPath, cfg.PipPath)
	progressStore := queue.NewProgressStore()
	jellyfinClient := jellyfin.NewClient()

	ctx, stopSignals := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stopSignals()

	hub := ws.NewHub()
	go hub.Run(ctx)

	mgr := queue.NewDownloadManager(cfg.MediaRoot, ytdlpSvc, downloadsRepo, libraryRepo, collectionsRepo, historyRepo, artistsRepo, tagsRepo, settingsRepo, jellyfinClient, progressStore, hub)

	interrupted, err := downloadsRepo.MarkInterruptedIfActive(ctx)
	if err != nil {
		return err
	}
	if len(interrupted) > 0 {
		log.Printf("crash recovery: marked %d in-progress download(s) as interrupted", len(interrupted))
		for _, d := range interrupted {
			if _, err := historyRepo.Create(ctx, &d.ID, d.URL, "interrupted", nil); err != nil {
				log.Printf("crash recovery: recording history for %d failed: %v", d.ID, err)
			}
		}
	}

	// A previously-saved concurrency setting survives a restart — the env
	// var is only the fallback for a fresh database.
	workerCount := cfg.MaxConcurrentDownloads
	if saved, err := settingsRepo.Get(ctx, models.SettingMaxConcurrentDownloads); err == nil {
		if n, err := strconv.Atoi(saved); err == nil && n > 0 {
			workerCount = n
		}
	}
	mgr.Start(ctx, workerCount)

	go func() {
		// Both sweeps share one ticker — they run on the same cadence and
		// each is already a no-op when its own retention setting is unset.
		cleanupHistory(ctx, historyRepo, settingsRepo) // once immediately, so a just-raised retention takes effect right away
		cleanupDownloadLog(ctx, downloadsRepo, settingsRepo)
		ticker := time.NewTicker(historyCleanupInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				cleanupHistory(ctx, historyRepo, settingsRepo)
				cleanupDownloadLog(ctx, downloadsRepo, settingsRepo)
			}
		}
	}()

	router := api.SetupRouter(api.Deps{
		DB:              conn,
		Manager:         mgr,
		DownloadsRepo:   downloadsRepo,
		LibraryRepo:     libraryRepo,
		CollectionsRepo: collectionsRepo,
		SettingsRepo:    settingsRepo,
		HistoryRepo:     historyRepo,
		TagsRepo:        tagsRepo,
		ArtistsRepo:     artistsRepo,
		UsersRepo:       usersRepo,
		YtDlp:           ytdlpSvc,
		JellyfinClient:  jellyfinClient,
		MediaRoot:       cfg.MediaRoot,
		FFProbePath:     cfg.FFProbePath,
		WSHandler:       hub.GinHandler(),
		StaticDir:       os.Getenv("STATIC_DIR"),
	})

	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: router,
	}

	go func() {
		log.Printf("listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}

package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"packrat/backend/internal/api"
	"packrat/backend/internal/config"
	"packrat/backend/internal/db"
	"packrat/backend/internal/downloader"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/ws"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
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
	ytdlpSvc := downloader.NewYtDlpService(cfg.YtDlpPath, cfg.FFmpegPath)
	progressStore := queue.NewProgressStore()

	ctx, stopSignals := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stopSignals()

	hub := ws.NewHub()
	go hub.Run(ctx)

	mgr := queue.NewDownloadManager(cfg.MediaRoot, ytdlpSvc, downloadsRepo, libraryRepo, collectionsRepo, progressStore, hub)

	interrupted, err := downloadsRepo.MarkInterruptedIfActive(ctx)
	if err != nil {
		return err
	}
	if interrupted > 0 {
		log.Printf("crash recovery: marked %d in-progress download(s) as interrupted", interrupted)
	}

	mgr.Start(ctx, cfg.MaxConcurrentDownloads)

	router := api.SetupRouter(api.Deps{
		DB:              conn,
		Manager:         mgr,
		DownloadsRepo:   downloadsRepo,
		LibraryRepo:     libraryRepo,
		CollectionsRepo: collectionsRepo,
		MediaRoot:       cfg.MediaRoot,
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

package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"packrat/backend/internal/api"
	"packrat/backend/internal/backup"
	"packrat/backend/internal/bgtasks"
	"packrat/backend/internal/config"
	"packrat/backend/internal/db"
	"packrat/backend/internal/downloader"
	"packrat/backend/internal/framematch"
	"packrat/backend/internal/fsutil"
	"packrat/backend/internal/imagebackfill"
	"packrat/backend/internal/imageproc"
	"packrat/backend/internal/jellyfin"
	"packrat/backend/internal/models"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/subscriptions"
	"packrat/backend/internal/thumbnailenhance"
	"packrat/backend/internal/twofactor"
	"packrat/backend/internal/ws"
)

func main() {
	if handled, err := runAdmin(os.Args[1:]); handled {
		if err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			os.Exit(1)
		}
		return
	}
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

// cleanupImageCache deletes resized-image cache files (GET /api/image) not
// accessed within imageproc.ResizeCacheMaxAge. Stale variants (source
// overwritten in place) are orphaned rather than invalidated, so this is
// what reclaims them.
func cleanupImageCache(cacheRoot string) {
	n, err := imageproc.SweepCache(cacheRoot, imageproc.ResizeCacheMaxAge, time.Now())
	if err != nil {
		log.Printf("image cache cleanup failed: %v", err)
		return
	}
	if n > 0 {
		log.Printf("image cache cleanup: removed %d file(s) not accessed in %s", n, imageproc.ResizeCacheMaxAge)
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

// cleanupThumbnailEnhancementHistory deletes AI Enhancement history entries
// older than the configured retention window, mirroring cleanupHistory/
// cleanupDownloadLog. deps already bundles the settings repo it reads the
// retention setting from.
func cleanupThumbnailEnhancementHistory(ctx context.Context, deps thumbnailenhance.Deps) {
	raw, err := deps.SettingsRepo.Get(ctx, models.SettingThumbnailEnhancementRetentionDays)
	days, convErr := strconv.Atoi(raw)
	if err != nil || convErr != nil || days <= 0 {
		return
	}
	cutoff := time.Now().AddDate(0, 0, -days)
	n, err := thumbnailenhance.CleanupOldHistory(ctx, deps, cutoff)
	if err != nil {
		log.Printf("thumbnail enhancement history cleanup failed: %v", err)
		return
	}
	if n > 0 {
		log.Printf("thumbnail enhancement history cleanup: removed %d entries older than %d days", n, days)
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

	if err := db.Migrate(conn, migrationsDir()); err != nil {
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
	compareListRepo := repository.NewCompareListRepo(conn)
	usersRepo := repository.NewUsersRepo(conn)
	// Encrypts 2FA secrets. The default key file lives in the data volume next to the DB, like the
	// cookies file; PACKRAT_SECRET_KEY overrides it.
	secretCrypto, err := twofactor.LoadCrypto(cfg.SecretKey, filepath.Join(filepath.Dir(cfg.DBPath), "packrat-secret.key"))
	if err != nil {
		return err
	}
	backupHistoryRepo := repository.NewBackupHistoryRepo(conn)
	subscriptionsRepo := repository.NewSubscriptionsRepo(conn)
	thumbnailEnhancementHistoryRepo := repository.NewThumbnailEnhancementHistoryRepo(conn)
	thumbnailEnhancementOriginalsRepo := repository.NewThumbnailEnhancementOriginalsRepo(conn)
	thumbnailGalleryRepo := repository.NewThumbnailGalleryRepo(conn)
	ytdlpSvc := downloader.NewYtDlpService(cfg.YtDlpPath, cfg.FFmpegPath, cfg.PipPath, settingsRepo, cfg.MaxConcurrentTranscodes)
	// Lives next to the DB rather than under MediaRoot/BackupsRoot — no new
	// volume mount required, since data/db is already persisted in both
	// docker-compose.yml and docker-compose.dev.yml.
	ytdlpSvc.CookiesFilePath = filepath.Join(filepath.Dir(cfg.DBPath), "ytdlp-cookies.txt")
	progressStore := queue.NewProgressStore()
	jellyfinClient := jellyfin.NewClient()

	// Shutdown: the signal context only announces it. ctx is the root context every background job
	// derives from; it is cancelled after the HTTP server has drained (see the end of run), so
	// in-flight requests are not cut off by their own jobs stopping. tasks tracks every long-lived or
	// detached goroutine so the database is only closed once they have finished.
	sigCtx, stopSignals := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stopSignals()
	ctx, cancelRoot := context.WithCancel(context.Background())
	defer cancelRoot()
	tasks := &bgtasks.Tracker{}

	hub := ws.NewHub()
	tasks.Go(func() { hub.Run(ctx) })
	// A live connection is tied to the session that opened it: it closes when that session goes.
	hub.SetSessionChecker(func(ctx context.Context, token string) bool {
		_, err := usersRepo.GetValidSession(ctx, token)
		return err == nil || !errors.Is(err, repository.ErrNotFound) // a DB hiccup never kicks anyone
	})
	usersRepo.SetOnSessionsRevoked(hub.RevalidateSessions)

	// A crash or restart mid-remux leaves EmbedMetadata temp files behind; drop
	// the abandoned ones (older than a remux can run). Off the startup path:
	// it walks the whole media tree.
	go func() {
		if n := fsutil.CleanStaleEmbedTemps(cfg.MediaRoot, downloader.MetadataEmbedTimeout); n > 0 {
			log.Printf("startup: removed %d abandoned metadata-embed temp file(s)", n)
		}
	}()
	mgr := queue.NewDownloadManager(cfg.MediaRoot, cfg.ImagesRoot, cfg.FFProbePath, ytdlpSvc, downloadsRepo, libraryRepo, collectionsRepo, historyRepo, artistsRepo, tagsRepo, settingsRepo, thumbnailEnhancementHistoryRepo, thumbnailEnhancementOriginalsRepo, jellyfinClient, progressStore, hub)
	mgr.SetTracker(tasks)
	imageBackfillMgr := imagebackfill.NewManager(cfg.MediaRoot, cfg.ImagesRoot, cfg.FFmpegPath, libraryRepo, artistsRepo, collectionsRepo)
	imageBackfillMgr.SetShutdown(ctx, tasks)
	frameMatchJobs := framematch.NewJobStore()
	frameMatchJobs.SetBaseContext(ctx)
	frameMatchQueueRepo := repository.NewFrameMatchQueueRepo(conn)

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

	// Same for frame-match rows: one still "running" belonged to the previous process. It becomes an
	// error row (not "queued" again — a file that crashes the process would crash-loop the server),
	// which must happen before the queue runner starts. No clients are connected yet, so nothing to broadcast.
	if n, err := framematch.ResetInterrupted(ctx, frameMatchQueueRepo); err != nil {
		return err
	} else if n > 0 {
		log.Printf("crash recovery: marked %d interrupted frame-match item(s) as errors", n)
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

	// Same survives-a-restart treatment as the download worker count above.
	transcodeLimit := cfg.MaxConcurrentTranscodes
	if saved, err := settingsRepo.Get(ctx, models.SettingMaxConcurrentTranscodes); err == nil {
		if n, err := strconv.Atoi(saved); err == nil && n > 0 {
			transcodeLimit = n
		}
	}
	ytdlpSvc.SetMaxConcurrentTranscodes(transcodeLimit)

	runDeps := backup.RunDeps{
		BackupsRoot:       cfg.BackupsRoot,
		SettingsRepo:      settingsRepo,
		CollectionsRepo:   collectionsRepo,
		TagsRepo:          tagsRepo,
		ArtistsRepo:       artistsRepo,
		LibraryRepo:       libraryRepo,
		DownloadsRepo:     downloadsRepo,
		BackupHistoryRepo: backupHistoryRepo,
		Broadcaster:       hub,
	}

	subCheckDeps := subscriptions.CheckDeps{
		SubscriptionsRepo: subscriptionsRepo,
		LibraryRepo:       libraryRepo,
		TagsRepo:          tagsRepo,
		CollectionsRepo:   collectionsRepo,
		Manager:           mgr,
		YtDlp:             ytdlpSvc,
		ImagesRoot:        cfg.ImagesRoot,
		SettingsRepo:      settingsRepo,
		Broadcaster:       hub,
	}

	enhanceDeps := thumbnailenhance.Deps{
		SettingsRepo:  settingsRepo,
		LibraryRepo:   libraryRepo,
		HistoryRepo:   thumbnailEnhancementHistoryRepo,
		OriginalsRepo: thumbnailEnhancementOriginalsRepo,
		MediaRoot:     cfg.MediaRoot,
		ImagesRoot:    cfg.ImagesRoot,
		FFmpegPath:    cfg.FFmpegPath,
		Broadcaster:   hub,
	}

	imageResizer := imageproc.NewResizer(cfg.FFmpegPath, cfg.CacheRoot)

	tasks.Go(func() {
		// All six sweeps share one ticker — they run on the same cadence
		// and each is already a no-op when its own setting is unset/not due.
		// The smallest auto-backup interval option is 6h, and subscriptions
		// default to 6h too, so hourly-granularity checking is more than
		// sufficient.
		cleanupHistory(ctx, historyRepo, settingsRepo) // once immediately, so a just-raised retention takes effect right away
		cleanupImageCache(cfg.CacheRoot)
		cleanupDownloadLog(ctx, downloadsRepo, settingsRepo)
		cleanupThumbnailEnhancementHistory(ctx, enhanceDeps)
		backup.RunScheduledBackupIfDue(ctx, runDeps)
		subscriptions.RunDueChecks(ctx, subCheckDeps)
		thumbnailenhance.RunDueEnhancements(ctx, enhanceDeps)
		ticker := time.NewTicker(historyCleanupInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				cleanupHistory(ctx, historyRepo, settingsRepo)
				cleanupImageCache(cfg.CacheRoot)
				cleanupDownloadLog(ctx, downloadsRepo, settingsRepo)
				cleanupThumbnailEnhancementHistory(ctx, enhanceDeps)
				backup.RunScheduledBackupIfDue(ctx, runDeps)
				subscriptions.RunDueChecks(ctx, subCheckDeps)
				thumbnailenhance.RunDueEnhancements(ctx, enhanceDeps)
			}
		}
	})

	tasks.Go(func() {
		framematch.RunQueue(ctx, framematch.QueueDeps{
			QueueRepo:    frameMatchQueueRepo,
			LibraryRepo:  libraryRepo,
			YtDlp:        ytdlpSvc,
			FFProbePath:  cfg.FFProbePath,
			MediaRoot:    cfg.MediaRoot,
			ImagesRoot:   cfg.ImagesRoot,
			SettingsRepo: settingsRepo,
			Broadcaster:  hub,
		})
	})

	router := api.SetupRouter(api.Deps{
		DB:                                conn,
		Manager:                           mgr,
		DownloadsRepo:                     downloadsRepo,
		LibraryRepo:                       libraryRepo,
		CollectionsRepo:                   collectionsRepo,
		SettingsRepo:                      settingsRepo,
		HistoryRepo:                       historyRepo,
		TagsRepo:                          tagsRepo,
		ArtistsRepo:                       artistsRepo,
		CompareListRepo:                   compareListRepo,
		UsersRepo:                         usersRepo,
		UserPreferencesRepo:               repository.NewUserPreferencesRepo(conn),
		UserTableLayoutsRepo:              repository.NewUserTableLayoutsRepo(conn),
		BackupHistoryRepo:                 backupHistoryRepo,
		SubscriptionsRepo:                 subscriptionsRepo,
		ThumbnailEnhancementHistoryRepo:   thumbnailEnhancementHistoryRepo,
		ThumbnailEnhancementOriginalsRepo: thumbnailEnhancementOriginalsRepo,
		ThumbnailGalleryRepo:              thumbnailGalleryRepo,
		YtDlp:                             ytdlpSvc,
		JellyfinClient:                    jellyfinClient,
		ImageBackfillManager:              imageBackfillMgr,
		Background:                        bgtasks.Runner{Ctx: ctx, Tracker: tasks},
		FrameMatchJobs:                    frameMatchJobs,
		FrameMatchQueueRepo:               frameMatchQueueRepo,
		MediaRoot:                         cfg.MediaRoot,
		ImagesRoot:                        cfg.ImagesRoot,
		BackupsRoot:                       cfg.BackupsRoot,
		ImageResizer:                      imageResizer,
		FFProbePath:                       cfg.FFProbePath,
		WSHandler:                         hub.GinHandler(),
		Broadcaster:                       hub,
		StaticDir:                         os.Getenv("STATIC_DIR"),
		HostActions:                       cfg.HostActions,
		CORSAllowedOrigins:                cfg.CORSAllowedOrigins,
		TrustedProxies:                    cfg.TrustedProxies,
		Auth:                              api.NewAuthDeps(usersRepo, secretCrypto, nil),
	})

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       5 * time.Minute,
		IdleTimeout:       2 * time.Minute,
		// No WriteTimeout: /media-files streams multi-gigabyte video files to
		// slow LAN clients, and it would also clip the response side of every
		// active /ws connection (which relies on its own read/write deadlines
		// in internal/ws/client.go, not this server-wide one) if it ever fired
		// mid-write. ReadHeaderTimeout + IdleTimeout + the request body cap in
		// router.go cover the slowloris-style DoS vectors this fix targets.
	}

	go func() {
		log.Printf("listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-sigCtx.Done()
	stopSignals() // a second signal now kills the process instead of being swallowed
	log.Println("shutting down")

	httpErr := shutdown(srv, cancelRoot, tasks, mgr.Embedder().Wait)
	// run returns next, and the deferred conn.Close runs: the database closes last.
	log.Println("shutdown: closing database")
	return httpErr
}

// Shutdown budget. Docker kills the container stopGracePeriod after SIGTERM, and the compose files
// set stop_grace_period: 30s, so httpShutdownTimeout + backgroundWaitTimeout (25 s) leaves 5 s for
// the final writes and closing the database.
const (
	httpShutdownTimeout   = 10 * time.Second
	backgroundWaitTimeout = 15 * time.Second
)

// shutdown stops accepting requests and lets in-flight ones finish, then cancels the root context
// so background jobs wind down, then waits (bounded) for them and for running metadata embeds. It
// never returns before the wait is over, so the caller can close the database safely.
func shutdown(srv *http.Server, cancelRoot context.CancelFunc, tasks *bgtasks.Tracker, waitEmbeds func()) error {
	httpCtx, cancel := context.WithTimeout(context.Background(), httpShutdownTimeout)
	defer cancel()
	httpErr := srv.Shutdown(httpCtx)
	if httpErr != nil {
		log.Printf("shutdown: http server did not drain cleanly: %v", httpErr)
	} else {
		log.Println("shutdown: http server stopped")
	}

	cancelRoot()
	start := time.Now()
	log.Printf("shutdown: waiting up to %s for %d background job(s)", backgroundWaitTimeout, tasks.Running())
	finished := tasks.Wait(backgroundWaitTimeout)
	if !finished {
		log.Printf("shutdown: timed out waiting for %d background job(s); closing the database anyway", tasks.Running())
	}

	// Running metadata remuxes are not cancelled (an interrupted remux is cleaned up at the next
	// start), so give them whatever is left of the budget.
	embedsDone := make(chan struct{})
	go func() {
		waitEmbeds()
		close(embedsDone)
	}()
	select {
	case <-embedsDone:
		if finished {
			log.Printf("shutdown: background jobs finished cleanly after %s", time.Since(start).Round(time.Millisecond))
		}
	case <-time.After(max(backgroundWaitTimeout-time.Since(start), 0)):
		log.Println("shutdown: timed out waiting for metadata embeds; closing the database anyway")
	}
	return httpErr
}

package api

import (
	"context"
	"database/sql"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/backup"
	"packrat/backend/internal/downloader"
	"packrat/backend/internal/framematch"
	"packrat/backend/internal/hostactions"
	"packrat/backend/internal/imagebackfill"
	"packrat/backend/internal/imageproc"
	"packrat/backend/internal/jellyfin"
	"packrat/backend/internal/models"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/subscriptions"
	"packrat/backend/internal/thumbnailenhance"
	"packrat/backend/internal/ws"
)

// Deps holds everything the router needs to wire up routes. Fields are added
// incrementally as the corresponding subsystems (queue, library, ws) land.
type Deps struct {
	DB                                *sql.DB
	Manager                           *queue.DownloadManager
	DownloadsRepo                     *repository.DownloadsRepo
	LibraryRepo                       *repository.LibraryRepo
	CollectionsRepo                   *repository.CollectionsRepo
	SettingsRepo                      *repository.SettingsRepo
	HistoryRepo                       *repository.HistoryRepo
	TagsRepo                          *repository.TagsRepo
	ArtistsRepo                       *repository.ArtistsRepo
	CompareListRepo                   *repository.CompareListRepo
	UsersRepo                         *repository.UsersRepo
	BackupHistoryRepo                 *repository.BackupHistoryRepo
	SubscriptionsRepo                 *repository.SubscriptionsRepo
	ThumbnailEnhancementHistoryRepo   *repository.ThumbnailEnhancementHistoryRepo
	ThumbnailEnhancementOriginalsRepo *repository.ThumbnailEnhancementOriginalsRepo
	ThumbnailGalleryRepo              *repository.ThumbnailGalleryRepo
	YtDlp                             *downloader.YtDlpService
	JellyfinClient                    *jellyfin.Client
	ImageBackfillManager              *imagebackfill.Manager
	FrameMatchJobs                    *framematch.JobStore
	FrameMatchQueueRepo               *repository.FrameMatchQueueRepo
	MediaRoot                         string
	ImagesRoot                        string
	BackupsRoot                       string
	ImageResizer                      *imageproc.Resizer // nil disables GET /api/image
	FFProbePath                       string
	WSHandler                         gin.HandlerFunc // set once the WS hub exists; nil is fine (no /ws route)
	Broadcaster                       ws.Broadcaster
	StaticDir                         string // built frontend assets; empty in dev (Vite serves it)
	HostActions                       []hostactions.Action
	// CORSAllowedOrigins are the cross-origin callers (the desktop app) allowed to use the API.
	CORSAllowedOrigins []string
	// Auth carries the login rate limiter and 2FA machinery shared by the credential handlers.
	Auth *AuthDeps
	// TrustedProxies are the addresses/CIDRs whose X-Forwarded-For is believed when working out the
	// client IP. Empty (the default) trusts none: the connection's own address is the client.
	TrustedProxies []string
}

// noCacheHeaders forces revalidation on every request instead of letting the
// browser assume a static asset is still fresh based on age heuristics.
func noCacheHeaders(c *gin.Context) {
	c.Header("Cache-Control", "no-cache")
	c.Next()
}

// maxRequestBodyBytes bounds any single request body — generous enough for
// the largest legitimate payloads (a base64 thumbnail upload, a full backup
// bundle) without leaving request bodies effectively unbounded.
const maxRequestBodyBytes = 50 << 20 // 50MB

func limitRequestBody(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxRequestBodyBytes)
	c.Next()
}

// setTrustedProxies tells Gin whose X-Forwarded-For to believe. Gin trusts every proxy unless told
// otherwise, which would let any client pick its own IP with a forged header and sidestep the
// login rate limits; a non-nil empty list means "trust none", so ClientIP is the connection address.
func setTrustedProxies(r *gin.Engine, proxies []string) error {
	if proxies == nil {
		proxies = []string{}
	}
	return r.SetTrustedProxies(proxies)
}

func SetupRouter(deps Deps) *gin.Engine {
	// gin.Default() with the access logger swapped for one that redacts ?token= (see logger.go).
	r := gin.New()
	if err := setTrustedProxies(r, deps.TrustedProxies); err != nil {
		log.Fatalf("invalid trusted proxies: %v", err)
	}
	r.Use(gin.LoggerWithConfig(gin.LoggerConfig{Formatter: redactingLogFormatter}), gin.Recovery())
	r.Use(CORS(deps.CORSAllowedOrigins))
	// Known Items entries whose source has no native video ID key by their
	// full URL instead (see subscriptions.sourceID) — that URL travels as
	// the :sourceId path param on routes like .../entries/:sourceId/add,
	// percent-encoded (e.g. "%2F" for its slashes) by the frontend. Gin's
	// default UseRawPath=false makes it match routes against the
	// already-decoded req.URL.Path, where those "%2F"s have become literal
	// "/"s — splitting one sourceId segment into several and 404ing the
	// route. UseRawPath=true matches against the still-encoded path instead
	// (c.Param still returns the decoded value, since UnescapePathValues
	// defaults to true).
	r.UseRawPath = true
	r.Use(limitRequestBody)
	r.Use(Compress())

	// All JSON API routes live under /api so they can never collide with a
	// frontend client-side route of the same name (e.g. both the SPA and the
	// API previously used "/downloads" — a hard refresh on the Downloads
	// page returned raw JSON instead of the app shell). /media-files and /ws
	// stay unprefixed since no SPA route shares those names.
	//
	// /health and /auth/* stay public (a login form can't call an
	// authenticated endpoint to find out it needs to show a login form);
	// everything else under /api requires a valid session.
	public := r.Group("/api")
	{
		public.GET("/health", Health(deps.DB))
		public.GET("/version", GetVersion())
		public.GET("/auth/status", AuthStatus(deps.UsersRepo))
		public.POST("/auth/setup", AuthSetup(deps.UsersRepo))
		public.POST("/auth/login", AuthLogin(deps.Auth))
		public.POST("/auth/login/2fa", AuthLogin2FA(deps.Auth))
		public.POST("/auth/logout", AuthLogout(deps.UsersRepo))
	}

	api := r.Group("/api")
	api.Use(RequireAuth(deps.UsersRepo), RequireCSRF())
	{
		// Optional features (Settings → Features), checked per request.
		subscriptionsOnly := RequireFeature(deps.SettingsRepo, models.SettingFeatureSubscriptionsEnabled, "Subscriptions")
		frameMatchingOnly := RequireFeature(deps.SettingsRepo, models.SettingFeatureFrameMatchingEnabled, "Frame Matching")
		compareListOnly := RequireFeature(deps.SettingsRepo, models.SettingFeatureCompareListEnabled, "Compare list")
		fileImportOnly := RequireFeature(deps.SettingsRepo, models.SettingFeatureFileImportEnabled, "File Import")

		subCheckDeps := subscriptions.CheckDeps{
			SubscriptionsRepo: deps.SubscriptionsRepo,
			LibraryRepo:       deps.LibraryRepo,
			TagsRepo:          deps.TagsRepo,
			CollectionsRepo:   deps.CollectionsRepo,
			Manager:           deps.Manager,
			YtDlp:             deps.YtDlp,
			ImagesRoot:        deps.ImagesRoot,
			SettingsRepo:      deps.SettingsRepo,
			Broadcaster:       deps.Broadcaster,
		}
		// Subscriptions that came due while the feature was off run as soon as it
		// is switched back on, rather than waiting for the next hourly sweep.
		onSubscriptionsEnabled := func() {
			go subscriptions.RunDueChecks(context.Background(), subCheckDeps)
		}

		api.PATCH("/auth/password", ChangePassword(deps.Auth))
		api.GET("/auth/sessions", ListSessions(deps.UsersRepo))
		api.POST("/auth/sessions/revoke-others", RevokeOtherSessions(deps.UsersRepo))
		api.DELETE("/auth/sessions/:id", RevokeSession(deps.UsersRepo))
		api.GET("/auth/2fa", TwoFactorStatus(deps.Auth))
		api.POST("/auth/2fa/setup", TwoFactorSetup(deps.Auth))
		api.POST("/auth/2fa/enable", TwoFactorEnable(deps.Auth))
		api.POST("/auth/2fa/disable", TwoFactorDisable(deps.Auth))
		api.POST("/auth/2fa/recovery-codes", TwoFactorRegenerateCodes(deps.Auth))
		api.GET("/auth/security-notice", SecurityNotice(deps.Auth))
		api.POST("/auth/security-notice/ack", SecurityNoticeAck(deps.Auth))

		api.GET("/actions", ListHostActions(deps.HostActions))
		api.POST("/actions/:id/run", RunHostAction(deps.HostActions))

		if deps.ImageResizer != nil {
			api.GET("/image", GetResizedImage(deps.MediaRoot, deps.ImagesRoot, deps.ImageResizer))
		}

		api.POST("/downloads", CreateDownload(deps.Manager, deps.CollectionsRepo, deps.SettingsRepo))
		api.GET("/downloads", ListDownloads(deps.Manager, deps.DownloadsRepo, deps.CollectionsRepo, deps.SettingsRepo))
		api.POST("/downloads/preview", PreviewDownloadMetadata(deps.YtDlp, deps.LibraryRepo))
		api.GET("/downloads/preview-image", PreviewImage(deps.SettingsRepo))
		api.POST("/downloads/playlist", CreatePlaylistDownload(deps.Manager, deps.CollectionsRepo, deps.SettingsRepo, deps.LibraryRepo, deps.HistoryRepo, deps.YtDlp))
		api.POST("/downloads/batch", CreateBatchDownload(deps.Manager, deps.CollectionsRepo, deps.SettingsRepo, deps.LibraryRepo, deps.HistoryRepo))
		api.POST("/downloads/:id/cancel", CancelDownload(deps.Manager))
		api.DELETE("/downloads/:id", DeleteDownload(deps.DownloadsRepo))
		api.POST("/downloads/clear-log", ClearDownloadLog(deps.DownloadsRepo))

		api.GET("/library", ListLibrary(deps.LibraryRepo, deps.CollectionsRepo, deps.TagsRepo, deps.ThumbnailGalleryRepo, deps.SettingsRepo, deps.MediaRoot))
		api.GET("/library/facets", GetLibraryFacets(deps.LibraryRepo))
		api.GET("/library/:id", GetLibraryItem(deps.LibraryRepo, deps.CollectionsRepo, deps.TagsRepo, deps.ThumbnailGalleryRepo, deps.SettingsRepo, deps.MediaRoot))
		api.POST("/library/ghost", CreateGhostLibraryItem(deps.LibraryRepo, deps.MediaRoot, deps.ImagesRoot, deps.YtDlp, deps.TagsRepo))
		api.DELETE("/library/:id/file", DeleteLibraryItemFile(deps.LibraryRepo, deps.ThumbnailEnhancementOriginalsRepo, deps.MediaRoot, deps.ImagesRoot))
		api.POST("/library/scan-missing", ScanMissingLibraryFiles(deps.MediaRoot, deps.LibraryRepo))
		api.GET("/maintenance/stray-files", ScanStrayFiles(deps.DB, deps.Manager, deps.MediaRoot, deps.ImagesRoot))
		api.POST("/maintenance/stray-files/delete", DeleteStrayFiles(deps.DB, deps.Manager, deps.MediaRoot, deps.ImagesRoot))
		api.DELETE("/library/:id", DeleteLibraryItem(deps.LibraryRepo, deps.MediaRoot, deps.ImagesRoot))
		api.PATCH("/library/:id", UpdateLibraryItem(deps.LibraryRepo, deps.MediaRoot, deps.YtDlp, deps.TagsRepo, deps.ArtistsRepo))
		api.POST("/library/:id/progress", UpdateLibraryItemProgress(deps.LibraryRepo))
		api.POST("/library/bulk-tags", BulkAssignTags(deps.LibraryRepo, deps.TagsRepo, deps.MediaRoot))
		api.POST("/library/bulk-delete", BulkDeleteLibraryItems(deps.DB, deps.LibraryRepo, deps.MediaRoot, deps.ImagesRoot))
		api.POST("/library/bulk-delete-file", BulkDeleteLibraryItemFiles(deps.DB, deps.LibraryRepo, deps.ThumbnailEnhancementOriginalsRepo, deps.MediaRoot, deps.ImagesRoot))
		api.POST("/library/bulk-redownload", BulkRedownloadLibraryItems(deps.LibraryRepo, deps.DownloadsRepo, deps.Manager, deps.CollectionsRepo, deps.SettingsRepo))
		api.POST("/library/bulk-fetch-thumbnails", BulkFetchLibraryThumbnails(deps.LibraryRepo, deps.ImagesRoot, deps.YtDlp))
		api.POST("/library/:id/move", MoveLibraryItem(deps.LibraryRepo, deps.Manager, deps.MediaRoot))
		api.POST("/library/:id/refresh-metadata", RefreshLibraryItemMetadata(deps.LibraryRepo, deps.YtDlp, deps.CollectionsRepo, deps.TagsRepo, deps.ThumbnailGalleryRepo, deps.SettingsRepo, deps.MediaRoot))
		api.GET("/library/:id/metadata-preview", CompareLibraryItemMetadata(deps.LibraryRepo, deps.YtDlp))
		api.GET("/library/:id/probe-metadata", ProbeLibraryItemMetadata(deps.LibraryRepo, deps.MediaRoot, deps.FFProbePath, deps.YtDlp))
		api.POST("/library/:id/trim/preview", PreviewLibraryItemTrim(deps.LibraryRepo, deps.MediaRoot, deps.YtDlp, deps.FFProbePath))
		api.POST("/library/:id/trim/accept", AcceptLibraryItemTrim(deps.LibraryRepo, deps.MediaRoot, deps.FFProbePath, deps.YtDlp, deps.CollectionsRepo, deps.TagsRepo, deps.ThumbnailGalleryRepo, deps.SettingsRepo))
		api.POST("/library/:id/trim/discard", DiscardLibraryItemTrim(deps.MediaRoot, deps.YtDlp))
		api.GET("/library/:id/trim/frames", GetLibraryItemTrimFrames(deps.LibraryRepo, deps.MediaRoot, deps.YtDlp, deps.FFProbePath))
		api.POST("/library/:id/redownload", RedownloadLibraryItem(deps.LibraryRepo, deps.DownloadsRepo, deps.Manager, deps.CollectionsRepo, deps.SettingsRepo))
		api.GET("/library/:id/redownload/preview-url", PreviewRedownloadURL(deps.LibraryRepo, deps.YtDlp))
		api.POST("/library/:id/redownload/from-url", RedownloadLibraryItemFromURL(deps.LibraryRepo, deps.DownloadsRepo, deps.Manager, deps.CollectionsRepo, deps.SettingsRepo))
		api.POST("/library/:id/thumbnail/redownload", RedownloadLibraryThumbnail(deps.MediaRoot, deps.ImagesRoot, deps.LibraryRepo, deps.YtDlp, deps.CollectionsRepo, deps.TagsRepo, deps.ThumbnailEnhancementOriginalsRepo, deps.ThumbnailGalleryRepo))
		api.POST("/library/:id/thumbnail/quick-grab", QuickGrabLibraryThumbnail(deps.MediaRoot, deps.ImagesRoot, deps.LibraryRepo, deps.YtDlp, deps.FFProbePath, deps.SettingsRepo, deps.CollectionsRepo, deps.TagsRepo, deps.ThumbnailEnhancementOriginalsRepo, deps.ThumbnailGalleryRepo))
		api.GET("/library/:id/thumbnail/timestamps", GetLibraryThumbnailTimestamps(deps.MediaRoot, deps.LibraryRepo, deps.FFProbePath, deps.SettingsRepo))
		api.GET("/library/:id/thumbnail/candidates", GetLibraryThumbnailCandidates(deps.MediaRoot, deps.LibraryRepo, deps.YtDlp, deps.FFProbePath, deps.SettingsRepo))
		api.POST("/library/:id/thumbnail", SetLibraryThumbnail(deps.MediaRoot, deps.ImagesRoot, deps.YtDlp.FFmpegPath, deps.LibraryRepo, deps.CollectionsRepo, deps.TagsRepo, deps.ThumbnailEnhancementOriginalsRepo, deps.ThumbnailGalleryRepo))
		api.DELETE("/library/:id/thumbnail", DeleteLibraryItemThumbnail(deps.MediaRoot, deps.ImagesRoot, deps.LibraryRepo, deps.ThumbnailEnhancementOriginalsRepo))
		api.POST("/library/:id/thumbnail/gallery", SaveLibraryThumbnailToGallery(deps.MediaRoot, deps.ImagesRoot, deps.LibraryRepo, deps.ThumbnailGalleryRepo))
		api.GET("/library/:id/thumbnail/gallery", ListLibraryThumbnailGallery(deps.LibraryRepo, deps.ThumbnailGalleryRepo))
		api.POST("/library/:id/thumbnail/gallery/:galleryId/apply", ApplyLibraryThumbnailFromGallery(deps.MediaRoot, deps.ImagesRoot, deps.YtDlp.FFmpegPath, deps.LibraryRepo, deps.ThumbnailGalleryRepo, deps.CollectionsRepo, deps.TagsRepo, deps.ThumbnailEnhancementOriginalsRepo))
		api.PATCH("/library/:id/thumbnail/gallery/:galleryId", SetLibraryThumbnailGalleryFavorite(deps.ThumbnailGalleryRepo))
		api.DELETE("/library/:id/thumbnail/gallery/:galleryId", DeleteLibraryThumbnailGalleryImage(deps.ImagesRoot, deps.ThumbnailGalleryRepo))
		api.POST("/library/:id/thumbnail/match", frameMatchingOnly, StartFrameMatch(deps.MediaRoot, deps.LibraryRepo, deps.YtDlp, deps.FFProbePath, deps.FrameMatchJobs, deps.FrameMatchQueueRepo))
		api.GET("/thumbnail-match/:jobId", frameMatchingOnly, GetFrameMatchStatus(deps.FrameMatchJobs))
		api.POST("/library/thumbnail/match/bulk", frameMatchingOnly, BulkStartFrameMatch(deps.LibraryRepo, deps.FrameMatchQueueRepo))
		api.GET("/frame-match/queue", frameMatchingOnly, ListFrameMatchQueue(deps.FrameMatchQueueRepo))
		api.POST("/frame-match/queue/:id/accept", frameMatchingOnly, AcceptFrameMatchQueueItem(deps.MediaRoot, deps.ImagesRoot, deps.YtDlp.FFmpegPath, deps.FrameMatchQueueRepo, deps.LibraryRepo, deps.CollectionsRepo, deps.TagsRepo, deps.ThumbnailEnhancementOriginalsRepo, deps.ThumbnailGalleryRepo))
		api.DELETE("/frame-match/queue/:id", frameMatchingOnly, DiscardFrameMatchQueueItem(deps.ImagesRoot, deps.FrameMatchQueueRepo))
		api.POST("/library/:id/nfo", GenerateLibraryItemNFO(deps.MediaRoot, deps.LibraryRepo, deps.TagsRepo))
		api.GET("/library/:id/nfo", GetLibraryItemNFO(deps.MediaRoot, deps.LibraryRepo))
		api.DELETE("/library/:id/nfo", DeleteLibraryItemNFO(deps.MediaRoot, deps.LibraryRepo))

		api.GET("/collections", ListCollections(deps.CollectionsRepo, deps.LibraryRepo))
		api.POST("/collections", CreateCollection(deps.CollectionsRepo, deps.Manager))
		api.PATCH("/collections/:id", UpdateCollection(deps.CollectionsRepo, deps.Manager))
		api.DELETE("/collections/:id", DeleteCollection(deps.CollectionsRepo, deps.ImagesRoot))
		api.POST("/collections/bulk-delete", BulkDeleteCollections(deps.DB, deps.CollectionsRepo, deps.ImagesRoot))
		api.GET("/collections/:id/cover-candidates", CollectionCoverCandidates(deps.MediaRoot, deps.CollectionsRepo))
		api.POST("/collections/:id/cover", SetCollectionCover(deps.MediaRoot, deps.ImagesRoot, deps.YtDlp.FFmpegPath, deps.CollectionsRepo))
		api.DELETE("/collections/:id/cover", DeleteCollectionCover(deps.ImagesRoot, deps.CollectionsRepo))

		api.GET("/tags", ListTags(deps.TagsRepo))
		api.POST("/tags", CreateTag(deps.TagsRepo))
		api.PATCH("/tags/:id", UpdateTag(deps.TagsRepo))
		api.DELETE("/tags/:id", DeleteTag(deps.TagsRepo))
		api.POST("/tags/bulk-delete", BulkDeleteTags(deps.DB, deps.TagsRepo))

		api.GET("/compare-list", compareListOnly, ListCompareList(deps.CompareListRepo, deps.TagsRepo, deps.CollectionsRepo, deps.ThumbnailGalleryRepo, deps.SettingsRepo, deps.MediaRoot))
		api.POST("/compare-list", compareListOnly, AddToCompareList(deps.CompareListRepo))
		api.DELETE("/compare-list/:id", compareListOnly, RemoveFromCompareList(deps.CompareListRepo))
		api.DELETE("/compare-list", compareListOnly, ClearCompareList(deps.CompareListRepo))

		api.GET("/artists", ListArtists(deps.ArtistsRepo))
		api.POST("/artists", CreateArtist(deps.ArtistsRepo))
		api.PATCH("/artists/:id", UpdateArtist(deps.ArtistsRepo))
		api.DELETE("/artists/:id", DeleteArtist(deps.ArtistsRepo, deps.ImagesRoot))
		api.POST("/artists/bulk-delete", BulkDeleteArtists(deps.DB, deps.ArtistsRepo, deps.ImagesRoot))
		api.GET("/artists/:id/image-candidates", ArtistImageCandidates(deps.LibraryRepo))
		api.GET("/artists/:id/images", ListArtistImages(deps.ArtistsRepo))
		api.POST("/artists/:id/images", AddArtistImage(deps.MediaRoot, deps.ImagesRoot, deps.YtDlp.FFmpegPath, deps.ArtistsRepo))
		api.DELETE("/artists/:id/images/:imageId", DeleteArtistImage(deps.ImagesRoot, deps.ArtistsRepo))
		api.POST("/artists/:id/images/:imageId/select", SelectArtistImage(deps.ArtistsRepo))
		api.DELETE("/artists/:id/selected-image", ClearArtistSelectedImage(deps.ArtistsRepo))

		api.GET("/settings", GetSettings(deps.SettingsRepo, deps.Manager, deps.YtDlp, deps.MediaRoot))
		api.PATCH("/settings", UpdateSettings(deps.SettingsRepo, deps.Manager, deps.YtDlp, onSubscriptionsEnabled))
		api.POST("/settings/backfill-images", StartImageBackfill(deps.ImageBackfillManager))
		api.GET("/settings/backfill-images", GetImageBackfillStatus(deps.ImageBackfillManager))
		api.GET("/proxy/status", GetProxyStatus(deps.SettingsRepo))

		api.POST("/backup/export/settings", ExportSettings(deps.SettingsRepo))
		api.POST("/backup/export/library", ExportLibrary(deps.CollectionsRepo, deps.TagsRepo, deps.ArtistsRepo, deps.LibraryRepo, deps.DownloadsRepo))
		api.POST("/backup/import/settings", ImportSettings(deps.SettingsRepo, deps.Manager, deps.YtDlp))
		api.POST("/backup/preview/library", PreviewLibraryImport(deps.CollectionsRepo, deps.TagsRepo, deps.ArtistsRepo, deps.LibraryRepo))
		api.POST("/backup/import/library", ImportLibrary(deps.DB, deps.CollectionsRepo, deps.TagsRepo, deps.ArtistsRepo, deps.LibraryRepo, deps.Manager, deps.SettingsRepo))
		api.POST("/backup/preview/full", PreviewFullImport(deps.CollectionsRepo, deps.TagsRepo, deps.ArtistsRepo, deps.LibraryRepo))
		api.POST("/backup/import/full", ImportFullBackup(deps.DB, deps.SettingsRepo, deps.CollectionsRepo, deps.TagsRepo, deps.ArtistsRepo, deps.LibraryRepo, deps.Manager))
		api.GET("/backup/history", ListBackupHistory(deps.BackupHistoryRepo))
		api.POST("/backup/run", RunManualBackup(backup.RunDeps{
			BackupsRoot:       deps.BackupsRoot,
			SettingsRepo:      deps.SettingsRepo,
			CollectionsRepo:   deps.CollectionsRepo,
			TagsRepo:          deps.TagsRepo,
			ArtistsRepo:       deps.ArtistsRepo,
			LibraryRepo:       deps.LibraryRepo,
			DownloadsRepo:     deps.DownloadsRepo,
			BackupHistoryRepo: deps.BackupHistoryRepo,
		}))
		api.GET("/backup/history/:id/download", DownloadBackupFile(deps.BackupsRoot, deps.BackupHistoryRepo))
		api.DELETE("/backup/history/:id", DeleteBackupHistoryEntry(deps.BackupsRoot, deps.BackupHistoryRepo))
		api.GET("/backup/history/:id/preview", PreviewBackupFile(deps.BackupsRoot, deps.BackupHistoryRepo))
		api.POST("/backup/history/:id/restore", RestoreFullBackup(deps.BackupsRoot, deps.BackupHistoryRepo, deps.DB, deps.SettingsRepo, deps.CollectionsRepo, deps.TagsRepo, deps.ArtistsRepo, deps.LibraryRepo, deps.Manager))

		api.POST("/subscriptions", subscriptionsOnly, CreateSubscription(subCheckDeps))
		api.GET("/subscriptions", subscriptionsOnly, ListSubscriptions(subCheckDeps))
		api.PATCH("/subscriptions/:id", subscriptionsOnly, UpdateSubscription(subCheckDeps))
		api.DELETE("/subscriptions/:id", subscriptionsOnly, DeleteSubscription(subCheckDeps))
		api.POST("/subscriptions/:id/check", subscriptionsOnly, CheckSubscriptionNow(subCheckDeps))
		api.GET("/subscriptions/:id/entries", subscriptionsOnly, ListSubscriptionEntries(subCheckDeps))
		api.POST("/subscriptions/:id/entries/:sourceId/add", subscriptionsOnly, AddSubscriptionEntry(subCheckDeps))
		api.POST("/subscriptions/:id/entries/:sourceId/seen", subscriptionsOnly, MarkSubscriptionEntrySeen(subCheckDeps))
		api.POST("/subscriptions/:id/entries/:sourceId/link", subscriptionsOnly, LinkSubscriptionEntry(subCheckDeps))
		api.POST("/subscriptions/:id/entries/:sourceId/unlink", subscriptionsOnly, UnlinkSubscriptionEntry(subCheckDeps))

		enhanceDeps := thumbnailenhance.Deps{
			SettingsRepo:  deps.SettingsRepo,
			LibraryRepo:   deps.LibraryRepo,
			HistoryRepo:   deps.ThumbnailEnhancementHistoryRepo,
			OriginalsRepo: deps.ThumbnailEnhancementOriginalsRepo,
			MediaRoot:     deps.MediaRoot,
			ImagesRoot:    deps.ImagesRoot,
			FFmpegPath:    deps.YtDlp.FFmpegPath,
			Broadcaster:   deps.Broadcaster,
		}
		api.GET("/thumbnail-enhancement/history", ListThumbnailEnhancementHistory(enhanceDeps))
		api.DELETE("/thumbnail-enhancement/history/:id", DeleteThumbnailEnhancementHistoryEntry(enhanceDeps))
		api.POST("/thumbnail-enhancement/history/bulk-delete", BulkDeleteThumbnailEnhancementHistoryEntries(enhanceDeps))
		api.POST("/thumbnail-enhancement/history/clear", ClearThumbnailEnhancementHistory(enhanceDeps))
		api.POST("/thumbnail-enhancement/run", RunThumbnailEnhancementNow(enhanceDeps))
		api.GET("/thumbnail-enhancement/upscalers", ListThumbnailUpscalers())
		api.GET("/thumbnail-enhancement/status", GetThumbnailEnhancementStatus(enhanceDeps))
		api.GET("/thumbnail-enhancement/eligible", ListThumbnailEnhancementEligible(enhanceDeps))
		api.POST("/thumbnail-enhancement/items/bulk-run", EnhanceThumbnailItemsNow(enhanceDeps))
		api.POST("/thumbnail-enhancement/items/bulk-sharpen", SharpenThumbnailItemsNow(enhanceDeps))
		api.POST("/thumbnail-enhancement/items/:id/revert", RevertThumbnailOriginal(enhanceDeps))
		api.DELETE("/thumbnail-enhancement/items/:id/original", DeleteThumbnailOriginal(enhanceDeps))
		api.POST("/thumbnail-enhancement/items/bulk-keep-enhanced", BulkDeleteThumbnailOriginals(enhanceDeps))
		api.POST("/thumbnail-enhancement/items/bulk-keep-original", BulkRevertThumbnailOriginals(enhanceDeps))

		api.GET("/import/scan", fileImportOnly, ScanImport(deps.MediaRoot, deps.LibraryRepo, deps.CollectionsRepo, deps.SettingsRepo, deps.FFProbePath))
		api.POST("/import", fileImportOnly, CreateImport(deps.MediaRoot, deps.ImagesRoot, deps.LibraryRepo, deps.CollectionsRepo, deps.YtDlp, deps.FFProbePath))

		api.GET("/history", ListHistory(deps.HistoryRepo, deps.SettingsRepo))
		api.POST("/history/:id/retry", RetryHistoryItem(deps.HistoryRepo, deps.DownloadsRepo, deps.Manager, deps.CollectionsRepo, deps.SettingsRepo))
		api.DELETE("/history/:id", DeleteHistoryItem(deps.HistoryRepo))
		api.POST("/history/clear", ClearHistory(deps.HistoryRepo))

		api.GET("/logs", GetLogs(deps.DownloadsRepo, deps.SettingsRepo))

		api.GET("/stats", GetStats(deps.DownloadsRepo, deps.LibraryRepo, deps.MediaRoot))
		api.GET("/stats/library-growth", GetLibraryGrowth(deps.LibraryRepo))
		api.GET("/stats/resolution-breakdown", GetResolutionBreakdown(deps.LibraryRepo))

		api.POST("/jellyfin/rescan", RescanJellyfinLibrary(deps.SettingsRepo, deps.JellyfinClient))

		api.GET("/ytdlp/version", GetYtDlpVersion(deps.YtDlp))
		api.POST("/ytdlp/update", UpdateYtDlp(deps.YtDlp))
	}

	if deps.MediaRoot != "" {
		// no-cache (not no-store): still revalidates cheaply via
		// If-Modified-Since against the file's mtime, but never serves stale
		// bytes straight from disk cache — sidecar thumbnails get
		// overwritten in place at the same path (choose-from-video,
		// redownload, quick-grab), so a browser that trusted the response
		// heuristically fresh would keep showing the old image after reload.
		r.Group("/media-files", RequireAuth(deps.UsersRepo), noCacheHeaders).StaticFS("/", http.Dir(deps.MediaRoot))
	}

	if deps.ImagesRoot != "" {
		// Artist/collection images Packrat itself copied in — same no-cache
		// rationale as /media-files: a replaced cover/selected-image can
		// land at a reused filename (e.g. collections/<id>/cover.jpg is
		// always overwritten in place), so a browser that cached the old
		// bytes as heuristically fresh would keep showing them after reload.
		r.Group("/local-images", RequireAuth(deps.UsersRepo), noCacheHeaders).StaticFS("/", http.Dir(deps.ImagesRoot))
	}

	if deps.WSHandler != nil {
		r.GET("/ws", RequireAuth(deps.UsersRepo), deps.WSHandler)
	}

	if deps.StaticDir != "" {
		r.NoRoute(serveSPA(deps.StaticDir))
	}

	return r
}

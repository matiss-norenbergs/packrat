package api

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/jellyfin"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
)

// Deps holds everything the router needs to wire up routes. Fields are added
// incrementally as the corresponding subsystems (queue, library, ws) land.
type Deps struct {
	DB              *sql.DB
	Manager         *queue.DownloadManager
	DownloadsRepo   *repository.DownloadsRepo
	LibraryRepo     *repository.LibraryRepo
	CollectionsRepo *repository.CollectionsRepo
	SettingsRepo    *repository.SettingsRepo
	HistoryRepo     *repository.HistoryRepo
	TagsRepo        *repository.TagsRepo
	ArtistsRepo     *repository.ArtistsRepo
	UsersRepo       *repository.UsersRepo
	YtDlp           *downloader.YtDlpService
	JellyfinClient  *jellyfin.Client
	MediaRoot       string
	FFProbePath     string
	WSHandler       gin.HandlerFunc // set once the WS hub exists; nil is fine (no /ws route)
	StaticDir       string          // built frontend assets; empty in dev (Vite serves it)
}

// noCacheHeaders forces revalidation on every request instead of letting the
// browser assume a static asset is still fresh based on age heuristics.
func noCacheHeaders(c *gin.Context) {
	c.Header("Cache-Control", "no-cache")
	c.Next()
}

func SetupRouter(deps Deps) *gin.Engine {
	r := gin.Default()

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
		public.GET("/auth/status", AuthStatus(deps.UsersRepo))
		public.POST("/auth/setup", AuthSetup(deps.UsersRepo))
		public.POST("/auth/login", AuthLogin(deps.UsersRepo))
		public.POST("/auth/logout", AuthLogout(deps.UsersRepo))
	}

	api := r.Group("/api")
	api.Use(RequireAuth(deps.UsersRepo), RequireCSRF())
	{
		api.PATCH("/auth/password", ChangePassword(deps.UsersRepo))

		api.POST("/downloads", CreateDownload(deps.Manager, deps.CollectionsRepo, deps.SettingsRepo))
		api.GET("/downloads", ListDownloads(deps.Manager, deps.DownloadsRepo, deps.CollectionsRepo))
		api.POST("/downloads/preview", PreviewDownloadMetadata(deps.YtDlp, deps.LibraryRepo))
		api.POST("/downloads/playlist", CreatePlaylistDownload(deps.Manager, deps.CollectionsRepo, deps.SettingsRepo, deps.LibraryRepo, deps.HistoryRepo, deps.YtDlp))
		api.POST("/downloads/batch", CreateBatchDownload(deps.Manager, deps.CollectionsRepo, deps.SettingsRepo, deps.LibraryRepo, deps.HistoryRepo))
		api.POST("/downloads/:id/cancel", CancelDownload(deps.Manager))
		api.DELETE("/downloads/:id", DeleteDownload(deps.DownloadsRepo))
		api.POST("/downloads/clear-log", ClearDownloadLog(deps.DownloadsRepo))

		api.GET("/library", ListLibrary(deps.LibraryRepo, deps.CollectionsRepo, deps.TagsRepo, deps.MediaRoot))
		api.GET("/library/facets", GetLibraryFacets(deps.LibraryRepo))
		api.DELETE("/library/:id", DeleteLibraryItem(deps.LibraryRepo, deps.MediaRoot))
		api.PATCH("/library/:id", UpdateLibraryItem(deps.LibraryRepo, deps.MediaRoot, deps.YtDlp, deps.TagsRepo, deps.ArtistsRepo))
		api.POST("/library/bulk-tags", BulkAssignTags(deps.LibraryRepo, deps.TagsRepo, deps.MediaRoot))
		api.POST("/library/bulk-delete", BulkDeleteLibraryItems(deps.LibraryRepo, deps.MediaRoot))
		api.POST("/library/:id/move", MoveLibraryItem(deps.LibraryRepo, deps.Manager, deps.MediaRoot))
		api.POST("/library/:id/refresh-metadata", RefreshLibraryItemMetadata(deps.LibraryRepo, deps.YtDlp, deps.CollectionsRepo, deps.TagsRepo, deps.MediaRoot))
		api.GET("/library/:id/metadata-preview", CompareLibraryItemMetadata(deps.LibraryRepo, deps.YtDlp))
		api.POST("/library/:id/redownload", RedownloadLibraryItem(deps.LibraryRepo, deps.DownloadsRepo, deps.Manager, deps.CollectionsRepo, deps.SettingsRepo))
		api.POST("/library/:id/thumbnail/redownload", RedownloadLibraryThumbnail(deps.MediaRoot, deps.LibraryRepo, deps.YtDlp, deps.CollectionsRepo, deps.TagsRepo))
		api.POST("/library/:id/thumbnail/quick-grab", QuickGrabLibraryThumbnail(deps.MediaRoot, deps.LibraryRepo, deps.YtDlp, deps.FFProbePath, deps.CollectionsRepo, deps.TagsRepo))
		api.GET("/library/:id/thumbnail/candidates", GetLibraryThumbnailCandidates(deps.MediaRoot, deps.LibraryRepo, deps.YtDlp, deps.FFProbePath, deps.SettingsRepo))
		api.POST("/library/:id/thumbnail", SetLibraryThumbnail(deps.MediaRoot, deps.LibraryRepo, deps.CollectionsRepo, deps.TagsRepo))
		api.POST("/library/:id/nfo", GenerateLibraryItemNFO(deps.MediaRoot, deps.LibraryRepo, deps.TagsRepo))
		api.GET("/library/:id/nfo", GetLibraryItemNFO(deps.MediaRoot, deps.LibraryRepo))
		api.DELETE("/library/:id/nfo", DeleteLibraryItemNFO(deps.MediaRoot, deps.LibraryRepo))

		api.GET("/collections", ListCollections(deps.CollectionsRepo))
		api.POST("/collections", CreateCollection(deps.CollectionsRepo, deps.Manager))
		api.PATCH("/collections/:id", UpdateCollection(deps.CollectionsRepo, deps.Manager))
		api.DELETE("/collections/:id", DeleteCollection(deps.CollectionsRepo))
		api.POST("/collections/bulk-delete", BulkDeleteCollections(deps.CollectionsRepo))

		api.GET("/tags", ListTags(deps.TagsRepo))
		api.POST("/tags", CreateTag(deps.TagsRepo))
		api.PATCH("/tags/:id", UpdateTag(deps.TagsRepo))
		api.DELETE("/tags/:id", DeleteTag(deps.TagsRepo))
		api.POST("/tags/bulk-delete", BulkDeleteTags(deps.TagsRepo))

		api.GET("/artists", ListArtists(deps.ArtistsRepo))
		api.POST("/artists", CreateArtist(deps.ArtistsRepo))
		api.PATCH("/artists/:id", UpdateArtist(deps.ArtistsRepo))
		api.DELETE("/artists/:id", DeleteArtist(deps.ArtistsRepo))
		api.POST("/artists/bulk-delete", BulkDeleteArtists(deps.ArtistsRepo))

		api.GET("/settings", GetSettings(deps.SettingsRepo, deps.Manager, deps.MediaRoot))
		api.PATCH("/settings", UpdateSettings(deps.SettingsRepo, deps.Manager))

		api.POST("/backup/export/settings", ExportSettings(deps.SettingsRepo))
		api.POST("/backup/export/library", ExportLibrary(deps.CollectionsRepo, deps.TagsRepo, deps.ArtistsRepo, deps.LibraryRepo, deps.DownloadsRepo))
		api.POST("/backup/import/settings", ImportSettings(deps.SettingsRepo, deps.Manager))
		api.POST("/backup/import/library", ImportLibrary(deps.CollectionsRepo, deps.TagsRepo, deps.ArtistsRepo, deps.Manager, deps.SettingsRepo))

		api.GET("/import/scan", ScanImport(deps.MediaRoot, deps.LibraryRepo, deps.CollectionsRepo, deps.SettingsRepo, deps.FFProbePath))
		api.POST("/import", CreateImport(deps.MediaRoot, deps.LibraryRepo, deps.CollectionsRepo, deps.YtDlp, deps.FFProbePath))

		api.GET("/history", ListHistory(deps.HistoryRepo, deps.SettingsRepo))
		api.POST("/history/:id/retry", RetryHistoryItem(deps.HistoryRepo, deps.DownloadsRepo, deps.Manager, deps.CollectionsRepo, deps.SettingsRepo))
		api.DELETE("/history/:id", DeleteHistoryItem(deps.HistoryRepo))
		api.POST("/history/clear", ClearHistory(deps.HistoryRepo))

		api.GET("/logs", GetLogs(deps.DownloadsRepo, deps.SettingsRepo))

		api.GET("/stats", GetStats(deps.DownloadsRepo, deps.LibraryRepo))

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

	if deps.WSHandler != nil {
		r.GET("/ws", RequireAuth(deps.UsersRepo), deps.WSHandler)
	}

	if deps.StaticDir != "" {
		r.NoRoute(serveSPA(deps.StaticDir))
	}

	return r
}

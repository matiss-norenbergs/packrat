package api

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/downloader"
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
	YtDlp           *downloader.YtDlpService
	MediaRoot       string
	FFProbePath     string
	WSHandler       gin.HandlerFunc // set once the WS hub exists; nil is fine (no /ws route)
	StaticDir       string          // built frontend assets; empty in dev (Vite serves it)
}

func SetupRouter(deps Deps) *gin.Engine {
	r := gin.Default()

	// All JSON API routes live under /api so they can never collide with a
	// frontend client-side route of the same name (e.g. both the SPA and the
	// API previously used "/downloads" — a hard refresh on the Downloads
	// page returned raw JSON instead of the app shell). /media-files and /ws
	// stay unprefixed since no SPA route shares those names.
	api := r.Group("/api")
	{
		api.GET("/health", Health(deps.DB))

		api.POST("/downloads", CreateDownload(deps.Manager, deps.CollectionsRepo, deps.SettingsRepo))
		api.GET("/downloads", ListDownloads(deps.Manager, deps.DownloadsRepo, deps.CollectionsRepo))
		api.POST("/downloads/:id/cancel", CancelDownload(deps.Manager))
		api.DELETE("/downloads/:id", DeleteDownload(deps.DownloadsRepo))

		api.GET("/library", ListLibrary(deps.LibraryRepo, deps.CollectionsRepo))
		api.DELETE("/library/:id", DeleteLibraryItem(deps.LibraryRepo, deps.MediaRoot))
		api.PATCH("/library/:id", UpdateLibraryItem(deps.LibraryRepo, deps.MediaRoot, deps.YtDlp))
		api.POST("/library/:id/move", MoveLibraryItem(deps.LibraryRepo, deps.Manager, deps.MediaRoot))
		api.POST("/library/:id/refresh-metadata", RefreshLibraryItemMetadata(deps.LibraryRepo, deps.YtDlp, deps.CollectionsRepo))
		api.POST("/library/:id/redownload", RedownloadLibraryItem(deps.LibraryRepo, deps.DownloadsRepo, deps.Manager, deps.CollectionsRepo, deps.SettingsRepo))
		api.POST("/library/:id/thumbnail/redownload", RedownloadLibraryThumbnail(deps.MediaRoot, deps.LibraryRepo, deps.YtDlp, deps.CollectionsRepo))
		api.POST("/library/:id/thumbnail/quick-grab", QuickGrabLibraryThumbnail(deps.MediaRoot, deps.LibraryRepo, deps.YtDlp, deps.FFProbePath, deps.CollectionsRepo))
		api.GET("/library/:id/thumbnail/candidates", GetLibraryThumbnailCandidates(deps.MediaRoot, deps.LibraryRepo, deps.YtDlp, deps.FFProbePath))
		api.POST("/library/:id/thumbnail", SetLibraryThumbnail(deps.MediaRoot, deps.LibraryRepo, deps.CollectionsRepo))

		api.GET("/collections", ListCollections(deps.CollectionsRepo))
		api.POST("/collections", CreateCollection(deps.CollectionsRepo, deps.Manager))
		api.PATCH("/collections/:id", UpdateCollection(deps.CollectionsRepo, deps.Manager))
		api.DELETE("/collections/:id", DeleteCollection(deps.CollectionsRepo))

		api.GET("/settings", GetSettings(deps.SettingsRepo, deps.Manager, deps.MediaRoot))
		api.PATCH("/settings", UpdateSettings(deps.SettingsRepo, deps.Manager))

		api.GET("/import/scan", ScanImport(deps.MediaRoot, deps.LibraryRepo, deps.CollectionsRepo, deps.SettingsRepo, deps.FFProbePath))
		api.POST("/import", CreateImport(deps.MediaRoot, deps.LibraryRepo, deps.CollectionsRepo, deps.YtDlp, deps.FFProbePath))
	}

	if deps.MediaRoot != "" {
		r.StaticFS("/media-files", http.Dir(deps.MediaRoot))
	}

	if deps.WSHandler != nil {
		r.GET("/ws", deps.WSHandler)
	}

	if deps.StaticDir != "" {
		r.NoRoute(serveSPA(deps.StaticDir))
	}

	return r
}

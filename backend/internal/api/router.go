package api

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
)

// Deps holds everything the router needs to wire up routes. Fields are added
// incrementally as the corresponding subsystems (queue, library, ws) land.
type Deps struct {
	DB            *sql.DB
	Manager       *queue.DownloadManager
	DownloadsRepo *repository.DownloadsRepo
	LibraryRepo   *repository.LibraryRepo
	MediaRoot     string
	WSHandler     gin.HandlerFunc // set once the WS hub exists; nil is fine (no /ws route)
	StaticDir     string          // built frontend assets; empty in dev (Vite serves it)
}

func SetupRouter(deps Deps) *gin.Engine {
	r := gin.Default()

	r.GET("/health", Health(deps.DB))

	r.POST("/downloads", CreateDownload(deps.Manager))
	r.GET("/downloads", ListDownloads(deps.Manager, deps.DownloadsRepo))
	r.DELETE("/downloads/:id", CancelDownload(deps.Manager))

	r.GET("/library", ListLibrary(deps.LibraryRepo))

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

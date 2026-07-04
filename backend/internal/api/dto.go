package api

import (
	"path"

	"packrat/backend/internal/models"
	"packrat/backend/internal/queue"
)

type CreateDownloadRequest struct {
	URL          string `json:"url" binding:"required,url"`
	CollectionID *int64 `json:"collectionId"`
	Folder       string `json:"folder"`
	Filename     string `json:"filename"`
	DownloadType string `json:"downloadType" binding:"required,oneof=video audio"`
	Quality      string `json:"quality"`
	AudioFormat  string `json:"audioFormat"`
}

type DownloadResponse struct {
	ID               int64   `json:"id"`
	URL              string  `json:"url"`
	CollectionID     *int64  `json:"collectionId"`
	CollectionName   *string `json:"collectionName"`
	Folder           string  `json:"folder"`
	Filename         string  `json:"filename"`
	DownloadType     string  `json:"downloadType"`
	Quality          string  `json:"quality"`
	AudioFormat      *string `json:"audioFormat"`
	Status           string  `json:"status"`
	Title            *string `json:"title"`
	Uploader         *string `json:"uploader"`
	Duration         *int    `json:"duration"`
	Thumbnail        *string `json:"thumbnail"`
	ErrorMessage     *string `json:"errorMessage"`
	CreatedAt        string  `json:"createdAt"`
	UpdatedAt        string  `json:"updatedAt"`
	CompletedAt      *string `json:"completedAt"`
	Percent          float64 `json:"percent"`
	SpeedBytesPerSec float64 `json:"speedBytesPerSec"`
	ETASeconds       int     `json:"etaSeconds"`
	DownloadedBytes  int64   `json:"downloadedBytes"`
	TotalBytes       int64   `json:"totalBytes"`
	Blurred          bool    `json:"blurred"`
}

func toDownloadResponse(d models.Download, live *queue.LiveProgress, blurred bool) DownloadResponse {
	resp := DownloadResponse{
		ID:             d.ID,
		URL:            d.URL,
		CollectionID:   d.CollectionID,
		CollectionName: d.CollectionName,
		Folder:         d.Folder,
		Filename:       d.Filename,
		DownloadType:   d.DownloadType,
		Quality:        d.Quality,
		AudioFormat:    d.AudioFormat,
		Status:         string(d.Status),
		Title:          d.Title,
		Uploader:       d.Uploader,
		Duration:       d.Duration,
		Thumbnail:      d.Thumbnail,
		ErrorMessage:   d.ErrorMessage,
		CreatedAt:      d.CreatedAt.Format(timeFormat),
		UpdatedAt:      d.UpdatedAt.Format(timeFormat),
		Blurred:        blurred,
	}
	if d.CompletedAt != nil {
		s := d.CompletedAt.Format(timeFormat)
		resp.CompletedAt = &s
	}
	if live != nil {
		resp.Percent = live.Percent
		resp.SpeedBytesPerSec = live.SpeedBytesPerSec
		resp.ETASeconds = live.ETASeconds
		resp.DownloadedBytes = live.DownloadedBytes
		resp.TotalBytes = live.TotalBytes
	} else if d.Status == models.StatusCompleted {
		resp.Percent = 100
	}
	return resp
}

const timeFormat = "2006-01-02T15:04:05Z07:00"

type LibraryItemResponse struct {
	ID             int64   `json:"id"`
	DownloadID     *int64  `json:"downloadId"`
	Title          string  `json:"title"`
	Filename       string  `json:"filename"`
	Path           string  `json:"path"`
	CollectionID   *int64  `json:"collectionId"`
	CollectionName *string `json:"collectionName"`
	Folder         string  `json:"folder"`
	OriginalURL    *string `json:"originalUrl"`
	Uploader       *string `json:"uploader"`
	Duration       *int    `json:"duration"`
	Resolution     *string `json:"resolution"`
	Thumbnail      *string `json:"thumbnail"`
	Description    *string `json:"description"`
	Artist         *string `json:"artist"`
	Year           *int    `json:"year"`
	DownloadedAt   string  `json:"downloadedAt"`
	Status         string  `json:"status"`
	Blurred        bool    `json:"blurred"`
}

func toLibraryItemResponse(item models.LibraryItem, blurred bool) LibraryItemResponse {
	return LibraryItemResponse{
		ID:             item.ID,
		DownloadID:     item.DownloadID,
		Title:          item.Title,
		Filename:       item.Filename,
		Path:           item.Path,
		CollectionID:   item.CollectionID,
		CollectionName: item.CollectionName,
		Folder:         item.Folder,
		OriginalURL:    item.OriginalURL,
		Uploader:       item.Uploader,
		Duration:       item.Duration,
		Resolution:     item.Resolution,
		Thumbnail:      item.Thumbnail,
		Description:    item.Description,
		Artist:         item.Artist,
		Year:           item.ReleaseYear,
		DownloadedAt:   item.DownloadedAt.Format(timeFormat),
		Status:         item.Status,
		Blurred:        blurred,
	}
}

type UpdateLibraryItemRequest struct {
	Title       *string `json:"title"`
	Filename    *string `json:"filename"`
	Uploader    *string `json:"uploader"`
	Description *string `json:"description"`
	Duration    *int    `json:"duration"`
	Resolution  *string `json:"resolution"`
	Artist      *string `json:"artist"`
	Year        *int    `json:"year"`
	OriginalURL *string `json:"originalUrl"`
}

// ThumbnailCandidateResponse is one of the 4 candidate frames returned by
// GET /api/library/:id/thumbnail/candidates for the "choose from video"
// flow — the frontend shows all 4 and POSTs back whichever imageBase64 the
// user picked, unchanged.
type ThumbnailCandidateResponse struct {
	TimestampSeconds float64 `json:"timestampSeconds"`
	ImageBase64      string  `json:"imageBase64"`
}

type SetLibraryThumbnailRequest struct {
	ImageBase64 string `json:"imageBase64" binding:"required"`
}

type MoveLibraryItemRequest struct {
	CollectionID *int64 `json:"collectionId"`
	Folder       string `json:"folder"`
}

type CreateCollectionRequest struct {
	Name                string `json:"name" binding:"required"`
	ParentID            *int64 `json:"parentId"`
	RootPath            string `json:"rootPath" binding:"required"`
	DefaultQuality      string `json:"defaultQuality" binding:"omitempty,oneof=best 2160p 1440p 1080p 720p 480p 360p worst"`
	DefaultDownloadType string `json:"defaultDownloadType" binding:"omitempty,oneof=video audio"`
	IsPrivate           bool   `json:"isPrivate"`
}

type UpdateCollectionRequest struct {
	Name                string `json:"name" binding:"required"`
	RootPath            string `json:"rootPath" binding:"required"`
	DefaultQuality      string `json:"defaultQuality" binding:"omitempty,oneof=best 2160p 1440p 1080p 720p 480p 360p worst"`
	DefaultDownloadType string `json:"defaultDownloadType" binding:"omitempty,oneof=video audio"`
	IsPrivate           bool   `json:"isPrivate"`
}

type CollectionResponse struct {
	ID                  int64  `json:"id"`
	Name                string `json:"name"`
	ParentID            *int64 `json:"parentId"`
	RootPath            string `json:"rootPath"`
	Path                string `json:"path"`
	DefaultQuality      string `json:"defaultQuality"`
	DefaultDownloadType string `json:"defaultDownloadType"`
	IsPrivate           bool   `json:"isPrivate"`
	CreatedAt           string `json:"createdAt"`
	UpdatedAt           string `json:"updatedAt"`
}

type SettingsResponse struct {
	DownloadDirectory      string   `json:"downloadDirectory"`
	MaxConcurrentDownloads int      `json:"maxConcurrentDownloads"`
	DefaultQuality         string   `json:"defaultQuality"`
	DefaultDownloadType    string   `json:"defaultDownloadType"`
	ImportIgnoredFolders   []string `json:"importIgnoredFolders"`
}

type UpdateSettingsRequest struct {
	MaxConcurrentDownloads *int      `json:"maxConcurrentDownloads" binding:"omitempty,min=1"`
	DefaultQuality         *string   `json:"defaultQuality" binding:"omitempty,oneof=best 2160p 1440p 1080p 720p 480p 360p worst"`
	DefaultDownloadType    *string   `json:"defaultDownloadType" binding:"omitempty,oneof=video audio"`
	ImportIgnoredFolders   *[]string `json:"importIgnoredFolders"`
}

func toCollectionResponse(c models.Collection, path string) CollectionResponse {
	return CollectionResponse{
		ID:                  c.ID,
		Name:                c.Name,
		ParentID:            c.ParentID,
		RootPath:            c.RootPath,
		Path:                path,
		DefaultQuality:      c.DefaultQuality,
		DefaultDownloadType: c.DefaultDownloadType,
		IsPrivate:           c.IsPrivate,
		CreatedAt:           c.CreatedAt.Format(timeFormat),
		UpdatedAt:           c.UpdatedAt.Format(timeFormat),
	}
}

// effectivePrivacyMap builds, for every collection in cols, whether it or
// any ancestor is marked private — using the same in-memory memoized-
// recursion shape as collectionPaths, so it costs O(N) total for list
// responses that have already fetched the full collections list.
func effectivePrivacyMap(cols []models.Collection) map[int64]bool {
	byID := make(map[int64]models.Collection, len(cols))
	for _, c := range cols {
		byID[c.ID] = c
	}
	private := make(map[int64]bool, len(cols))
	var resolve func(id int64) bool
	resolve = func(id int64) bool {
		if v, ok := private[id]; ok {
			return v
		}
		c := byID[id]
		v := c.IsPrivate
		if !v && c.ParentID != nil {
			v = resolve(*c.ParentID)
		}
		private[id] = v
		return v
	}
	for _, c := range cols {
		resolve(c.ID)
	}
	return private
}

// collectionPaths builds a full path (e.g. "Shows/Anime") for every
// collection in cols by walking each one's parent_id chain using an
// in-memory id->Collection map built once, so this costs O(N) total instead
// of O(N * depth) database round trips.
func collectionPaths(cols []models.Collection) map[int64]string {
	byID := make(map[int64]models.Collection, len(cols))
	for _, c := range cols {
		byID[c.ID] = c
	}
	paths := make(map[int64]string, len(cols))
	var resolve func(id int64) string
	resolve = func(id int64) string {
		if p, ok := paths[id]; ok {
			return p
		}
		c := byID[id]
		if c.ParentID == nil {
			paths[id] = c.RootPath
		} else {
			paths[id] = path.Join(resolve(*c.ParentID), c.RootPath)
		}
		return paths[id]
	}
	for _, c := range cols {
		resolve(c.ID)
	}
	return paths
}

type ScannedFileResponse struct {
	Path              string  `json:"path"`
	Filename          string  `json:"filename"`
	SizeBytes         int64   `json:"sizeBytes"`
	DurationSeconds   *int    `json:"durationSeconds"`
	Resolution        *string `json:"resolution"`
	CollectionPath    string  `json:"collectionPath"`    // "" means it belongs at the media root
	NewCollectionPath string  `json:"newCollectionPath"` // the prefix of CollectionPath that doesn't exist yet, "" if all segments already exist
}

type ImportRequest struct {
	Path        string  `json:"path" binding:"required"`
	OriginalURL *string `json:"originalUrl"`
}

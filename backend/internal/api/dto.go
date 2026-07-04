package api

import (
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
}

func toDownloadResponse(d models.Download, live *queue.LiveProgress) DownloadResponse {
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
	OriginalURL    string  `json:"originalUrl"`
	Uploader       *string `json:"uploader"`
	Duration       *int    `json:"duration"`
	Resolution     *string `json:"resolution"`
	Thumbnail      *string `json:"thumbnail"`
	Description    *string `json:"description"`
	DownloadedAt   string  `json:"downloadedAt"`
	Status         string  `json:"status"`
}

func toLibraryItemResponse(item models.LibraryItem) LibraryItemResponse {
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
		DownloadedAt:   item.DownloadedAt.Format(timeFormat),
		Status:         item.Status,
	}
}

type UpdateLibraryItemRequest struct {
	Title       *string `json:"title"`
	Filename    *string `json:"filename"`
	Uploader    *string `json:"uploader"`
	Description *string `json:"description"`
	Duration    *int    `json:"duration"`
	Resolution  *string `json:"resolution"`
}

type MoveLibraryItemRequest struct {
	CollectionID *int64 `json:"collectionId"`
	Folder       string `json:"folder"`
}

type CreateCollectionRequest struct {
	Name                string `json:"name" binding:"required"`
	RootPath            string `json:"rootPath" binding:"required"`
	DefaultQuality      string `json:"defaultQuality" binding:"omitempty,oneof=best 2160p 1440p 1080p 720p 480p 360p worst"`
	DefaultDownloadType string `json:"defaultDownloadType" binding:"omitempty,oneof=video audio"`
}

type UpdateCollectionRequest struct {
	Name                string `json:"name" binding:"required"`
	RootPath            string `json:"rootPath" binding:"required"`
	DefaultQuality      string `json:"defaultQuality" binding:"omitempty,oneof=best 2160p 1440p 1080p 720p 480p 360p worst"`
	DefaultDownloadType string `json:"defaultDownloadType" binding:"omitempty,oneof=video audio"`
}

type CollectionResponse struct {
	ID                  int64  `json:"id"`
	Name                string `json:"name"`
	RootPath            string `json:"rootPath"`
	DefaultQuality      string `json:"defaultQuality"`
	DefaultDownloadType string `json:"defaultDownloadType"`
	CreatedAt           string `json:"createdAt"`
	UpdatedAt           string `json:"updatedAt"`
}

type SettingsResponse struct {
	DownloadDirectory      string `json:"downloadDirectory"`
	MaxConcurrentDownloads int    `json:"maxConcurrentDownloads"`
	DefaultQuality         string `json:"defaultQuality"`
	DefaultDownloadType    string `json:"defaultDownloadType"`
}

type UpdateSettingsRequest struct {
	MaxConcurrentDownloads *int    `json:"maxConcurrentDownloads" binding:"omitempty,min=1"`
	DefaultQuality         *string `json:"defaultQuality" binding:"omitempty,oneof=best 2160p 1440p 1080p 720p 480p 360p worst"`
	DefaultDownloadType    *string `json:"defaultDownloadType" binding:"omitempty,oneof=video audio"`
}

func toCollectionResponse(c models.Collection) CollectionResponse {
	return CollectionResponse{
		ID:                  c.ID,
		Name:                c.Name,
		RootPath:            c.RootPath,
		DefaultQuality:      c.DefaultQuality,
		DefaultDownloadType: c.DefaultDownloadType,
		CreatedAt:           c.CreatedAt.Format(timeFormat),
		UpdatedAt:           c.UpdatedAt.Format(timeFormat),
	}
}

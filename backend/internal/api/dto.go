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
		ID:           d.ID,
		URL:          d.URL,
		CollectionID: d.CollectionID,
		Folder:       d.Folder,
		Filename:     d.Filename,
		DownloadType: d.DownloadType,
		Quality:      d.Quality,
		AudioFormat:  d.AudioFormat,
		Status:       string(d.Status),
		Title:        d.Title,
		Uploader:     d.Uploader,
		Duration:     d.Duration,
		Thumbnail:    d.Thumbnail,
		ErrorMessage: d.ErrorMessage,
		CreatedAt:    d.CreatedAt.Format(timeFormat),
		UpdatedAt:    d.UpdatedAt.Format(timeFormat),
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
	ID           int64   `json:"id"`
	DownloadID   *int64  `json:"downloadId"`
	Title        string  `json:"title"`
	Filename     string  `json:"filename"`
	Path         string  `json:"path"`
	CollectionID *int64  `json:"collectionId"`
	Folder       string  `json:"folder"`
	OriginalURL  string  `json:"originalUrl"`
	Uploader     *string `json:"uploader"`
	Duration     *int    `json:"duration"`
	Resolution   *string `json:"resolution"`
	Thumbnail    *string `json:"thumbnail"`
	Description  *string `json:"description"`
	DownloadedAt string  `json:"downloadedAt"`
	Status       string  `json:"status"`
}

func toLibraryItemResponse(item models.LibraryItem) LibraryItemResponse {
	return LibraryItemResponse{
		ID:           item.ID,
		DownloadID:   item.DownloadID,
		Title:        item.Title,
		Filename:     item.Filename,
		Path:         item.Path,
		CollectionID: item.CollectionID,
		Folder:       item.Folder,
		OriginalURL:  item.OriginalURL,
		Uploader:     item.Uploader,
		Duration:     item.Duration,
		Resolution:   item.Resolution,
		Thumbnail:    item.Thumbnail,
		Description:  item.Description,
		DownloadedAt: item.DownloadedAt.Format(timeFormat),
		Status:       item.Status,
	}
}

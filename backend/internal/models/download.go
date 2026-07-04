package models

import "time"

type DownloadStatus string

const (
	StatusQueued           DownloadStatus = "queued"
	StatusFetchingMetadata DownloadStatus = "fetching_metadata"
	StatusDownloading      DownloadStatus = "downloading"
	StatusProcessing       DownloadStatus = "processing"
	StatusCompleted        DownloadStatus = "completed"
	StatusFailed           DownloadStatus = "failed"
	StatusCancelled        DownloadStatus = "cancelled"
	StatusInterrupted      DownloadStatus = "interrupted"
)

// activeStatuses are the statuses a download can be in while a worker owns
// it. Used by crash recovery to find rows that were mid-flight when the
// process died.
var activeStatuses = []DownloadStatus{StatusQueued, StatusFetchingMetadata, StatusDownloading, StatusProcessing}

func ActiveStatuses() []DownloadStatus {
	return activeStatuses
}

type Download struct {
	ID             int64
	URL            string
	VideoID        *string
	CollectionID   *int64
	CollectionName *string
	Folder         string
	Filename       string
	DownloadType   string // "video" | "audio"
	Quality        string
	AudioFormat    *string
	Status         DownloadStatus
	Title          *string
	Uploader       *string
	Duration       *int
	Resolution     *string
	Thumbnail      *string
	ErrorMessage   *string
	YtDlpCommand   *string
	ExitCode       *int
	StdoutTail     *string
	StderrTail     *string
	RetryCount     int
	CreatedAt      time.Time
	UpdatedAt      time.Time
	CompletedAt    *time.Time
}

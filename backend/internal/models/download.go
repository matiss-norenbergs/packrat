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

	// OverrideTitle/Artist/Year/SeasonNumber/SequenceNumber let the New
	// Download dialog set these fields up front instead of waiting for a
	// post-download Edit — when set, they take priority over whatever
	// yt-dlp reports. FilenamePrefix is combined with the (possibly
	// overridden) title at completion time to build the final filename,
	// unless the literal Filename override above is also set.
	OverrideTitle          *string
	OverrideArtistID       *int64
	OverrideYear           *int
	OverrideSeasonNumber   *int
	OverrideSequenceNumber *int
	FilenamePrefix         *string
	// OverrideTags are applied to the resulting library item once the
	// download completes (same "apply on completion" shape as the other
	// overrides above) — currently only set by the backup/library import
	// flow, which knows the original item's tags but can't attach them to
	// a library_id that doesn't exist yet. Stored as a JSON array in a
	// single TEXT column (see downloads_repo.go) rather than a join table,
	// since it's a one-shot value consumed once at completion, not
	// queryable relational data like library_tags.
	OverrideTags []string
	// GenerateNFO, when true, is applied to the resulting library item at
	// creation time and triggers writing its .nfo sidecar once the download
	// completes — the download-time equivalent of turning on "Generate NFO"
	// in the Edit dialog, but up front rather than as a follow-up action.
	GenerateNFO bool
}

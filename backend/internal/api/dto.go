package api

import (
	"fmt"
	"os"
	"path"
	"path/filepath"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/models"
	"packrat/backend/internal/queue"
)

type SetupRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required,min=8"`
}

type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type AuthStatusResponse struct {
	SetupRequired bool `json:"setupRequired"`
	Authenticated bool `json:"authenticated"`
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"currentPassword" binding:"required"`
	NewPassword     string `json:"newPassword" binding:"required,min=8"`
}

type CreateDownloadRequest struct {
	URL          string `json:"url" binding:"required,url"`
	CollectionID *int64 `json:"collectionId"`
	Folder       string `json:"folder"`
	Filename     string `json:"filename"`
	DownloadType string `json:"downloadType" binding:"required,oneof=video audio"`
	Quality      string `json:"quality"`
	AudioFormat  string `json:"audioFormat"`

	// Optional metadata overrides — when set, used instead of whatever
	// yt-dlp reports for that field once the download completes.
	Title          *string `json:"title"`
	ArtistID       *int64  `json:"artistId"`
	Year           *int    `json:"year"`
	SeasonNumber   *int    `json:"seasonNumber"`
	SequenceNumber *int    `json:"sequenceNumber"`
	// FilenamePrefix is combined with the effective title at completion
	// time to build the final filename — ignored if Filename is also set.
	FilenamePrefix *string `json:"filenamePrefix"`
}

type PreviewDownloadRequest struct {
	URL string `json:"url" binding:"required,url"`
}

type PreviewDownloadResponse struct {
	Title      string  `json:"title"`
	Uploader   string  `json:"uploader"`
	Duration   int     `json:"duration"` // seconds, rounded from yt-dlp's float
	Thumbnail  string  `json:"thumbnail"`
	Resolution *string `json:"resolution"` // nil unless yt-dlp reported both width and height
}

func toPreviewDownloadResponse(m *downloader.Metadata) PreviewDownloadResponse {
	resp := PreviewDownloadResponse{
		Title:     m.Title,
		Uploader:  m.Uploader,
		Duration:  int(m.Duration),
		Thumbnail: m.Thumbnail,
	}
	if m.Width > 0 && m.Height > 0 {
		res := fmt.Sprintf("%dx%d", m.Width, m.Height)
		resp.Resolution = &res
	}
	return resp
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
	ID             int64    `json:"id"`
	DownloadID     *int64   `json:"downloadId"`
	Title          string   `json:"title"`
	Filename       string   `json:"filename"`
	Path           string   `json:"path"`
	CollectionID   *int64   `json:"collectionId"`
	CollectionName *string  `json:"collectionName"`
	Folder         string   `json:"folder"`
	OriginalURL    *string  `json:"originalUrl"`
	Uploader       *string  `json:"uploader"`
	Duration       *int     `json:"duration"`
	Resolution     *string  `json:"resolution"`
	Thumbnail      *string  `json:"thumbnail"`
	Description    *string  `json:"description"`
	ArtistID       *int64   `json:"artistId"`
	ArtistName     *string  `json:"artistName"`
	Year           *int     `json:"year"`
	SequenceNumber *int     `json:"sequenceNumber"`
	SeasonNumber   *int     `json:"seasonNumber"`
	GenerateNFO    bool     `json:"generateNfo"`
	NFOExists      bool     `json:"nfoExists"`
	DownloadedAt   string   `json:"downloadedAt"`
	Status         string   `json:"status"`
	Blurred        bool     `json:"blurred"`
	FileSizeBytes  *int64   `json:"fileSizeBytes"`
	Tags           []string `json:"tags"`
}

// toLibraryItemResponse builds the API response for a library item. mediaRoot
// is needed to check whether the item's .nfo sidecar currently exists on
// disk — GenerateNFO only reflects whether the toggle is on, not whether a
// file is actually present (it can be turned off after generating, or
// deleted independently via the "Delete File" action while still on).
func toLibraryItemResponse(item models.LibraryItem, blurred bool, tags []string, mediaRoot string) LibraryItemResponse {
	if tags == nil {
		tags = []string{}
	}
	mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
	_, err := os.Stat(nfoAbsPathFor(mediaAbs))
	nfoExists := err == nil
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
		ArtistID:       item.ArtistID,
		ArtistName:     item.ArtistName,
		Year:           item.ReleaseYear,
		SequenceNumber: item.SequenceNumber,
		SeasonNumber:   item.SeasonNumber,
		GenerateNFO:    item.GenerateNFO,
		NFOExists:      nfoExists,
		DownloadedAt:   item.DownloadedAt.Format(timeFormat),
		Status:         item.Status,
		Blurred:        blurred,
		FileSizeBytes:  item.FileSizeBytes,
		Tags:           tags,
	}
}

type UpdateLibraryItemRequest struct {
	Title          *string   `json:"title"`
	Filename       *string   `json:"filename"`
	Uploader       *string   `json:"uploader"`
	Description    *string   `json:"description"`
	Duration       *int      `json:"duration"`
	Resolution     *string   `json:"resolution"`
	// ArtistID: nil means "leave unchanged" (field omitted or absent), 0
	// means "clear the artist" — a real artist id is never 0 since
	// AUTOINCREMENT starts at 1, so 0 is an unambiguous sentinel for
	// explicit clearing within this partial-merge PATCH.
	ArtistID       *int64    `json:"artistId"`
	Year           *int      `json:"year"`
	SequenceNumber *int      `json:"sequenceNumber"`
	SeasonNumber   *int      `json:"seasonNumber"`
	GenerateNFO    *bool     `json:"generateNfo"`
	OriginalURL    *string   `json:"originalUrl"`
	Tags           *[]string `json:"tags"`
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
	Name                string  `json:"name" binding:"required"`
	ParentID            *int64  `json:"parentId"`
	RootPath            string  `json:"rootPath" binding:"required"`
	DefaultQuality      string  `json:"defaultQuality" binding:"omitempty,oneof=best 2160p 1440p 1080p 720p 480p 360p worst"`
	DefaultDownloadType string  `json:"defaultDownloadType" binding:"omitempty,oneof=video audio"`
	IsPrivate           bool    `json:"isPrivate"`
	JellyfinLibraryID   *string `json:"jellyfinLibraryId"`
}

type UpdateCollectionRequest struct {
	Name                string  `json:"name" binding:"required"`
	RootPath            string  `json:"rootPath" binding:"required"`
	DefaultQuality      string  `json:"defaultQuality" binding:"omitempty,oneof=best 2160p 1440p 1080p 720p 480p 360p worst"`
	DefaultDownloadType string  `json:"defaultDownloadType" binding:"omitempty,oneof=video audio"`
	IsPrivate           bool    `json:"isPrivate"`
	JellyfinLibraryID   *string `json:"jellyfinLibraryId"`
}

type CollectionResponse struct {
	ID                  int64   `json:"id"`
	Name                string  `json:"name"`
	ParentID            *int64  `json:"parentId"`
	RootPath            string  `json:"rootPath"`
	Path                string  `json:"path"`
	DefaultQuality      string  `json:"defaultQuality"`
	DefaultDownloadType string  `json:"defaultDownloadType"`
	IsPrivate           bool    `json:"isPrivate"`
	ItemCount           int     `json:"itemCount"`
	JellyfinLibraryID   *string `json:"jellyfinLibraryId"`
	CreatedAt           string  `json:"createdAt"`
	UpdatedAt           string  `json:"updatedAt"`
}

type TagResponse struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	CreatedAt  string `json:"createdAt"`
	UsageCount int    `json:"usageCount"`
}

type CreateTagRequest struct {
	Name string `json:"name" binding:"required"`
}

type UpdateTagRequest struct {
	Name string `json:"name" binding:"required"`
}

func toTagResponse(t models.TagWithCount) TagResponse {
	return TagResponse{
		ID:         t.ID,
		Name:       t.Name,
		CreatedAt:  t.CreatedAt.Format(timeFormat),
		UsageCount: t.UsageCount,
	}
}

type ArtistResponse struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	CreatedAt  string `json:"createdAt"`
	UsageCount int    `json:"usageCount"`
}

type CreateArtistRequest struct {
	Name string `json:"name" binding:"required"`
}

type UpdateArtistRequest struct {
	Name string `json:"name" binding:"required"`
}

func toArtistResponse(a models.ArtistWithCount) ArtistResponse {
	return ArtistResponse{
		ID:         a.ID,
		Name:       a.Name,
		CreatedAt:  a.CreatedAt.Format(timeFormat),
		UsageCount: a.UsageCount,
	}
}

type SettingsResponse struct {
	DownloadDirectory      string   `json:"downloadDirectory"`
	MaxConcurrentDownloads int      `json:"maxConcurrentDownloads"`
	DefaultQuality         string   `json:"defaultQuality"`
	DefaultDownloadType    string   `json:"defaultDownloadType"`
	ImportIgnoredFolders   []string `json:"importIgnoredFolders"`
	HistoryAnonymizeURLs   bool     `json:"historyAnonymizeUrls"`
	LibraryView            string   `json:"libraryView"`
	LibrarySortKey         string   `json:"librarySortKey"`
	LibrarySortDir         string   `json:"librarySortDir"`
	LibraryMode            string   `json:"libraryMode"`
	ThumbnailFrameCount    int      `json:"thumbnailFrameCount"`
	PrivacyBlurStrength    string   `json:"privacyBlurStrength"`
	SkipDownloadPreview    bool     `json:"skipDownloadPreview"`
	JellyfinEnabled        bool     `json:"jellyfinEnabled"`
	JellyfinURL            string   `json:"jellyfinUrl"`
	JellyfinAPIKey         string   `json:"jellyfinApiKey"`
}

type UpdateSettingsRequest struct {
	MaxConcurrentDownloads *int      `json:"maxConcurrentDownloads" binding:"omitempty,min=1"`
	DefaultQuality         *string   `json:"defaultQuality" binding:"omitempty,oneof=best 2160p 1440p 1080p 720p 480p 360p worst"`
	DefaultDownloadType    *string   `json:"defaultDownloadType" binding:"omitempty,oneof=video audio"`
	ImportIgnoredFolders   *[]string `json:"importIgnoredFolders"`
	HistoryAnonymizeURLs   *bool     `json:"historyAnonymizeUrls"`
	LibraryView            *string   `json:"libraryView" binding:"omitempty,oneof=grid folders"`
	LibrarySortKey         *string   `json:"librarySortKey" binding:"omitempty,oneof=downloadedAt title filename year duration sequenceNumber"`
	LibrarySortDir         *string   `json:"librarySortDir" binding:"omitempty,oneof=asc desc"`
	LibraryMode            *string   `json:"libraryMode" binding:"omitempty,oneof=manage details"`
	ThumbnailFrameCount    *int      `json:"thumbnailFrameCount" binding:"omitempty,oneof=2 4 6 8"`
	PrivacyBlurStrength    *string   `json:"privacyBlurStrength" binding:"omitempty,oneof=weak default strong"`
	SkipDownloadPreview    *bool     `json:"skipDownloadPreview"`
	JellyfinEnabled        *bool     `json:"jellyfinEnabled"`
	JellyfinURL            *string   `json:"jellyfinUrl"`
	JellyfinAPIKey         *string   `json:"jellyfinApiKey"`
}

func toCollectionResponse(c models.Collection, path string, itemCount int) CollectionResponse {
	return CollectionResponse{
		ID:                  c.ID,
		Name:                c.Name,
		ParentID:            c.ParentID,
		RootPath:            c.RootPath,
		Path:                path,
		DefaultQuality:      c.DefaultQuality,
		DefaultDownloadType: c.DefaultDownloadType,
		IsPrivate:           c.IsPrivate,
		ItemCount:           itemCount,
		JellyfinLibraryID:   c.JellyfinLibrary,
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

type HistoryResponse struct {
	ID           int64   `json:"id"`
	DownloadID   *int64  `json:"downloadId"`
	URL          string  `json:"url"`
	Title        *string `json:"title"`
	Thumbnail    *string `json:"thumbnail"`
	Status       string  `json:"status"`
	ErrorMessage *string `json:"errorMessage"`
	CreatedAt    string  `json:"createdAt"`
}

// toHistoryResponse builds the API response for a history row. When
// anonymize is true, url is replaced with a hash placeholder (see
// anonymizeURL) and title/thumbnail are nulled out too — otherwise a
// completed download's title (e.g. "Me at the zoo") would still give away
// exactly what was downloaded even with the URL hidden.
func toHistoryResponse(h models.History, anonymize bool) HistoryResponse {
	resp := HistoryResponse{
		ID:           h.ID,
		DownloadID:   h.DownloadID,
		URL:          h.URL,
		Title:        h.Title,
		Thumbnail:    h.Thumbnail,
		Status:       h.Status,
		ErrorMessage: h.ErrorMessage,
		CreatedAt:    h.CreatedAt.Format(timeFormat),
	}
	if anonymize {
		resp.URL = anonymizeURL(h.URL)
		resp.Title = nil
		resp.Thumbnail = nil
	}
	return resp
}

type LogEntryResponse struct {
	ID           int64   `json:"id"`
	Title        *string `json:"title"`
	URL          string  `json:"url"`
	Status       string  `json:"status"`
	YtDlpCommand *string `json:"ytdlpCommand"`
	ExitCode     *int    `json:"exitCode"`
	StdoutTail   *string `json:"stdoutTail"`
	StderrTail   *string `json:"stderrTail"`
	RetryCount   int     `json:"retryCount"`
	ErrorMessage *string `json:"errorMessage"`
	CreatedAt    string  `json:"createdAt"`
	CompletedAt  *string `json:"completedAt"`
}

// toLogEntryResponse builds the API response for a logs row. When anonymize
// is true, url is replaced with a hash placeholder (see anonymizeURL) and
// title is nulled out too, matching History's anonymization behavior.
func toLogEntryResponse(d models.Download, anonymize bool) LogEntryResponse {
	resp := LogEntryResponse{
		ID:           d.ID,
		Title:        d.Title,
		URL:          d.URL,
		Status:       string(d.Status),
		YtDlpCommand: d.YtDlpCommand,
		ExitCode:     d.ExitCode,
		StdoutTail:   d.StdoutTail,
		StderrTail:   d.StderrTail,
		RetryCount:   d.RetryCount,
		ErrorMessage: d.ErrorMessage,
		CreatedAt:    d.CreatedAt.Format(timeFormat),
	}
	if d.CompletedAt != nil {
		s := d.CompletedAt.Format(timeFormat)
		resp.CompletedAt = &s
	}
	if anonymize {
		resp.URL = anonymizeURL(d.URL)
		resp.Title = nil
	}
	return resp
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

type StatsResponse struct {
	ActiveDownloads   int   `json:"activeDownloads"`
	QueuedDownloads   int   `json:"queuedDownloads"`
	CompletedToday    int   `json:"completedToday"`
	LibraryVideoCount int   `json:"libraryVideoCount"`
	LibraryAudioCount int   `json:"libraryAudioCount"`
	TotalStorageBytes int64 `json:"totalStorageBytes"`
}

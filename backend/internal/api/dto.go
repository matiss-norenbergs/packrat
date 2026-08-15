package api

import (
	"fmt"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"time"

	"packrat/backend/internal/backup"
	"packrat/backend/internal/downloader"
	"packrat/backend/internal/models"
	"packrat/backend/internal/nfo"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/thumbnailenhance"
)

// isHTTPURL reports whether raw parses as an absolute http(s) URL with a
// host. The `url` binding tag alone accepts any scheme (file://, data:,
// etc.) since it only checks "this parses as a URL" — handlers that hand a
// request's URL field to yt-dlp call this afterward as a defense-in-depth
// check independent of whatever protocol allowlisting yt-dlp itself does.
func isHTTPURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	return (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

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
	// FilenameTemplate is the newer, more general replacement for
	// FilenamePrefix (see internal/nametemplate) — takes priority over it,
	// but still loses to a literal Filename.
	FilenameTemplate *string `json:"filenameTemplate"`
	// Tags are applied to the resulting library item once the download
	// completes (tag names, created if missing) — currently only set by
	// the backup/library import flow (see ImportLibrary), which knows the
	// original item's tags but has no library_id yet to attach them to.
	Tags []string `json:"tags"`
	// GenerateNFO turns on the resulting library item's "Generate NFO"
	// toggle up front and writes its .nfo sidecar once the download
	// completes — the download-time equivalent of enabling it afterward via
	// the Edit dialog.
	GenerateNFO bool `json:"generateNfo"`

	// TargetLibraryItemID/OverwriteFields make this a redownload of an
	// existing library item rather than a new one — json:"-" so a public
	// POST /downloads client can never set them via the JSON body; only
	// RedownloadLibraryItem/RedownloadLibraryItemFromURL set them
	// internally before calling enqueueDownload.
	TargetLibraryItemID *int64   `json:"-"`
	OverwriteFields     []string `json:"-"`
}

// RedownloadFromURLRequest is the body of POST
// /library/:id/redownload/from-url — the "Redownload from different URL"
// dialog's submit action.
type RedownloadFromURLRequest struct {
	URL string `json:"url" binding:"required,url"`
	// OverwriteFields is a subset of {"title","uploader","description",
	// "thumbnail","resolution","duration"} — validated against that
	// allowlist by the handler. OriginalURL/VideoID always update to the
	// new URL regardless of this list; they're identifiers, not optional
	// content.
	OverwriteFields []string `json:"overwriteFields"`
}

// RedownloadPreviewResponse is the "Redownload from different URL" dialog's
// right-hand preview — fetched metadata for a candidate URL, plus whether
// that URL already matches a *different* library item (Duplicate is nil if
// it matches nothing, or matches the item being redownloaded itself).
type RedownloadPreviewResponse struct {
	LibraryItemMetadataPreviewResponse
	Duplicate *DuplicateInfo `json:"duplicate"`
}

type PreviewDownloadRequest struct {
	URL string `json:"url" binding:"required,url"`
}

type PreviewDownloadResponse struct {
	Title      string  `json:"title"`
	Uploader   string  `json:"uploader"`
	UploadDate string  `json:"uploadDate"` // yt-dlp upload_date, YYYYMMDD; "" if unknown
	Duration   int     `json:"duration"`   // seconds, rounded from yt-dlp's float
	Thumbnail  string  `json:"thumbnail"`
	Resolution *string `json:"resolution"` // nil unless yt-dlp reported both width and height

	// Playlist fields — IsPlaylist is false and the rest are zero-valued for
	// a normal single-video URL. When true, the single-video fields above
	// are left zero-valued instead (there is no one "the video" to preview).
	IsPlaylist    bool   `json:"isPlaylist"`
	PlaylistTitle string `json:"playlistTitle,omitempty"`
	PlaylistCount int    `json:"playlistCount,omitempty"`

	// Duplicate is set only for a non-playlist URL that already matches a
	// library item by original URL or video ID; nil otherwise.
	Duplicate *DuplicateInfo `json:"duplicate"`
}

type DuplicateInfo struct {
	LibraryItemID int64   `json:"libraryItemId"`
	Title         string  `json:"title"`
	Thumbnail     *string `json:"thumbnail"`
	DownloadedAt  string  `json:"downloadedAt"`
}

// toPreviewDownloadResponse builds the preview response from yt-dlp's
// metadata and (for a non-playlist URL) an already-performed duplicate
// lookup — dup is nil when none was found or none was attempted.
func toPreviewDownloadResponse(m *downloader.Metadata, dup *models.LibraryItem) PreviewDownloadResponse {
	if m.IsPlaylist() {
		return PreviewDownloadResponse{
			IsPlaylist:    true,
			PlaylistTitle: m.Title,
			PlaylistCount: len(m.Entries),
		}
	}

	resp := PreviewDownloadResponse{
		Title:      m.Title,
		Uploader:   m.Uploader,
		UploadDate: m.UploadDate,
		Duration:   int(m.Duration),
		Thumbnail:  m.Thumbnail,
	}
	if m.Width > 0 && m.Height > 0 {
		res := fmt.Sprintf("%dx%d", m.Width, m.Height)
		resp.Resolution = &res
	}
	if dup != nil {
		resp.Duplicate = &DuplicateInfo{
			LibraryItemID: dup.ID,
			Title:         dup.Title,
			Thumbnail:     dup.Thumbnail,
			DownloadedAt:  dup.DownloadedAt.Format(time.RFC3339),
		}
	}
	return resp
}

// LibraryItemMetadataPreviewResponse is the read-only "what's currently at
// the source URL" side of the Compare Metadata dialog — the same field set
// RefreshLibraryItemMetadata would overwrite the saved item with, but never
// written to the DB here.
type LibraryItemMetadataPreviewResponse struct {
	Title       string  `json:"title"`
	Uploader    string  `json:"uploader"`
	Duration    int     `json:"duration"`
	Description string  `json:"description"`
	Thumbnail   string  `json:"thumbnail"`
	Resolution  *string `json:"resolution"`
}

func toLibraryItemMetadataPreviewResponse(m *downloader.Metadata) LibraryItemMetadataPreviewResponse {
	resp := LibraryItemMetadataPreviewResponse{
		Title:       m.Title,
		Uploader:    m.Uploader,
		Duration:    int(m.Duration),
		Description: m.Description,
		Thumbnail:   m.Thumbnail,
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
	ID                      int64    `json:"id"`
	DownloadID              *int64   `json:"downloadId"`
	Title                   string   `json:"title"`
	Filename                string   `json:"filename"`
	Path                    string   `json:"path"`
	CollectionID            *int64   `json:"collectionId"`
	CollectionName          *string  `json:"collectionName"`
	Folder                  string   `json:"folder"`
	OriginalURL             *string  `json:"originalUrl"`
	Uploader                *string  `json:"uploader"`
	Duration                *int     `json:"duration"`
	Resolution              *string  `json:"resolution"`
	MediaType               *string  `json:"mediaType"`
	Thumbnail               *string  `json:"thumbnail"`
	ThumbnailSmallPath      *string  `json:"thumbnailSmallPath"`
	ThumbnailMediumPath     *string  `json:"thumbnailMediumPath"`
	Description             *string  `json:"description"`
	ArtistID                *int64   `json:"artistId"`
	ArtistName              *string  `json:"artistName"`
	Year                    *int     `json:"year"`
	SequenceNumber          *int     `json:"sequenceNumber"`
	SeasonNumber            *int     `json:"seasonNumber"`
	GenerateNFO             bool     `json:"generateNfo"`
	NFOExists               bool     `json:"nfoExists"`
	DownloadedAt            string   `json:"downloadedAt"`
	Status                  string   `json:"status"`
	Blurred                 bool     `json:"blurred"`
	FileSizeBytes           *int64   `json:"fileSizeBytes"`
	Tags                    []string `json:"tags"`
	PlaybackPositionSeconds *int     `json:"playbackPositionSeconds"`
	LastWatchedAt           *string  `json:"lastWatchedAt"`
}

// UpdateLibraryProgressRequest is POST /library/:id/progress's body — a
// narrow, frequently-called endpoint (fired every few seconds during video
// playback) kept separate from UpdateLibraryItemRequest's general field-edit
// form.
type UpdateLibraryProgressRequest struct {
	PositionSeconds int `json:"positionSeconds" binding:"gte=0"`
}

// LibraryListResponse wraps GET /api/library's results — always a wrapper
// (not a bare array) whether or not pagination is active, so the shape is
// consistent regardless of query params. Total is the full match count
// (ignoring page/pageSize), used to build "Page X of Y" controls.
type LibraryListResponse struct {
	Items []LibraryItemResponse `json:"items"`
	Total int                   `json:"total"`
}

// LibraryFacetsResponse backs filter pickers that need every possible value
// across the whole library, independent of the current search/filter/page.
type LibraryFacetsResponse struct {
	Years []int `json:"years"`
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
	_, err := os.Stat(nfo.SidecarPath(mediaAbs))
	nfoExists := err == nil
	var lastWatchedAt *string
	if item.LastWatchedAt != nil {
		s := item.LastWatchedAt.Format(timeFormat)
		lastWatchedAt = &s
	}
	return LibraryItemResponse{
		ID:                      item.ID,
		DownloadID:              item.DownloadID,
		Title:                   item.Title,
		Filename:                item.Filename,
		Path:                    item.Path,
		CollectionID:            item.CollectionID,
		CollectionName:          item.CollectionName,
		Folder:                  item.Folder,
		OriginalURL:             item.OriginalURL,
		Uploader:                item.Uploader,
		Duration:                item.Duration,
		Resolution:              item.Resolution,
		MediaType:               item.MediaType,
		Thumbnail:               item.Thumbnail,
		ThumbnailSmallPath:      item.ThumbnailSmallPath,
		ThumbnailMediumPath:     item.ThumbnailMediumPath,
		Description:             item.Description,
		ArtistID:                item.ArtistID,
		ArtistName:              item.ArtistName,
		Year:                    item.ReleaseYear,
		SequenceNumber:          item.SequenceNumber,
		SeasonNumber:            item.SeasonNumber,
		GenerateNFO:             item.GenerateNFO,
		NFOExists:               nfoExists,
		DownloadedAt:            item.DownloadedAt.Format(timeFormat),
		Status:                  item.Status,
		Blurred:                 blurred,
		FileSizeBytes:           item.FileSizeBytes,
		Tags:                    tags,
		PlaybackPositionSeconds: item.PlaybackPositionSeconds,
		LastWatchedAt:           lastWatchedAt,
	}
}

type UpdateLibraryItemRequest struct {
	Title       *string `json:"title"`
	Filename    *string `json:"filename"`
	Uploader    *string `json:"uploader"`
	Description *string `json:"description"`
	Duration    *int    `json:"duration"`
	Resolution  *string `json:"resolution"`
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

// BulkAssignTagsRequest overwrites the tag set on every listed item — not a
// merge, matching the frontend's "assign tags" bulk-edit dialog, which warns
// the user about the overwrite up front rather than offering an add mode.
type BulkAssignTagsRequest struct {
	ItemIDs []int64  `json:"itemIds" binding:"required,min=1"`
	Tags    []string `json:"tags"`
}

// AddToCompareListRequest is POST /api/compare-list's body — a plain id
// list, same shape as BulkDeleteRequest but semantically an add rather than
// a delete.
type AddToCompareListRequest struct {
	ItemIDs []int64 `json:"itemIds" binding:"required,min=1"`
}

// BulkDeleteRequest is shared by the tags/artists/collections bulk-delete
// endpoints — all three delete by plain id list.
type BulkDeleteRequest struct {
	IDs []int64 `json:"ids" binding:"required,min=1"`
}

// BulkDeleteResponse reports how many ids were actually deleted. Skipped is
// only ever populated by collections bulk-delete — a selected collection
// whose child wasn't also selected in the same batch can't be deleted (see
// CollectionsRepo.Delete's ErrHasChildren); tags/artists never reject a
// delete for being "in use", so they have nothing to skip beyond an id
// that's already gone, which isn't worth surfacing.
type BulkDeleteResponse struct {
	Deleted int     `json:"deleted"`
	Skipped []int64 `json:"skipped,omitempty"`
}

// BulkDeleteLibraryItemsRequest mirrors DeleteLibraryItem's per-item
// semantics (see that handler) applied to a batch — DeleteFiles is a single
// flag for the whole batch, not per item.
type BulkDeleteLibraryItemsRequest struct {
	ItemIDs     []int64 `json:"itemIds" binding:"required,min=1"`
	DeleteFiles bool    `json:"deleteFiles"`
}

// BulkDeleteLibraryItemFilesRequest mirrors DeleteLibraryItemFile's
// per-item semantics applied to a batch — see BulkDeleteLibraryItemFiles.
type BulkDeleteLibraryItemFilesRequest struct {
	ItemIDs         []int64 `json:"itemIds" binding:"required,min=1"`
	DeleteThumbnail bool    `json:"deleteThumbnail"`
}

// BulkRedownloadLibraryItemsRequest is the "Download file(s)" bulk
// operation's body — one enqueueRedownload call per item, from each item's
// own OriginalURL. Items with no URL at all are silently skipped, same
// convention as every other bulk operation here.
type BulkRedownloadLibraryItemsRequest struct {
	ItemIDs []int64 `json:"itemIds" binding:"required,min=1"`
}

// BulkFetchLibraryThumbnailsRequest is the "Download thumbnail(s)" bulk
// operation's body — same URL-required, silently-skip-the-rest semantics as
// BulkRedownloadLibraryItemsRequest.
type BulkFetchLibraryThumbnailsRequest struct {
	ItemIDs []int64 `json:"itemIds" binding:"required,min=1"`
}

// BulkRedownloadResponse reports how many items were actually queued for
// download vs silently skipped (no source URL, item gone, or the queue
// itself rejected the job).
type BulkRedownloadResponse struct {
	Queued  int `json:"queued"`
	Skipped int `json:"skipped"`
}

// BulkFetchThumbnailsResponse reports how many items actually got a new
// thumbnail vs silently skipped (no source URL, item gone, or the fetch
// itself failed — thumbnail fetch is already best-effort per-item, see
// fetchGhostThumbnail).
type BulkFetchThumbnailsResponse struct {
	Fetched int `json:"fetched"`
	Skipped int `json:"skipped"`
}

// MissingLibraryFileResponse is one item ScanMissingLibraryFiles found and
// converted to a ghost — just enough for the frontend's summary toast.
type MissingLibraryFileResponse struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
}

// ScanMissingLibraryFilesResponse reports how many items were checked and
// which ones (if any) had their file missing and got converted to ghosts.
type ScanMissingLibraryFilesResponse struct {
	Scanned int                          `json:"scanned"`
	Missing []MissingLibraryFileResponse `json:"missing"`
}

// ThumbnailCandidateResponse is one of the candidate frames returned by
// GET /api/library/:id/thumbnail/candidates for the "choose from video"
// flow — the frontend shows all of them and POSTs back whichever
// imageBase64 the user picked, unchanged.
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

// TrimPreviewRequest is POST /library/:id/trim/preview's body. At least one
// of TrimStartSeconds/TrimEndSeconds must be set (validated in the
// handler) — nil means "don't trim that end".
type TrimPreviewRequest struct {
	TrimStartSeconds *float64 `json:"trimStartSeconds"`
	TrimEndSeconds   *float64 `json:"trimEndSeconds"`
}

// TrimPreviewResponse describes the generated preview file — PreviewPath is
// MediaRoot-relative, same shape as LibraryItemResponse.Path, so the client
// can build a playable URL with the existing mediaFileUrl() helper.
type TrimPreviewResponse struct {
	PreviewPath     string `json:"previewPath"`
	DurationSeconds int    `json:"durationSeconds"`
	FileSizeBytes   int64  `json:"fileSizeBytes"`
}

// TrimActionRequest is shared by POST /library/:id/trim/accept and
// POST /library/:id/trim/discard — both just need to know which preview
// file to act on.
type TrimActionRequest struct {
	PreviewPath string `json:"previewPath" binding:"required"`
}

// TrimFrameResponse is one decoded frame returned by
// GET /library/:id/trim/frames — the "browse every frame in a short window,
// click the exact one" mechanism the trim dialog uses to set a precise
// Start/End point without relying on the browser <video> element's own
// (not reliably frame-accurate) seeking.
type TrimFrameResponse struct {
	TimestampSeconds float64 `json:"timestampSeconds"`
	ImageBase64      string  `json:"imageBase64"`
}

type CreateCollectionRequest struct {
	Name                string  `json:"name" binding:"required"`
	ParentID            *int64  `json:"parentId"`
	RootPath            string  `json:"rootPath" binding:"required"`
	DefaultQuality      string  `json:"defaultQuality" binding:"omitempty,oneof=best 2160p 1440p 1080p 720p 480p 360p worst"`
	DefaultDownloadType string  `json:"defaultDownloadType" binding:"omitempty,oneof=video audio"`
	FilenameTemplate    string  `json:"filenameTemplate"`
	IsPrivate           bool    `json:"isPrivate"`
	JellyfinLibraryID   *string `json:"jellyfinLibraryId"`
	SeasonNumber        *int    `json:"seasonNumber"`
	Year                *int    `json:"year"`
	SequenceMin         *int    `json:"sequenceMin"`
	SequenceMax         *int    `json:"sequenceMax"`
	ArtistID            *int64  `json:"artistId"`
	BrowseAsShow        bool    `json:"browseAsShow"`
}

type UpdateCollectionRequest struct {
	Name                string  `json:"name" binding:"required"`
	RootPath            string  `json:"rootPath" binding:"required"`
	DefaultQuality      string  `json:"defaultQuality" binding:"omitempty,oneof=best 2160p 1440p 1080p 720p 480p 360p worst"`
	DefaultDownloadType string  `json:"defaultDownloadType" binding:"omitempty,oneof=video audio"`
	FilenameTemplate    string  `json:"filenameTemplate"`
	IsPrivate           bool    `json:"isPrivate"`
	JellyfinLibraryID   *string `json:"jellyfinLibraryId"`
	SeasonNumber        *int    `json:"seasonNumber"`
	Year                *int    `json:"year"`
	SequenceMin         *int    `json:"sequenceMin"`
	SequenceMax         *int    `json:"sequenceMax"`
	ArtistID            *int64  `json:"artistId"`
	BrowseAsShow        bool    `json:"browseAsShow"`
}

type SequenceGapResponse struct {
	Min     int   `json:"min"`
	Max     int   `json:"max"`
	Count   int   `json:"count"`
	Missing []int `json:"missing"`
}

type CollectionResponse struct {
	ID                   int64   `json:"id"`
	Name                 string  `json:"name"`
	ParentID             *int64  `json:"parentId"`
	RootPath             string  `json:"rootPath"`
	Path                 string  `json:"path"`
	DefaultQuality       string  `json:"defaultQuality"`
	DefaultDownloadType  string  `json:"defaultDownloadType"`
	FilenameTemplate     string  `json:"filenameTemplate"`
	IsPrivate            bool    `json:"isPrivate"`
	SeasonNumber         *int    `json:"seasonNumber"`
	Year                 *int    `json:"year"`
	SequenceMin          *int    `json:"sequenceMin"`
	SequenceMax          *int    `json:"sequenceMax"`
	ArtistID             *int64  `json:"artistId"`
	CoverImagePath       *string `json:"coverImagePath"`
	CoverImageSmallPath  *string `json:"coverImageSmallPath"`
	CoverImageMediumPath *string `json:"coverImageMediumPath"`
	BrowseAsShow         bool    `json:"browseAsShow"`
	ItemCount            int     `json:"itemCount"`
	// EffectiveIsPrivate and TotalItemCount account for inheritance down the
	// collection tree — IsPrivate/ItemCount above are this collection's own,
	// non-inherited flag and its own direct (non-rolled-up) item count,
	// which is what the tree UI and folder-view tiles want to show. These
	// two instead answer "does this collection (or an ancestor) mark it
	// private, and is there anything actually private under here at all" —
	// needed by the Library toolbar's reveal-all button, which otherwise
	// can't tell if there's any blurred content when a private *parent*
	// holds no items directly and its items live in unmarked children.
	EffectiveIsPrivate bool `json:"effectiveIsPrivate"`
	TotalItemCount     int  `json:"totalItemCount"`
	// GhostItemCount/TotalGhostItemCount are the ghost (no-file placeholder)
	// subset of ItemCount/TotalItemCount respectively — always <= their
	// counterpart, same direct-vs-rolled-up scoping.
	GhostItemCount      int `json:"ghostItemCount"`
	TotalGhostItemCount int `json:"totalGhostItemCount"`
	// SequenceGaps summarizes gaps in this collection's own items' sequence
	// numbers (same direct-only scope as ItemCount). Nil when there's
	// nothing to report — see LibraryRepo.SequenceGapsByCollection.
	SequenceGaps *SequenceGapResponse `json:"sequenceGaps"`
	// LatestItemThumbnailPath is the thumbnail of the most recently
	// downloaded item anywhere in this collection's subtree (rolled up the
	// same way TotalItemCount is) — Browse's fallback cover for a show/album
	// tile that has no explicit CoverImagePath set. Nil when the subtree has
	// no thumbnailed item at all.
	LatestItemThumbnailPath *string `json:"latestItemThumbnailPath"`
	JellyfinLibraryID       *string `json:"jellyfinLibraryId"`
	CreatedAt               string  `json:"createdAt"`
	UpdatedAt               string  `json:"updatedAt"`
}

type TagResponse struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	IsPrivate  bool   `json:"isPrivate"`
	CreatedAt  string `json:"createdAt"`
	UsageCount int    `json:"usageCount"`
}

type CreateTagRequest struct {
	Name      string `json:"name" binding:"required"`
	IsPrivate bool   `json:"isPrivate"`
}

type UpdateTagRequest struct {
	Name      string `json:"name" binding:"required"`
	IsPrivate bool   `json:"isPrivate"`
}

func toTagResponse(t models.TagWithCount) TagResponse {
	return TagResponse{
		ID:         t.ID,
		Name:       t.Name,
		IsPrivate:  t.IsPrivate,
		CreatedAt:  t.CreatedAt.Format(timeFormat),
		UsageCount: t.UsageCount,
	}
}

type ArtistResponse struct {
	ID                int64   `json:"id"`
	Name              string  `json:"name"`
	SelectedImagePath *string `json:"selectedImagePath"`
	// Birthday is a date-only string ("2006-01-02"), nil when unset.
	Birthday   *string `json:"birthday"`
	CreatedAt  string  `json:"createdAt"`
	UsageCount int     `json:"usageCount"`
}

type CreateArtistRequest struct {
	Name     string  `json:"name" binding:"required"`
	Birthday *string `json:"birthday"`
}

type UpdateArtistRequest struct {
	Name     string  `json:"name" binding:"required"`
	Birthday *string `json:"birthday"`
}

func toArtistResponse(a models.ArtistWithCount) ArtistResponse {
	return ArtistResponse{
		ID:                a.ID,
		Name:              a.Name,
		SelectedImagePath: a.SelectedImagePath,
		Birthday:          a.Birthday,
		CreatedAt:         a.CreatedAt.Format(timeFormat),
		UsageCount:        a.UsageCount,
	}
}

// ArtistImageResponse is one entry in an artist's image gallery.
type ArtistImageResponse struct {
	ID           int64  `json:"id"`
	RelativePath string `json:"relativePath"`
	CreatedAt    string `json:"createdAt"`
}

func toArtistImageResponse(img models.ArtistImage) ArtistImageResponse {
	return ArtistImageResponse{
		ID:           img.ID,
		RelativePath: img.RelativePath,
		CreatedAt:    img.CreatedAt.Format(timeFormat),
	}
}

// ArtistImageCandidateResponse is a suggested image the frontend can offer
// to copy into an artist's gallery — sourced from that artist's library
// items' thumbnails, not yet copied anywhere. RelPath is relative to
// MediaRoot, resolved into a URL client-side the same way LibraryItem
// thumbnails already are (via mediaFileUrl()).
type ArtistImageCandidateResponse struct {
	RelPath string `json:"relPath"`
}

// SetArtistImageRequest adds one image to an artist's gallery from exactly
// one of two sources: SourceRelPath copies an existing file already on disk
// under MediaRoot (e.g. a candidate from ThumbnailsByArtist), or
// ImageBase64+Filename is a fresh browser upload — mirrors
// SetLibraryThumbnailRequest's base64 pattern since this codebase has no
// multipart upload anywhere.
type SetArtistImageRequest struct {
	SourceRelPath *string `json:"sourceRelPath"`
	ImageBase64   *string `json:"imageBase64"`
	Filename      *string `json:"filename"`
}

// CollectionCoverCandidateResponse is a suggested cover image found by
// scanning the collection's own resolved folder, full depth.
type CollectionCoverCandidateResponse struct {
	RelPath string `json:"relPath"`
}

// SetCollectionCoverRequest sets a collection's cover from exactly one of
// two sources — same dual-mode shape as SetArtistImageRequest.
type SetCollectionCoverRequest struct {
	SourceRelPath *string `json:"sourceRelPath"`
	ImageBase64   *string `json:"imageBase64"`
	Filename      *string `json:"filename"`
}

type SettingsResponse struct {
	DownloadDirectory           string   `json:"downloadDirectory"`
	MaxConcurrentDownloads      int      `json:"maxConcurrentDownloads"`
	MaxConcurrentTranscodes     int      `json:"maxConcurrentTranscodes"`
	DownloadTimeoutMinutes      int      `json:"downloadTimeoutMinutes"`
	DefaultQuality              string   `json:"defaultQuality"`
	DefaultDownloadType         string   `json:"defaultDownloadType"`
	ImportIgnoredFolders        []string `json:"importIgnoredFolders"`
	HistoryAnonymizeURLs        bool     `json:"historyAnonymizeUrls"`
	HistoryRetentionDays        int      `json:"historyRetentionDays"`
	DownloadLogRetentionDays    int      `json:"downloadLogRetentionDays"`
	LibraryView                 string   `json:"libraryView"`
	LibrarySortKey              string   `json:"librarySortKey"`
	LibrarySortDir              string   `json:"librarySortDir"`
	LibraryMode                 string   `json:"libraryMode"`
	LibraryPaginationEnabled    bool     `json:"libraryPaginationEnabled"`
	LibraryPageSize             int      `json:"libraryPageSize"`
	ThumbnailFrameCount         int      `json:"thumbnailFrameCount"`
	PrivacyEnabled              bool     `json:"privacyEnabled"`
	PrivacyBlurStrength         string   `json:"privacyBlurStrength"`
	BrowseIgnorePrivacy         bool     `json:"browseIgnorePrivacy"`
	SkipDownloadPreview         bool     `json:"skipDownloadPreview"`
	JellyfinEnabled             bool     `json:"jellyfinEnabled"`
	JellyfinURL                 string   `json:"jellyfinUrl"`
	JellyfinAPIKey              string   `json:"jellyfinApiKey"`
	JellyfinRefreshMode         string   `json:"jellyfinRefreshMode"`
	LibraryAutoplay             bool     `json:"libraryAutoplay"`
	YtdlpCookiesBrowser         string   `json:"ytdlpCookiesBrowser"`
	YtdlpCookiesProfile         string   `json:"ytdlpCookiesProfile"`
	YtdlpProxy                  string   `json:"ytdlpProxy"`
	YtdlpRateLimit              string   `json:"ytdlpRateLimit"`
	YtdlpRetries                int      `json:"ytdlpRetries"`
	AutoBackupIntervalHours     int      `json:"autoBackupIntervalHours"`
	BackupRetentionCount        int      `json:"backupRetentionCount"`
	ResolutionTierMediumEnabled bool     `json:"resolutionTierMediumEnabled"`
	ResolutionThresholdLow      int      `json:"resolutionThresholdLow"`
	ResolutionThresholdHigh     int      `json:"resolutionThresholdHigh"`

	ThumbnailEnhancementEnabled         bool   `json:"thumbnailEnhancementEnabled"`
	ThumbnailEnhancementURL             string `json:"thumbnailEnhancementUrl"`
	ThumbnailEnhancementUsername        string `json:"thumbnailEnhancementUsername"`
	ThumbnailEnhancementPassword        string `json:"thumbnailEnhancementPassword"`
	ThumbnailEnhancementUpscaler        string `json:"thumbnailEnhancementUpscaler"`
	ThumbnailEnhancementMinDim          int    `json:"thumbnailEnhancementMinDim"`
	ThumbnailEnhancementFactor          int    `json:"thumbnailEnhancementFactor"`
	ThumbnailEnhancementTargetMode      string `json:"thumbnailEnhancementTargetMode"`
	ThumbnailEnhancementTargetDim       int    `json:"thumbnailEnhancementTargetDim"`
	ThumbnailEnhancementScheduleEnabled bool   `json:"thumbnailEnhancementScheduleEnabled"`
	ThumbnailEnhancementRetentionDays   int    `json:"thumbnailEnhancementRetentionDays"`
	ThumbnailEnhancementAutoApprove     bool   `json:"thumbnailEnhancementAutoApprove"`
	ThumbnailEnhancementAutoOnDownload  bool   `json:"thumbnailEnhancementAutoOnDownload"`
	ThumbnailEnhancementMaxPerSweep     int    `json:"thumbnailEnhancementMaxPerSweep"`
}

type UpdateSettingsRequest struct {
	MaxConcurrentDownloads      *int      `json:"maxConcurrentDownloads" binding:"omitempty,min=1"`
	MaxConcurrentTranscodes     *int      `json:"maxConcurrentTranscodes" binding:"omitempty,min=1"`
	DownloadTimeoutMinutes      *int      `json:"downloadTimeoutMinutes" binding:"omitempty,min=0"`
	DefaultQuality              *string   `json:"defaultQuality" binding:"omitempty,oneof=best 2160p 1440p 1080p 720p 480p 360p worst"`
	DefaultDownloadType         *string   `json:"defaultDownloadType" binding:"omitempty,oneof=video audio"`
	ImportIgnoredFolders        *[]string `json:"importIgnoredFolders"`
	HistoryAnonymizeURLs        *bool     `json:"historyAnonymizeUrls"`
	HistoryRetentionDays        *int      `json:"historyRetentionDays" binding:"omitempty,min=0"`
	DownloadLogRetentionDays    *int      `json:"downloadLogRetentionDays" binding:"omitempty,min=0"`
	LibraryView                 *string   `json:"libraryView" binding:"omitempty,oneof=grid folders list"`
	LibrarySortKey              *string   `json:"librarySortKey" binding:"omitempty,oneof=downloadedAt title filename year duration sequenceNumber seasonNumber"`
	LibrarySortDir              *string   `json:"librarySortDir" binding:"omitempty,oneof=asc desc"`
	LibraryMode                 *string   `json:"libraryMode" binding:"omitempty,oneof=manage details"`
	LibraryPaginationEnabled    *bool     `json:"libraryPaginationEnabled"`
	LibraryPageSize             *int      `json:"libraryPageSize" binding:"omitempty,min=1"`
	ThumbnailFrameCount         *int      `json:"thumbnailFrameCount" binding:"omitempty,oneof=2 4 6 8 12"`
	PrivacyEnabled              *bool     `json:"privacyEnabled"`
	PrivacyBlurStrength         *string   `json:"privacyBlurStrength" binding:"omitempty,oneof=weak default strong"`
	BrowseIgnorePrivacy         *bool     `json:"browseIgnorePrivacy"`
	SkipDownloadPreview         *bool     `json:"skipDownloadPreview"`
	JellyfinEnabled             *bool     `json:"jellyfinEnabled"`
	JellyfinURL                 *string   `json:"jellyfinUrl"`
	JellyfinAPIKey              *string   `json:"jellyfinApiKey"`
	JellyfinRefreshMode         *string   `json:"jellyfinRefreshMode" binding:"omitempty,oneof=entire specific none"`
	LibraryAutoplay             *bool     `json:"libraryAutoplay"`
	YtdlpCookiesBrowser         *string   `json:"ytdlpCookiesBrowser"`
	YtdlpCookiesProfile         *string   `json:"ytdlpCookiesProfile"`
	YtdlpProxy                  *string   `json:"ytdlpProxy"`
	YtdlpRateLimit              *string   `json:"ytdlpRateLimit"`
	YtdlpRetries                *int      `json:"ytdlpRetries" binding:"omitempty,min=0"`
	AutoBackupIntervalHours     *int      `json:"autoBackupIntervalHours" binding:"omitempty,oneof=0 6 12 24 72 168"`
	BackupRetentionCount        *int      `json:"backupRetentionCount" binding:"omitempty,min=0"`
	ResolutionTierMediumEnabled *bool     `json:"resolutionTierMediumEnabled"`
	ResolutionThresholdLow      *int      `json:"resolutionThresholdLow" binding:"omitempty,oneof=480 720 1080 1440 2160 4320"`
	ResolutionThresholdHigh     *int      `json:"resolutionThresholdHigh" binding:"omitempty,oneof=480 720 1080 1440 2160 4320"`

	ThumbnailEnhancementEnabled         *bool   `json:"thumbnailEnhancementEnabled"`
	ThumbnailEnhancementURL             *string `json:"thumbnailEnhancementUrl"`
	ThumbnailEnhancementUsername        *string `json:"thumbnailEnhancementUsername"`
	ThumbnailEnhancementPassword        *string `json:"thumbnailEnhancementPassword"`
	ThumbnailEnhancementUpscaler        *string `json:"thumbnailEnhancementUpscaler"`
	ThumbnailEnhancementMinDim          *int    `json:"thumbnailEnhancementMinDim" binding:"omitempty,min=1"`
	ThumbnailEnhancementFactor          *int    `json:"thumbnailEnhancementFactor" binding:"omitempty,min=1"`
	ThumbnailEnhancementTargetMode      *string `json:"thumbnailEnhancementTargetMode" binding:"omitempty,oneof=factor resolution"`
	ThumbnailEnhancementTargetDim       *int    `json:"thumbnailEnhancementTargetDim" binding:"omitempty,min=1"`
	ThumbnailEnhancementScheduleEnabled *bool   `json:"thumbnailEnhancementScheduleEnabled"`
	ThumbnailEnhancementRetentionDays   *int    `json:"thumbnailEnhancementRetentionDays" binding:"omitempty,min=0"`
	ThumbnailEnhancementAutoApprove     *bool   `json:"thumbnailEnhancementAutoApprove"`
	ThumbnailEnhancementAutoOnDownload  *bool   `json:"thumbnailEnhancementAutoOnDownload"`
	ThumbnailEnhancementMaxPerSweep     *int    `json:"thumbnailEnhancementMaxPerSweep" binding:"omitempty,min=1"`
}

func toCollectionResponse(c models.Collection, path string, itemCount int, effectiveIsPrivate bool, totalItemCount int, ghostItemCount int, totalGhostItemCount int, latestItemThumbnailPath *string, sequenceGap *SequenceGapResponse) CollectionResponse {
	return CollectionResponse{
		ID:                      c.ID,
		Name:                    c.Name,
		ParentID:                c.ParentID,
		RootPath:                c.RootPath,
		Path:                    path,
		DefaultQuality:          c.DefaultQuality,
		DefaultDownloadType:     c.DefaultDownloadType,
		FilenameTemplate:        c.FilenameTemplate,
		IsPrivate:               c.IsPrivate,
		SeasonNumber:            c.SeasonNumber,
		Year:                    c.Year,
		SequenceMin:             c.SequenceMin,
		SequenceMax:             c.SequenceMax,
		ArtistID:                c.ArtistID,
		CoverImagePath:          c.CoverImagePath,
		CoverImageSmallPath:     c.CoverImageSmallPath,
		CoverImageMediumPath:    c.CoverImageMediumPath,
		BrowseAsShow:            c.BrowseAsShow,
		ItemCount:               itemCount,
		EffectiveIsPrivate:      effectiveIsPrivate,
		TotalItemCount:          totalItemCount,
		GhostItemCount:          ghostItemCount,
		TotalGhostItemCount:     totalGhostItemCount,
		SequenceGaps:            sequenceGap,
		LatestItemThumbnailPath: latestItemThumbnailPath,
		JellyfinLibraryID:       c.JellyfinLibrary,
		CreatedAt:               c.CreatedAt.Format(timeFormat),
		UpdatedAt:               c.UpdatedAt.Format(timeFormat),
	}
}

// totalItemCounts sums each collection's own direct item count together
// with every descendant's, so an organizational parent collection (no items
// placed directly on it) still reports whether there's anything under it at
// all. Same memoized-recursion shape as effectivePrivacyMap/collectionPaths.
func totalItemCounts(cols []models.Collection, direct map[int64]int) map[int64]int {
	children := make(map[int64][]int64, len(cols))
	for _, c := range cols {
		if c.ParentID != nil {
			children[*c.ParentID] = append(children[*c.ParentID], c.ID)
		}
	}
	totals := make(map[int64]int, len(cols))
	var sum func(id int64) int
	sum = func(id int64) int {
		if v, ok := totals[id]; ok {
			return v
		}
		total := direct[id]
		for _, childID := range children[id] {
			total += sum(childID)
		}
		totals[id] = total
		return total
	}
	for _, c := range cols {
		sum(c.ID)
	}
	return totals
}

// rollupLatestThumbnails resolves, per collection, the thumbnail of the most
// recently downloaded item anywhere in its subtree — same memoized-recursion
// shape as totalItemCounts, but keeping whichever of "this collection's own
// direct latest" and "each child's already-rolled-up latest" has the newer
// DownloadedAt, rather than summing. A collection with no thumbnailed item
// anywhere under it (including itself) is simply absent from the result.
func rollupLatestThumbnails(cols []models.Collection, direct map[int64]repository.LatestThumbnail) map[int64]string {
	children := make(map[int64][]int64, len(cols))
	for _, c := range cols {
		if c.ParentID != nil {
			children[*c.ParentID] = append(children[*c.ParentID], c.ID)
		}
	}
	resolved := make(map[int64]*repository.LatestThumbnail, len(cols))
	var resolve func(id int64) *repository.LatestThumbnail
	resolve = func(id int64) *repository.LatestThumbnail {
		if v, ok := resolved[id]; ok {
			return v
		}
		var best *repository.LatestThumbnail
		if d, ok := direct[id]; ok {
			d := d
			best = &d
		}
		for _, childID := range children[id] {
			if childBest := resolve(childID); childBest != nil && (best == nil || childBest.DownloadedAt.After(best.DownloadedAt)) {
				best = childBest
			}
		}
		resolved[id] = best
		return best
	}
	out := make(map[int64]string, len(cols))
	for _, c := range cols {
		if best := resolve(c.ID); best != nil {
			out[c.ID] = best.Thumbnail
		}
	}
	return out
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

// CreateGhostLibraryItemRequest creates a library item with no file yet —
// see CreateGhostLibraryItem (ghost_handler.go). FetchThumbnail is only
// honored when OriginalURL is also set.
type CreateGhostLibraryItemRequest struct {
	Title          string   `json:"title" binding:"required"`
	MediaType      string   `json:"mediaType" binding:"required,oneof=video audio"`
	OriginalURL    *string  `json:"originalUrl"`
	CollectionID   *int64   `json:"collectionId"`
	ArtistID       *int64   `json:"artistId"`
	Year           *int     `json:"year"`
	SeasonNumber   *int     `json:"seasonNumber"`
	SequenceNumber *int     `json:"sequenceNumber"`
	GenerateNFO    bool     `json:"generateNfo"`
	Tags           []string `json:"tags"`
	FetchThumbnail bool     `json:"fetchThumbnail"`
}

type BackupExportRequest struct {
	Password *string `json:"password"` // empty/absent = unencrypted export
}

type BackupImportRequest struct {
	Data     string  `json:"data" binding:"required"` // raw text of a previously-exported file
	Password *string `json:"password"`
	// Mode is "download" (default, empty also means download) or
	// "ghostOnly" — ghostOnly recreates every library item as a ghost
	// placeholder instead of enqueueing a redownload for ones that have a
	// saved URL.
	Mode string `json:"mode,omitempty"`
}

// RestoreBackupRequest is the body for restoring a full backup already
// sitting in backup history (see RestoreFullBackup) — no Data/Password,
// since the file is read directly off disk and auto-backups are always
// unencrypted.
type RestoreBackupRequest struct {
	Mode string `json:"mode,omitempty"`
}

// BackupRestoreFullResponse reports what a full-backup restore did across
// both halves of the bundle it applied.
type BackupRestoreFullResponse struct {
	SettingsApplied int                        `json:"settingsApplied"`
	Library         BackupImportLibraryResponse `json:"library"`
}

// FullImportPreviewResponse previews an ad-hoc uploaded full-kind backup
// file before committing to ImportFullBackup — settings are summarized as a
// plain count (an import always overwrites every key, nothing to diff),
// while the library half reuses backup.PreviewLibraryBundle's existing
// new/duplicate diffing, serialized as-is (same pattern PreviewLibraryImport
// already uses for backup.LibraryBundlePreview).
type FullImportPreviewResponse struct {
	SettingsCount int                       `json:"settingsCount"`
	Library       backup.LibraryBundlePreview `json:"library"`
}

type BackupImportSettingsResponse struct {
	Applied int `json:"applied"`
}

type BackupImportLibraryResponse struct {
	CollectionsEnsured int `json:"collectionsEnsured"`
	TagsCreated        int `json:"tagsCreated"`
	ArtistsCreated     int `json:"artistsCreated"`
	DownloadsQueued    int `json:"downloadsQueued"`
	GhostsCreated      int `json:"ghostsCreated"`
}

type BackupHistoryResponse struct {
	ID                int64   `json:"id"`
	CreatedAt         string  `json:"createdAt"`
	TriggerType       string  `json:"triggerType"`
	Status            string  `json:"status"`
	FileName          *string `json:"fileName"`
	FileSizeBytes     *int64  `json:"fileSizeBytes"`
	LibraryItemsCount *int    `json:"libraryItemsCount"`
	CollectionsCount  *int    `json:"collectionsCount"`
	TagsCount         *int    `json:"tagsCount"`
	ArtistsCount      *int    `json:"artistsCount"`
	ErrorMessage      *string `json:"errorMessage"`
}

func toBackupHistoryResponse(b models.BackupHistory) BackupHistoryResponse {
	return BackupHistoryResponse{
		ID:                b.ID,
		CreatedAt:         b.CreatedAt.Format(timeFormat),
		TriggerType:       b.TriggerType,
		Status:            b.Status,
		FileName:          b.FileName,
		FileSizeBytes:     b.FileSizeBytes,
		LibraryItemsCount: b.LibraryItemsCount,
		CollectionsCount:  b.CollectionsCount,
		TagsCount:         b.TagsCount,
		ArtistsCount:      b.ArtistsCount,
		ErrorMessage:      b.ErrorMessage,
	}
}

// BackupContentPreviewResponse is a read-only, human-readable summary of
// what's inside a backup file — no isNew/alreadyInLibrary diffing like
// backup.LibraryBundlePreview, since this is just inspection, not a step
// before importing.
type BackupContentPreviewResponse struct {
	SettingsCount int                       `json:"settingsCount"`
	Collections   []BackupPreviewCollection `json:"collections"`
	Tags          []string                  `json:"tags"`
	Artists       []string                  `json:"artists"`
	Items         []BackupPreviewItem       `json:"items"`
}

type BackupPreviewCollection struct {
	Path []string `json:"path"`
	Name string   `json:"name"`
}

type BackupPreviewItem struct {
	Title          string   `json:"title"`
	OriginalURL    string   `json:"originalUrl"`
	CollectionPath []string `json:"collectionPath,omitempty"`
	ArtistName     string   `json:"artistName,omitempty"`
	Tags           []string `json:"tags,omitempty"`
	// IsGhost mirrors backup.PreviewLibraryItem.IsGhost — true means this
	// entry has no URL to redownload from, so a restore recreates it as a
	// placeholder rather than queuing anything.
	IsGhost bool `json:"isGhost,omitempty"`
}

type StatsResponse struct {
	ActiveDownloads   int `json:"activeDownloads"`
	QueuedDownloads   int `json:"queuedDownloads"`
	CompletedToday    int `json:"completedToday"`
	LibraryVideoCount int `json:"libraryVideoCount"`
	LibraryAudioCount int `json:"libraryAudioCount"`
	// Ghost (no-file placeholder) subset of the two counts above — always
	// <= their counterpart. Lets the dashboard split each bar/legend entry
	// by ghost vs real without a separate chart.
	LibraryVideoGhostCount int   `json:"libraryVideoGhostCount"`
	LibraryAudioGhostCount int   `json:"libraryAudioGhostCount"`
	TotalStorageBytes      int64 `json:"totalStorageBytes"`
	// DiskTotalBytes/DiskFreeBytes describe the filesystem underlying
	// MediaRoot, not the whole host — 0 if the disk-usage lookup failed
	// (unsupported filesystem, permissions, etc).
	DiskTotalBytes int64 `json:"diskTotalBytes"`
	DiskFreeBytes  int64 `json:"diskFreeBytes"`
}

// CreateSubscriptionRequest saves a channel/playlist URL to be periodically
// re-checked for new uploads — see CreateSubscription (subscriptions_handler.go).
// Title is resolved server-side from a metadata fetch, not taken from the
// request. CheckIntervalHours defaults to 6 when omitted/zero.
type CreateSubscriptionRequest struct {
	URL                string   `json:"url" binding:"required,url"`
	MediaType          string   `json:"mediaType" binding:"required,oneof=video audio"`
	CollectionID       *int64   `json:"collectionId"`
	Tags               []string `json:"tags"`
	AutoDownload       bool     `json:"autoDownload"`
	GenerateNFO        bool     `json:"generateNfo"`
	CheckIntervalHours int      `json:"checkIntervalHours"`
}

// UpdateSubscriptionRequest — URL/MediaType are immutable after creation
// (changing the source is really "delete and re-add"). Unlike
// UpdateSettingsRequest's per-field-independent PATCH, EditSubscriptionDialog
// is a single buffered-save form that always submits its full current
// state, so CollectionID/Tags apply as given (nil CollectionID means "no
// collection," same as MoveLibraryItemRequest) — only AutoDownload/
// GenerateNFO/CheckIntervalHours/Enabled are pointers, purely so the zero
// value can't be mistaken for "not sent" by a caller other than the one
// dialog this is built for.
type UpdateSubscriptionRequest struct {
	CollectionID       *int64   `json:"collectionId"`
	Tags               []string `json:"tags"`
	AutoDownload       *bool    `json:"autoDownload" binding:"required"`
	GenerateNFO        *bool    `json:"generateNfo" binding:"required"`
	CheckIntervalHours *int     `json:"checkIntervalHours" binding:"required"`
	Enabled            *bool    `json:"enabled" binding:"required"`
}

type SubscriptionResponse struct {
	ID                 int64    `json:"id"`
	URL                string   `json:"url"`
	Title              string   `json:"title"`
	MediaType          string   `json:"mediaType"`
	CollectionID       *int64   `json:"collectionId"`
	CollectionName     *string  `json:"collectionName"`
	Tags               []string `json:"tags"`
	AutoDownload       bool     `json:"autoDownload"`
	GenerateNFO        bool     `json:"generateNfo"`
	CheckIntervalHours int      `json:"checkIntervalHours"`
	Enabled            bool     `json:"enabled"`
	LastCheckedAt      *string  `json:"lastCheckedAt"`
	LastCheckError     *string  `json:"lastCheckError"`
	KnownEntryCount    int      `json:"knownEntryCount"`
	UnseenEntryCount   int      `json:"unseenEntryCount"`
	CreatedAt          string   `json:"createdAt"`
}

func toSubscriptionResponse(s models.Subscription, collectionName *string, knownEntryCount, unseenCount int) SubscriptionResponse {
	resp := SubscriptionResponse{
		ID:                 s.ID,
		URL:                s.URL,
		Title:              s.Title,
		MediaType:          s.MediaType,
		CollectionID:       s.CollectionID,
		CollectionName:     collectionName,
		Tags:               s.Tags,
		AutoDownload:       s.AutoDownload,
		GenerateNFO:        s.GenerateNFO,
		CheckIntervalHours: s.CheckIntervalHours,
		Enabled:            s.Enabled,
		LastCheckError:     s.LastCheckError,
		KnownEntryCount:    knownEntryCount,
		UnseenEntryCount:   unseenCount,
		CreatedAt:          s.CreatedAt.Format(time.RFC3339),
	}
	if s.LastCheckedAt != nil {
		t := s.LastCheckedAt.Format(time.RFC3339)
		resp.LastCheckedAt = &t
	}
	return resp
}

type CheckSubscriptionResponse struct {
	NewItemsFound int `json:"newItemsFound"`
}

// SubscriptionEntryResponse is one row of the "Known items" dialog — see
// ListSubscriptionEntries (subscriptions_handler.go). Entries recorded
// before migration 000033 have empty Title/URL and nil DurationSeconds.
type SubscriptionEntryResponse struct {
	SourceID        string   `json:"sourceId"`
	Title           string   `json:"title"`
	URL             string   `json:"url"`
	DurationSeconds *float64 `json:"durationSeconds"`
	LibraryItemID   *int64   `json:"libraryItemId"`
	SeenAt          *string  `json:"seenAt"`
	FirstSeenAt     string   `json:"firstSeenAt"`
}

func toSubscriptionEntryResponse(e models.SubscriptionSeenEntry) SubscriptionEntryResponse {
	resp := SubscriptionEntryResponse{
		SourceID:        e.SourceID,
		Title:           e.Title,
		URL:             e.URL,
		DurationSeconds: e.DurationSeconds,
		LibraryItemID:   e.LibraryItemID,
		FirstSeenAt:     e.FirstSeenAt.Format(time.RFC3339),
	}
	if e.SeenAt != nil {
		t := e.SeenAt.Format(time.RFC3339)
		resp.SeenAt = &t
	}
	return resp
}

// AddSubscriptionEntryRequest drives a single "Known items" row action —
// see AddSubscriptionEntry (subscriptions_handler.go).
type AddSubscriptionEntryRequest struct {
	Mode string `json:"mode" binding:"required,oneof=ghost download"`
}

type AddSubscriptionEntryResponse struct {
	Mode          string `json:"mode"`
	LibraryItemID *int64 `json:"libraryItemId,omitempty"`
	DownloadID    *int64 `json:"downloadId,omitempty"`
}

// ThumbnailEnhancementHistoryResponse is the camelCase mirror of
// models.ThumbnailEnhancementHistoryEntry — see thumbnailenhance_handler.go.
type ThumbnailEnhancementHistoryResponse struct {
	ID                int64   `json:"id"`
	LibraryItemID     *int64  `json:"libraryItemId"`
	ItemTitle         string  `json:"itemTitle"`
	Status            string  `json:"status"`
	OriginalWidth     *int    `json:"originalWidth"`
	OriginalHeight    *int    `json:"originalHeight"`
	EnhancedWidth     *int    `json:"enhancedWidth"`
	EnhancedHeight    *int    `json:"enhancedHeight"`
	OriginalSizeBytes *int64  `json:"originalSizeBytes"`
	EnhancedSizeBytes *int64  `json:"enhancedSizeBytes"`
	Error             *string `json:"error"`
	CreatedAt         string  `json:"createdAt"`
	// HasOriginalBackup/OriginalThumbnailPath/EnhancedThumbnailPath reflect
	// the item's *current* live state (whether a pre-enhancement backup
	// still exists), not this specific historical attempt — every row for
	// the same item shows the same values, and they change together once
	// the item is reverted or its backup explicitly deleted.
	HasOriginalBackup bool `json:"hasOriginalBackup"`
	// OriginalThumbnailPath is relative to ImagesRoot (servable via
	// /local-images/*) — the backup lives there, same convention as the
	// WebP derivative tiers.
	OriginalThumbnailPath *string `json:"originalThumbnailPath"`
	// EnhancedThumbnailPath is relative to MediaRoot (servable via
	// /media-files/*), unlike OriginalThumbnailPath above — it points at
	// the raw sidecar file, not a WebP tier, so Compare shows the
	// enhancement at its actual output resolution.
	EnhancedThumbnailPath *string `json:"enhancedThumbnailPath"`
	// RevertedAt is set once this specific row's enhancement was undone via
	// a later revert — unlike HasOriginalBackup above, this IS per-row
	// historical fact, not live item state. See models.ThumbnailEnhancementHistoryEntry.
	RevertedAt *string `json:"revertedAt"`
	// TriggerType is per-row historical fact — "manual" | "scheduled" | "auto".
	TriggerType string `json:"triggerType"`
}

func toThumbnailEnhancementHistoryResponse(e models.ThumbnailEnhancementHistoryEntry, hasBackup bool, originalPath, enhancedPath *string) ThumbnailEnhancementHistoryResponse {
	var revertedAt *string
	if e.RevertedAt != nil {
		s := e.RevertedAt.Format(time.RFC3339)
		revertedAt = &s
	}
	return ThumbnailEnhancementHistoryResponse{
		ID:                    e.ID,
		LibraryItemID:         e.LibraryItemID,
		ItemTitle:             e.ItemTitle,
		Status:                e.Status,
		OriginalWidth:         e.OriginalWidth,
		OriginalHeight:        e.OriginalHeight,
		EnhancedWidth:         e.EnhancedWidth,
		EnhancedHeight:        e.EnhancedHeight,
		OriginalSizeBytes:     e.OriginalSizeBytes,
		EnhancedSizeBytes:     e.EnhancedSizeBytes,
		Error:                 e.Error,
		CreatedAt:             e.CreatedAt.Format(time.RFC3339),
		HasOriginalBackup:     hasBackup,
		OriginalThumbnailPath: originalPath,
		EnhancedThumbnailPath: enhancedPath,
		RevertedAt:            revertedAt,
		TriggerType:           e.TriggerType,
	}
}

// ThumbnailEnhancementHistoryListResponse is the paginated wrapper for
// ListThumbnailEnhancementHistory — mirrors LibraryListResponse's
// {items,total} convention.
type ThumbnailEnhancementHistoryListResponse struct {
	Entries []ThumbnailEnhancementHistoryResponse `json:"entries"`
	Total   int                                   `json:"total"`
}

// RunThumbnailEnhancementResponse is returned immediately after "Enhance
// Now"/a bulk-select spawns its background run — Queued is how many items
// were handed off, not how many have finished yet (live progress arrives
// separately over the enhance_progress WebSocket event).
type RunThumbnailEnhancementResponse struct {
	Queued int `json:"queued"`
}

// EnhanceItemsRequest backs the bulk "Enhance Selected" endpoint.
type EnhanceItemsRequest struct {
	ItemIds []int64 `json:"itemIds" binding:"required,min=1"`
}

// BulkThumbnailOriginalsRequest backs the AI Enhancement page's bulk "Keep
// Enhanced"/"Keep Original" actions — a plain library-item-id list (the
// page dedupes selected history rows down to distinct library item ids
// before calling either).
type BulkThumbnailOriginalsRequest struct {
	ItemIds []int64 `json:"itemIds" binding:"required,min=1"`
}

// BulkThumbnailOriginalsResponse reports how many items were actually
// updated vs skipped (no backup — already committed/reverted, or never
// enhanced).
type BulkThumbnailOriginalsResponse struct {
	Updated int `json:"updated"`
	Skipped int `json:"skipped"`
}

// ThumbnailEnhancementEligibleItemResponse backs the "preview eligible
// items" dialog — a live snapshot of what the next "Enhance now" (or
// scheduled sweep) would consider, not a completed-attempt audit row like
// ThumbnailEnhancementHistoryResponse.
type ThumbnailEnhancementEligibleItemResponse struct {
	LibraryItemID int64   `json:"libraryItemId"`
	ItemTitle     string  `json:"itemTitle"`
	Width         int     `json:"width"`
	Height        int     `json:"height"`
	ArtistName    *string `json:"artistName"`
	CollectionName *string `json:"collectionName"`
	// RecentlyFailedAt (RFC3339) is set when this item's most recent
	// attempt failed within the last hour — automatic runs skip it, but it
	// still appears here so it stays manually retryable.
	RecentlyFailedAt *string `json:"recentlyFailedAt"`
}

func toThumbnailEnhancementEligibleItemResponse(e thumbnailenhance.EligibleItem) ThumbnailEnhancementEligibleItemResponse {
	var recentlyFailedAt *string
	if e.RecentlyFailedAt != nil {
		s := e.RecentlyFailedAt.Format(time.RFC3339)
		recentlyFailedAt = &s
	}
	return ThumbnailEnhancementEligibleItemResponse{
		LibraryItemID:     e.LibraryItemID,
		ItemTitle:         e.ItemTitle,
		Width:             e.Width,
		Height:            e.Height,
		ArtistName:        e.ArtistName,
		CollectionName:    e.CollectionName,
		RecentlyFailedAt:  recentlyFailedAt,
	}
}

// ThumbnailUpscalersResponse backs the Settings tab's "Load models" button —
// queried against whatever URL/credentials are currently typed in the form,
// not necessarily what's saved yet.
type ThumbnailUpscalersResponse struct {
	Upscalers []string `json:"upscalers"`
}

// ThumbnailEnhancementStatusResponse backs the AI Enhancement page's status
// badge. Configured is false whenever the feature is disabled or has no URL
// saved yet, in which case Reachable/Error are meaningless (both left
// zero-valued) — there's nothing to probe.
type ThumbnailEnhancementStatusResponse struct {
	Configured bool    `json:"configured"`
	Reachable  bool    `json:"reachable"`
	Error      *string `json:"error"`
}

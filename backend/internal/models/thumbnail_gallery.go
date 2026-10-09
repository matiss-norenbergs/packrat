package models

import "time"

// ThumbnailGalleryImage is one row of thumbnail_gallery — a frame or image
// a user explicitly saved for a library item without necessarily making it
// the active thumbnail. Rows cascade-delete with their library item (see
// migration 000042's ON DELETE CASCADE).
type ThumbnailGalleryImage struct {
	ID            int64
	LibraryItemID int64
	// ImagePath is relative to ImagesRoot, servable via /local-images/* —
	// same convention as frame_match_queue's FoundFramePath.
	ImagePath string
	Width     *int
	Height    *int
	// TimestampSeconds is the video position the frame was taken from, when
	// known (picker / frame-match saves); nil for older rows and for copies
	// of an existing thumbnail.
	TimestampSeconds *float64
	IsFavorite       bool
	CreatedAt        time.Time
}

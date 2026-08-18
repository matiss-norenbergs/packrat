package models

import "time"

// FrameMatchQueueItem is one row of frame_match_queue — a durable working
// queue for bulk-triggered frame matching (see api.BulkStartFrameMatch),
// reviewed on the "Frame Matching" page and deleted once the user accepts,
// discards, or dismisses it. Unlike thumbnail_enhancement_history this is
// not a permanent audit log: frame matching only ever changes an item's
// thumbnail on explicit accept, with no revert story to keep records around
// for, so once a row is resolved there's nothing left to keep.
type FrameMatchQueueItem struct {
	ID                 int64
	LibraryItemID      int64
	ItemTitle          string
	Mode               string // "url" | "current"
	State              string // "queued" | "running" | "done" | "error"
	TimestampSeconds   *float64
	Score              *float64
	// FoundFramePath and ReferenceImagePath are relative to ImagesRoot,
	// servable via /local-images/* — a snapshot of both images captured at
	// match-completion time (see framematch.persistQueueImages), not
	// re-derived at review time, so the displayed images always match the
	// score they were judged against even if the item's live thumbnail (or
	// the source URL) changes before the user gets around to reviewing it.
	FoundFramePath     *string
	ReferenceImagePath *string
	ErrorMsg           *string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

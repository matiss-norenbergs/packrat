package models

import "time"

// ThumbnailEnhancementHistoryEntry is one row of
// thumbnail_enhancement_history — one attempted item per row, success or
// failure, from a thumbnailenhance.RunOnce/RunDueEnhancements pass.
// ItemTitle is a denormalized snapshot (not just LibraryItemID) so a row
// still reads correctly if the library item is later deleted. The
// dimension/size fields are nil when the corresponding step never
// completed — e.g. a connection failure to the upscaler leaves
// Enhanced* nil but Original* populated.
type ThumbnailEnhancementHistoryEntry struct {
	ID                int64
	LibraryItemID     *int64
	ItemTitle         string
	Status            string // "success" | "failed"
	OriginalWidth     *int
	OriginalHeight    *int
	EnhancedWidth     *int
	EnhancedHeight    *int
	OriginalSizeBytes *int64
	EnhancedSizeBytes *int64
	Error             *string
	CreatedAt         time.Time
	// TriggerType records what caused this attempt — "manual" (RunOnce /
	// EnhanceItem), "scheduled" (RunDueEnhancements), or "auto"
	// (MaybeAutoEnhanceOnDownload) — surfaced as a badge column in the
	// history table, same pattern as models.BackupHistory.TriggerType.
	TriggerType string
	// Mode records what kind of operation this attempt was — "upscale" (the
	// original feature, gated on minDim eligibility, resizes per the
	// factor/target-size setting) or "sharpen" (denoise/detail pass only,
	// requested at factor 1.0 so the output stays the same size — manual-only,
	// never reachable from the scheduled sweep or auto-on-download). See
	// thumbnailenhance.enhanceOne's mode parameter.
	Mode string
	// RevertedAt is set once RevertOriginal undoes the enhancement this
	// row's backup cycle produced — nil for rows that were never reverted
	// (including ones from an earlier cycle later locked in via
	// DeleteOriginal, which are permanent and never get marked). See
	// thumbnailenhance.RevertOriginal / ThumbnailEnhancementHistoryRepo.MarkReverted.
	RevertedAt *time.Time
}

// ThumbnailEnhancementOriginal is one row of thumbnail_enhancement_originals
// — the pre-enhancement backup pointer for a library item. LibraryItemID is
// the primary key, so there's exactly one per item: the true original,
// preserved even if the item is enhanced again later (see
// thumbnailenhance.backupOriginalIfAbsent). OriginalPath is relative to
// ImagesRoot, servable via /local-images/*.
type ThumbnailEnhancementOriginal struct {
	LibraryItemID int64
	OriginalPath  string
	CreatedAt     time.Time
}

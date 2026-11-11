package models

// MaxSequenceValue is the largest accepted season number, sequence number, and
// collection sequenceMin / sequenceMax. One limit for all of them (the API
// answers 400 above it, and for negatives; 0 keeps its per-field meaning —
// "clear" on edits). It exists so a mistyped bound can't make the collections
// list do work proportional to the number typed; stored values beyond it (from
// before the limit) are still handled safely by the repository.
const MaxSequenceValue = 1_000_000

// MaxConcurrentDownloadsLimit is the largest "Max concurrent downloads": one
// worker goroutine (and one yt-dlp process) per slot, so an unbounded value
// from a typo or a restored file would start that many. The minimum is 1.
// PATCH /api/settings answers 400 above it; a settings import / backup restore
// clamps to it (a restore must not fail halfway); the worker pool never grows
// past it whatever the caller asks.
const MaxConcurrentDownloadsLimit = 16

// ClampConcurrentDownloads returns n limited to MaxConcurrentDownloadsLimit.
func ClampConcurrentDownloads(n int) int {
	if n > MaxConcurrentDownloadsLimit {
		return MaxConcurrentDownloadsLimit
	}
	return n
}

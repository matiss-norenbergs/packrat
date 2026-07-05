package models

import "time"

// History is a permanent, append-only record of every download that ever
// ran (completed, failed, cancelled, or interrupted by a crash/restart) — it
// survives even after its originating downloads row is deleted, since
// history.download_id is ON DELETE SET NULL rather than CASCADE.
type History struct {
	ID           int64
	DownloadID   *int64
	URL          string
	Status       string
	ErrorMessage *string
	CreatedAt    time.Time

	// Title/Thumbnail are denormalized via List's LEFT JOIN against
	// downloads — nil whenever the originating download row no longer
	// exists or never got that far (e.g. failed before metadata fetch).
	Title     *string
	Thumbnail *string
}

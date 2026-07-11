package models

import "time"

type Artist struct {
	ID        int64
	Name      string
	CreatedAt time.Time
}

// ArtistWithCount is Artist plus how many library items currently have it —
// used by the Artists management page's list view.
type ArtistWithCount struct {
	ID         int64
	Name       string
	CreatedAt  time.Time
	UsageCount int
}

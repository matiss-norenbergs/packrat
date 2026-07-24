package models

import "time"

type Artist struct {
	ID                int64
	Name              string
	SelectedImagePath *string
	CreatedAt         time.Time
}

// ArtistWithCount is Artist plus how many library items currently have it —
// used by the Artists management page's list view.
type ArtistWithCount struct {
	ID                int64
	Name              string
	SelectedImagePath *string
	CreatedAt         time.Time
	UsageCount        int
}

// ArtistImage is one gallery image belonging to an artist — either copied in
// from a library item's thumbnail or uploaded directly. Artist.SelectedImagePath
// points at the relative_path of whichever one (if any) is currently chosen
// as the artist's display picture; deleting the selected image clears that
// pointer but leaves the rest of the gallery untouched.
type ArtistImage struct {
	ID           int64
	ArtistID     int64
	RelativePath string
	CreatedAt    time.Time
}

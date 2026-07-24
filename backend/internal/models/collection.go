package models

import "time"

type Collection struct {
	ID                  int64
	Name                string
	ParentID            *int64
	RootPath            string
	DefaultQuality      string
	DefaultDownloadType string
	FilenameTemplate    string
	JellyfinLibrary     *string
	IsPrivate           bool
	SeasonNumber        *int
	ArtistID            *int64
	CoverImagePath      *string
	BrowseAsShow        bool
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

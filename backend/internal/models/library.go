package models

import "time"

type LibraryItem struct {
	ID                  int64
	DownloadID          *int64
	Title               string
	Filename            string
	Path                string // relative to MediaRoot
	CollectionID        *int64
	CollectionName      *string
	Folder              string
	OriginalURL         *string
	VideoID             *string
	Uploader            *string
	Duration            *int
	Resolution          *string
	// MediaType is "video" or "audio" — explicit rather than inferred, since
	// a ghost item (no file, no linked download) has neither of the signals
	// (Resolution, the linked download's own type) real items are otherwise
	// inferred from.
	MediaType           *string
	Thumbnail           *string
	ThumbnailSmallPath  *string // WebP derivative, relative to ImagesRoot
	ThumbnailMediumPath *string // WebP derivative, relative to ImagesRoot
	Description         *string
	ArtistID            *int64
	ArtistName          *string
	ReleaseYear         *int
	SequenceNumber      *int
	SeasonNumber        *int
	GenerateNFO         bool
	DownloadedAt        time.Time
	Status              string
	FileSizeBytes       *int64
	// PlaybackPositionSeconds/LastWatchedAt back the Browse page's "Continue
	// Watching" row — nil means never played (or played to completion and
	// cleared). Only meaningful for video; music playback never sets these.
	PlaybackPositionSeconds *int
	LastWatchedAt           *time.Time
}

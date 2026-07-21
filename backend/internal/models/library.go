package models

import "time"

type LibraryItem struct {
	ID             int64
	DownloadID     *int64
	Title          string
	Filename       string
	Path           string // relative to MediaRoot
	CollectionID   *int64
	CollectionName *string
	Folder         string
	OriginalURL    *string
	VideoID        *string
	Uploader       *string
	Duration       *int
	Resolution     *string
	Thumbnail      *string
	Description    *string
	ArtistID       *int64
	ArtistName     *string
	ReleaseYear    *int
	SequenceNumber *int
	SeasonNumber   *int
	GenerateNFO    bool
	DownloadedAt   time.Time
	Status         string
	FileSizeBytes  *int64
	// PlaybackPositionSeconds/LastWatchedAt back the Browse page's "Continue
	// Watching" row — nil means never played (or played to completion and
	// cleared). Only meaningful for video; music playback never sets these.
	PlaybackPositionSeconds *int
	LastWatchedAt           *time.Time
}

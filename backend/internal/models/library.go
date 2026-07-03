package models

import "time"

type LibraryItem struct {
	ID            int64
	DownloadID    *int64
	Title         string
	Filename      string
	Path          string // relative to MediaRoot
	CollectionID  *int64
	Folder        string
	OriginalURL   string
	VideoID       *string
	Uploader      *string
	Duration      *int
	Resolution    *string
	Thumbnail     *string
	Description   *string
	DownloadedAt  time.Time
	Status        string
	FileSizeBytes *int64
}

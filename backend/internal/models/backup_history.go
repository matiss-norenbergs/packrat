package models

import "time"

// BackupHistory is one attempted auto/manual backup run — recorded whether
// it succeeded or failed, so the Backup page's history table doubles as an
// at-a-glance health check.
type BackupHistory struct {
	ID                int64
	CreatedAt         time.Time
	TriggerType       string // "manual" | "scheduled"
	Status            string // "success" | "failed"
	FileName          *string
	FileSizeBytes     *int64
	LibraryItemsCount *int
	CollectionsCount  *int
	TagsCount         *int
	ArtistsCount      *int
	ErrorMessage      *string
}

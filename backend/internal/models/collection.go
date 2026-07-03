package models

import "time"

type Collection struct {
	ID                  int64
	Name                string
	RootPath            string
	DefaultQuality      string
	DefaultDownloadType string
	FilenameTemplate    string
	JellyfinLibrary     *string
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

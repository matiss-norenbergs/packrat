package models

import "time"

type Tag struct {
	ID        int64
	Name      string
	CreatedAt time.Time
}

// TagWithCount is Tag plus how many library items currently have it — used
// by the Tags management page's list view.
type TagWithCount struct {
	ID         int64
	Name       string
	CreatedAt  time.Time
	UsageCount int
}

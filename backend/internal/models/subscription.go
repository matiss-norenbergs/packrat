package models

import "time"

// Subscription is a saved channel/playlist URL that gets periodically
// re-checked for new uploads (see internal/subscriptions.RunDueChecks).
// New entries either become ghost library items for manual review or, if
// AutoDownload is set, go straight into the download queue — either way,
// CollectionID/Tags/GenerateNFO are applied to whatever gets created, the
// same way they would be if the user pasted the URL in by hand.
type Subscription struct {
	ID                 int64
	URL                string
	Title              string
	MediaType          string
	CollectionID       *int64
	Tags               []string
	AutoDownload       bool
	GenerateNFO        bool
	CheckIntervalHours int
	Enabled            bool
	LastCheckedAt      *time.Time
	LastCheckError     *string
	CreatedAt          time.Time
}

// SubscriptionSeenEntry is one row of subscription_seen_entries — every
// video/entry a subscription has ever encountered, whether or not it ended
// up creating a ghost item or download. Title/URL/DurationSeconds are only
// populated for entries recorded after migration 000033; earlier rows have
// them blank. SeenAt is nil until the user dismisses the entry (or acts on
// it) in the "Known items" dialog — migration 000035 backfills it to
// FirstSeenAt for every pre-existing row so old entries don't suddenly show
// up as unseen.
type SubscriptionSeenEntry struct {
	SourceID        string
	Title           string
	URL             string
	DurationSeconds *float64
	LibraryItemID   *int64
	SeenAt          *time.Time
	FirstSeenAt     time.Time
}

package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"packrat/backend/internal/models"
)

type SubscriptionsRepo struct {
	db *sql.DB
}

func NewSubscriptionsRepo(db *sql.DB) *SubscriptionsRepo {
	return &SubscriptionsRepo{db: db}
}

const subscriptionSelectColumns = `
	SELECT id, url, title, media_type, collection_id, tags, auto_download,
		generate_nfo, check_interval_hours, enabled, last_checked_at, last_check_error, created_at
	FROM subscriptions`

func scanSubscription(row rowScanner) (*models.Subscription, error) {
	var s models.Subscription
	var tags string
	var lastCheckedAt sql.NullString
	var createdAt string

	err := row.Scan(
		&s.ID, &s.URL, &s.Title, &s.MediaType, &s.CollectionID, &tags, &s.AutoDownload,
		&s.GenerateNFO, &s.CheckIntervalHours, &s.Enabled, &lastCheckedAt, &s.LastCheckError, &createdAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, err
		}
		return nil, fmt.Errorf("scanning subscription: %w", err)
	}

	s.Tags = decodeSubscriptionTags(tags)

	if lastCheckedAt.Valid {
		t, err := parseSQLiteTime(lastCheckedAt.String)
		if err != nil {
			return nil, err
		}
		s.LastCheckedAt = &t
	}

	s.CreatedAt, err = parseSQLiteTime(createdAt)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// decodeSubscriptionTags/encodeSubscriptionTags store a subscription's tag
// template as a single comma-joined column rather than a library_tags-style
// join table — these tags are never queried or filtered on, only copied
// onto whatever ghost item or download a check creates, so the extra
// machinery TagsRepo needs (usage counts, rename cascades) doesn't apply.
func decodeSubscriptionTags(raw string) []string {
	if raw == "" {
		return []string{}
	}
	return strings.Split(raw, ",")
}

func encodeSubscriptionTags(tags []string) string {
	return strings.Join(tags, ",")
}

// Create inserts a new subscription and returns its id. Tags/CollectionID
// are exactly what's persisted — the caller (CreateSubscription handler) is
// responsible for resolving Title from a metadata fetch before calling this.
func (r *SubscriptionsRepo) Create(ctx context.Context, s *models.Subscription) (int64, error) {
	res, err := r.db.ExecContext(ctx, `
		INSERT INTO subscriptions (
			url, title, media_type, collection_id, tags, auto_download,
			generate_nfo, check_interval_hours, enabled
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		s.URL, s.Title, s.MediaType, s.CollectionID, encodeSubscriptionTags(s.Tags), s.AutoDownload,
		s.GenerateNFO, s.CheckIntervalHours, s.Enabled,
	)
	if err != nil {
		return 0, fmt.Errorf("inserting subscription: %w", err)
	}
	return res.LastInsertId()
}

func (r *SubscriptionsRepo) Get(ctx context.Context, id int64) (*models.Subscription, error) {
	row := r.db.QueryRowContext(ctx, subscriptionSelectColumns+` WHERE id = ?`, id)
	s, err := scanSubscription(row)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return s, err
}

// List returns every subscription, most recently created first. Callers
// that only care about due/enabled ones (RunDueChecks) filter in Go, same
// as backup.RunScheduledBackupIfDue's own due-check — keeps the "is this
// due" logic in one place (time.Since) instead of duplicating it in SQL.
func (r *SubscriptionsRepo) List(ctx context.Context) ([]models.Subscription, error) {
	rows, err := r.db.QueryContext(ctx, subscriptionSelectColumns+` ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("listing subscriptions: %w", err)
	}
	defer rows.Close()

	var out []models.Subscription
	for rows.Next() {
		s, err := scanSubscription(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

// Update applies every field on s (a full-row replace, not a partial
// patch) — the handler is responsible for merging in only the fields the
// request actually set before calling this, the same pattern
// UpdateSettings uses at the DTO layer rather than here.
func (r *SubscriptionsRepo) Update(ctx context.Context, s *models.Subscription) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE subscriptions SET
			collection_id = ?, tags = ?, auto_download = ?, generate_nfo = ?,
			check_interval_hours = ?, enabled = ?
		WHERE id = ?`,
		s.CollectionID, encodeSubscriptionTags(s.Tags), s.AutoDownload, s.GenerateNFO,
		s.CheckIntervalHours, s.Enabled, s.ID,
	)
	if err != nil {
		return fmt.Errorf("updating subscription: %w", err)
	}
	return checkRowsAffected(res)
}

func (r *SubscriptionsRepo) Delete(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM subscriptions WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("deleting subscription: %w", err)
	}
	return checkRowsAffected(res)
}

// MarkChecked records that id was just checked and, via checkError, whether
// that check succeeded — nil clears any prior error, a non-nil message
// (e.g. from a dead/private URL) is what the "Last checked" column's
// warning badge surfaces.
func (r *SubscriptionsRepo) MarkChecked(ctx context.Context, id int64, checkedAt time.Time, checkError *string) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE subscriptions SET last_checked_at = ?, last_check_error = ? WHERE id = ?`,
		checkedAt.UTC().Format("2006-01-02 15:04:05"), checkError, id,
	)
	if err != nil {
		return fmt.Errorf("marking subscription checked: %w", err)
	}
	return checkRowsAffected(res)
}

// HasSeenEntries batch-checks which of sourceIDs are already recorded for
// subscriptionID, so a check only needs one query regardless of how many
// entries a channel/playlist listing returned.
func (r *SubscriptionsRepo) HasSeenEntries(ctx context.Context, subscriptionID int64, sourceIDs []string) (map[string]bool, error) {
	out := make(map[string]bool, len(sourceIDs))
	if len(sourceIDs) == 0 {
		return out, nil
	}

	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(sourceIDs)), ",")
	args := make([]any, 0, len(sourceIDs)+1)
	args = append(args, subscriptionID)
	for _, id := range sourceIDs {
		args = append(args, id)
	}

	rows, err := r.db.QueryContext(ctx,
		`SELECT source_id FROM subscription_seen_entries WHERE subscription_id = ? AND source_id IN (`+placeholders+`)`,
		args...,
	)
	if err != nil {
		return nil, fmt.Errorf("checking seen subscription entries: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var sourceID string
		if err := rows.Scan(&sourceID); err != nil {
			return nil, fmt.Errorf("scanning seen subscription entry: %w", err)
		}
		out[sourceID] = true
	}
	return out, rows.Err()
}

// RecordSeenEntry marks sourceID as seen for subscriptionID — libraryItemID
// is set when the entry became a ghost item (nil for the auto-download
// path, where no library row exists yet at check time). title/url/duration
// are stored purely for display (the "Known items" dialog) and play no part
// in the seen/unseen dedup logic, which is keyed on source_id alone.
func (r *SubscriptionsRepo) RecordSeenEntry(ctx context.Context, subscriptionID int64, sourceID, title, url string, duration float64, libraryItemID *int64) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO subscription_seen_entries (subscription_id, source_id, title, source_url, duration_seconds, library_item_id) VALUES (?, ?, ?, ?, ?, ?)`,
		subscriptionID, sourceID, title, url, duration, libraryItemID,
	)
	if err != nil {
		return fmt.Errorf("recording seen subscription entry: %w", err)
	}
	return nil
}

// ListSeenEntries returns every entry ever recorded for subscriptionID,
// most recently seen first — the "Known items" dialog's data source.
func (r *SubscriptionsRepo) ListSeenEntries(ctx context.Context, subscriptionID int64) ([]models.SubscriptionSeenEntry, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT source_id, title, source_url, duration_seconds, library_item_id, seen_at, first_seen_at
			FROM subscription_seen_entries WHERE subscription_id = ? ORDER BY first_seen_at DESC`,
		subscriptionID,
	)
	if err != nil {
		return nil, fmt.Errorf("listing seen subscription entries: %w", err)
	}
	defer rows.Close()

	var out []models.SubscriptionSeenEntry
	for rows.Next() {
		e, err := scanSeenEntry(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *e)
	}
	return out, rows.Err()
}

// GetSeenEntry loads a single seen entry — used by AddSubscriptionEntry to
// resolve the one row it's acting on.
func (r *SubscriptionsRepo) GetSeenEntry(ctx context.Context, subscriptionID int64, sourceID string) (*models.SubscriptionSeenEntry, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT source_id, title, source_url, duration_seconds, library_item_id, seen_at, first_seen_at
			FROM subscription_seen_entries WHERE subscription_id = ? AND source_id = ?`,
		subscriptionID, sourceID,
	)
	e, err := scanSeenEntry(row)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return e, err
}

func scanSeenEntry(row rowScanner) (*models.SubscriptionSeenEntry, error) {
	var e models.SubscriptionSeenEntry
	var seenAt sql.NullString
	var firstSeenAt string
	err := row.Scan(&e.SourceID, &e.Title, &e.URL, &e.DurationSeconds, &e.LibraryItemID, &seenAt, &firstSeenAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, err
		}
		return nil, fmt.Errorf("scanning seen subscription entry: %w", err)
	}

	if seenAt.Valid {
		t, err := parseSQLiteTime(seenAt.String)
		if err != nil {
			return nil, err
		}
		e.SeenAt = &t
	}

	e.FirstSeenAt, err = parseSQLiteTime(firstSeenAt)
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// SetSeenEntryLibraryItemID links a seen entry to the library row it
// produced — called both by a normal check's ghost path (via
// RecordSeenEntry's libraryItemID at insert time) and, for entries added
// later through the "Known items" dialog, as a follow-up UPDATE once the
// ghost item has been created.
func (r *SubscriptionsRepo) SetSeenEntryLibraryItemID(ctx context.Context, subscriptionID int64, sourceID string, libraryItemID int64) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE subscription_seen_entries SET library_item_id = ? WHERE subscription_id = ? AND source_id = ?`,
		libraryItemID, subscriptionID, sourceID,
	)
	if err != nil {
		return fmt.Errorf("linking seen subscription entry to library item: %w", err)
	}
	return checkRowsAffected(res)
}

// CountSeenEntries returns how many entries have been recorded for
// subscriptionID — the "N known videos" figure ListSubscriptions shows.
func (r *SubscriptionsRepo) CountSeenEntries(ctx context.Context, subscriptionID int64) (int, error) {
	var count int
	err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM subscription_seen_entries WHERE subscription_id = ?`, subscriptionID,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("counting seen subscription entries: %w", err)
	}
	return count, nil
}

// CountUnseenEntries returns how many of subscriptionID's entries have
// never been dismissed (seen_at IS NULL) — the "+N new" figure the
// Subscriptions table and Known Items dialog both show.
func (r *SubscriptionsRepo) CountUnseenEntries(ctx context.Context, subscriptionID int64) (int, error) {
	var count int
	err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM subscription_seen_entries WHERE subscription_id = ? AND seen_at IS NULL`, subscriptionID,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("counting unseen subscription entries: %w", err)
	}
	return count, nil
}

// MarkSeenEntry dismisses a single entry — called both by the Known Items
// dialog's own "Mark seen" button and, implicitly, whenever the user acts
// on an entry via "Add as ghost"/"Queue download" (see AddKnownEntryAsGhost/
// AddKnownEntryAsDownload) since acting on it is itself proof it's been
// seen.
func (r *SubscriptionsRepo) MarkSeenEntry(ctx context.Context, subscriptionID int64, sourceID string) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE subscription_seen_entries SET seen_at = ? WHERE subscription_id = ? AND source_id = ?`,
		time.Now().UTC().Format("2006-01-02 15:04:05"), subscriptionID, sourceID,
	)
	if err != nil {
		return fmt.Errorf("marking subscription entry seen: %w", err)
	}
	return checkRowsAffected(res)
}

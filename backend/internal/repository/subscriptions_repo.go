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

// SetLastCheckError records (or clears) the last check's error text WITHOUT
// touching last_checked_at. A subscription that was never baselined
// (last_checked_at NULL) uses it when its fetch fails, so it stays
// "never baselined" and its next check baselines it instead of treating the
// whole back catalog as new.
func (r *SubscriptionsRepo) SetLastCheckError(ctx context.Context, id int64, checkError *string) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE subscriptions SET last_check_error = ? WHERE id = ?`, checkError, id,
	)
	if err != nil {
		return fmt.Errorf("recording subscription check error: %w", err)
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

	err := inChunks(sourceIDs, inChunkSize, func(chunk []string) error {
		args := append([]any{subscriptionID}, anySlice(chunk)...)
		rows, err := r.db.QueryContext(ctx,
			`SELECT source_id FROM subscription_seen_entries WHERE subscription_id = ? AND source_id IN (`+placeholderList(len(chunk))+`)`,
			args...,
		)
		if err != nil {
			return fmt.Errorf("checking seen subscription entries: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var sourceID string
			if err := rows.Scan(&sourceID); err != nil {
				return fmt.Errorf("scanning seen subscription entry: %w", err)
			}
			out[sourceID] = true
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
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

// ClaimSeenEntry atomically records sourceID as seen for subscriptionID and
// reports whether THIS call inserted the row. It is the first half of the
// claim-then-act flow in subscriptions.processEntries: only the caller that
// gets inserted=true performs the ghost/download action for the entry, so
// two overlapping checks (or a playlist listing an id twice) can never both
// act on it. The UNIQUE (subscription_id, source_id) constraint from
// migration 000032 is what makes the INSERT OR IGNORE a race-free claim.
func (r *SubscriptionsRepo) ClaimSeenEntry(ctx context.Context, subscriptionID int64, sourceID, title, url string, duration float64) (bool, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO subscription_seen_entries (subscription_id, source_id, title, source_url, duration_seconds) VALUES (?, ?, ?, ?, ?)`,
		subscriptionID, sourceID, title, url, duration,
	)
	if err != nil {
		return false, fmt.Errorf("claiming seen subscription entry: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("claiming seen subscription entry: %w", err)
	}
	return n == 1, nil
}

// ReleaseSeenEntryClaim deletes a claimed seen row, but only while it has no
// library_item_id — a row that was successfully linked is never removed. It
// undoes ClaimSeenEntry when the action never ran because the context was
// cancelled, so the next check treats the entry as new again. Reports
// whether a row was deleted.
func (r *SubscriptionsRepo) ReleaseSeenEntryClaim(ctx context.Context, subscriptionID int64, sourceID string) (bool, error) {
	res, err := r.db.ExecContext(ctx,
		`DELETE FROM subscription_seen_entries WHERE subscription_id = ? AND source_id = ? AND library_item_id IS NULL`,
		subscriptionID, sourceID,
	)
	if err != nil {
		return false, fmt.Errorf("releasing seen subscription entry claim: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// SeenEntryInput is one entry to record in bulk (baselining).
type SeenEntryInput struct {
	SourceID string
	Title    string
	URL      string
	Duration float64
}

const insertSeenEntrySQL = `INSERT INTO subscription_seen_entries (subscription_id, source_id, title, source_url, duration_seconds) VALUES (?, ?, ?, ?, ?)`

// CreateWithSeenEntries inserts the subscription, records every entry as seen
// and stamps last_checked_at in ONE transaction: either everything persists
// or nothing does, so an interrupted baseline can never leave a subscription
// whose back catalog looks new. Entries must have unique SourceIDs (a
// duplicate fails the whole transaction). No repo mutex is taken inside the
// transaction (see the lock-order rule in docs/architecture.md).
func (r *SubscriptionsRepo) CreateWithSeenEntries(ctx context.Context, s *models.Subscription, entries []SeenEntryInput, checkedAt time.Time) (int64, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("starting subscription transaction: %w", err)
	}
	defer tx.Rollback()

	res, err := tx.ExecContext(ctx, `
		INSERT INTO subscriptions (
			url, title, media_type, collection_id, tags, auto_download,
			generate_nfo, check_interval_hours, enabled, last_checked_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		s.URL, s.Title, s.MediaType, s.CollectionID, encodeSubscriptionTags(s.Tags), s.AutoDownload,
		s.GenerateNFO, s.CheckIntervalHours, s.Enabled, checkedAt.UTC().Format("2006-01-02 15:04:05"),
	)
	if err != nil {
		return 0, fmt.Errorf("inserting subscription: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	if err := insertSeenEntries(ctx, tx, id, entries, insertSeenEntrySQL); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("committing subscription: %w", err)
	}
	return id, nil
}

// RecordSeenEntries bulk-records entries as seen for an existing
// subscription in one transaction, skipping any already recorded, and stamps
// last_checked_at (clearing any last error) in the same transaction. Used to
// baseline a subscription that was never baselined.
func (r *SubscriptionsRepo) RecordSeenEntries(ctx context.Context, subscriptionID int64, entries []SeenEntryInput, checkedAt time.Time) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("starting baseline transaction: %w", err)
	}
	defer tx.Rollback()

	ignoring := strings.Replace(insertSeenEntrySQL, "INSERT INTO", "INSERT OR IGNORE INTO", 1)
	if err := insertSeenEntries(ctx, tx, subscriptionID, entries, ignoring); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx,
		`UPDATE subscriptions SET last_checked_at = ?, last_check_error = NULL WHERE id = ?`,
		checkedAt.UTC().Format("2006-01-02 15:04:05"), subscriptionID,
	)
	if err != nil {
		return fmt.Errorf("marking subscription checked: %w", err)
	}
	if err := checkRowsAffected(res); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("committing baseline: %w", err)
	}
	return nil
}

func insertSeenEntries(ctx context.Context, tx *sql.Tx, subscriptionID int64, entries []SeenEntryInput, query string) error {
	stmt, err := tx.PrepareContext(ctx, query)
	if err != nil {
		return fmt.Errorf("preparing seen-entry insert: %w", err)
	}
	defer stmt.Close()
	for _, e := range entries {
		if _, err := stmt.ExecContext(ctx, subscriptionID, e.SourceID, e.Title, e.URL, e.Duration); err != nil {
			return fmt.Errorf("recording seen subscription entry %q: %w", e.SourceID, err)
		}
	}
	return nil
}

// ListSeenEntries returns every entry ever recorded for subscriptionID,
// most recently seen first — the "Known items" dialog's data source.
// first_seen_at alone is a weak sort key: every entry recorded by the same
// check (most commonly an entire baseline, all inserted within the same
// second) shares the exact same value, which would otherwise leave their
// relative order to SQLite's undefined tie-break behavior. `id DESC` (the
// row's own insertion order) breaks ties deterministically — there's no
// real per-video upload date available here at all (see
// subscriptions.EntriesFromMetadata: flat-playlist listings never populate
// one, and fetching it for real would mean a full per-video request instead
// of one request for the whole playlist).
func (r *SubscriptionsRepo) ListSeenEntries(ctx context.Context, subscriptionID int64) ([]models.SubscriptionSeenEntry, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT source_id, title, source_url, duration_seconds, library_item_id, seen_at, first_seen_at
			FROM subscription_seen_entries WHERE subscription_id = ? ORDER BY first_seen_at DESC, id DESC`,
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

// SetSeenEntryLibraryItemID links a seen entry to a library item — called
// by a normal check's ghost path (via RecordSeenEntry's libraryItemID at
// insert time), as a follow-up UPDATE once the "Known items" dialog's own
// ghost-creation action succeeds, and by the manual "Link to library
// item…" action, which points an entry at an *existing*, arbitrary library
// item — useful when the same video was actually downloaded through a
// different source/URL than the one this subscription tracks, so the
// automatic URL/video-id match (LibraryRepo.FindDuplicates) could never
// have found it on its own.
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

// UnlinkSeenEntry dissolves a seen entry's association with a library item
// — the manual counterpart to SetSeenEntryLibraryItemID, for a link the
// user set (or that Packrat's own ghost/download creation set) that no
// longer applies. Never touches the library item itself, only the
// association; if the entry's own URL/video id still genuinely matches
// something in the library, the "Known items" dialog falls back to
// reporting that soft match again once this is cleared.
func (r *SubscriptionsRepo) UnlinkSeenEntry(ctx context.Context, subscriptionID int64, sourceID string) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE subscription_seen_entries SET library_item_id = NULL WHERE subscription_id = ? AND source_id = ?`,
		subscriptionID, sourceID,
	)
	if err != nil {
		return fmt.Errorf("unlinking seen subscription entry: %w", err)
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

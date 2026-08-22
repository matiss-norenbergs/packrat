package repository

import (
	"context"
	"database/sql"
	"fmt"

	"packrat/backend/internal/models"
)

type FrameMatchQueueRepo struct {
	db *sql.DB
}

func NewFrameMatchQueueRepo(db *sql.DB) *FrameMatchQueueRepo {
	return &FrameMatchQueueRepo{db: db}
}

// Create enqueues one item for matching — state starts "queued", picked up
// by the next framematch.RunQueue poll.
func (r *FrameMatchQueueRepo) Create(ctx context.Context, libraryItemID int64, itemTitle, mode string) (int64, error) {
	res, err := r.db.ExecContext(ctx, `
		INSERT INTO frame_match_queue (library_item_id, item_title, mode, state)
		VALUES (?, ?, ?, 'queued')`,
		libraryItemID, itemTitle, mode,
	)
	if err != nil {
		return 0, fmt.Errorf("enqueuing frame match for item %d: %w", libraryItemID, err)
	}
	return res.LastInsertId()
}

// ExistsForLibraryItem reports whether a library item already has a row
// (any state) sitting in the queue — used to reject a redundant single-item
// match request before it wastes a scan on something already pending or
// already resolved-but-unreviewed.
func (r *FrameMatchQueueRepo) ExistsForLibraryItem(ctx context.Context, libraryItemID int64) (bool, error) {
	var exists bool
	err := r.db.QueryRowContext(ctx,
		`SELECT EXISTS(SELECT 1 FROM frame_match_queue WHERE library_item_id = ?)`, libraryItemID,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("checking frame match queue for item %d: %w", libraryItemID, err)
	}
	return exists, nil
}

// LibraryItemIDsInQueue returns the set of library item ids that already
// have a row (any state) in the queue — used by the bulk enqueue path to
// skip items that would otherwise get a redundant duplicate row.
func (r *FrameMatchQueueRepo) LibraryItemIDsInQueue(ctx context.Context) (map[int64]bool, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT DISTINCT library_item_id FROM frame_match_queue`)
	if err != nil {
		return nil, fmt.Errorf("listing frame match queue library item ids: %w", err)
	}
	defer rows.Close()

	out := make(map[int64]bool)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scanning frame match queue library item id: %w", err)
		}
		out[id] = true
	}
	return out, rows.Err()
}

// List returns every queue row, oldest first — the "Frame Matching" page's
// full working-queue view. No pagination: this is meant to stay small since
// resolved rows are deleted rather than archived.
func (r *FrameMatchQueueRepo) List(ctx context.Context) ([]models.FrameMatchQueueItem, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, library_item_id, item_title, mode, state, timestamp_seconds, score,
			found_frame_path, reference_image_path, error_msg, created_at, updated_at
		FROM frame_match_queue ORDER BY id ASC`,
	)
	if err != nil {
		return nil, fmt.Errorf("listing frame match queue: %w", err)
	}
	defer rows.Close()

	var out []models.FrameMatchQueueItem
	for rows.Next() {
		item, err := scanFrameMatchQueueRow(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning frame match queue row: %w", err)
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// NextQueued returns the oldest still-"queued" row, or nil if the queue is
// empty. framematch.RunQueue runs as exactly one background goroutine, so
// no additional claim/locking step is needed here to avoid two workers
// picking up the same row.
func (r *FrameMatchQueueRepo) NextQueued(ctx context.Context) (*models.FrameMatchQueueItem, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT id, library_item_id, item_title, mode, state, timestamp_seconds, score,
			found_frame_path, reference_image_path, error_msg, created_at, updated_at
		FROM frame_match_queue WHERE state = 'queued' ORDER BY id ASC LIMIT 1`,
	)
	item, err := scanFrameMatchQueueRow(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("finding next queued frame match: %w", err)
	}
	return &item, nil
}

// Get returns one queue row by id.
func (r *FrameMatchQueueRepo) Get(ctx context.Context, id int64) (models.FrameMatchQueueItem, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT id, library_item_id, item_title, mode, state, timestamp_seconds, score,
			found_frame_path, reference_image_path, error_msg, created_at, updated_at
		FROM frame_match_queue WHERE id = ?`, id,
	)
	item, err := scanFrameMatchQueueRow(row)
	if err == sql.ErrNoRows {
		return models.FrameMatchQueueItem{}, ErrNotFound
	}
	if err != nil {
		return models.FrameMatchQueueItem{}, fmt.Errorf("loading frame match queue item %d: %w", id, err)
	}
	return item, nil
}

func (r *FrameMatchQueueRepo) SetRunning(ctx context.Context, id int64) error {
	if _, err := r.db.ExecContext(ctx,
		`UPDATE frame_match_queue SET state = 'running', updated_at = datetime('now') WHERE id = ?`, id,
	); err != nil {
		return fmt.Errorf("marking frame match queue item %d running: %w", id, err)
	}
	return nil
}

func (r *FrameMatchQueueRepo) SetDone(ctx context.Context, id int64, timestampSeconds, score float64, foundFramePath, referenceImagePath string) error {
	if _, err := r.db.ExecContext(ctx, `
		UPDATE frame_match_queue
		SET state = 'done', timestamp_seconds = ?, score = ?, found_frame_path = ?, reference_image_path = ?, updated_at = datetime('now')
		WHERE id = ?`,
		timestampSeconds, score, foundFramePath, referenceImagePath, id,
	); err != nil {
		return fmt.Errorf("marking frame match queue item %d done: %w", id, err)
	}
	return nil
}

func (r *FrameMatchQueueRepo) SetError(ctx context.Context, id int64, errMsg string) error {
	if _, err := r.db.ExecContext(ctx,
		`UPDATE frame_match_queue SET state = 'error', error_msg = ?, updated_at = datetime('now') WHERE id = ?`,
		errMsg, id,
	); err != nil {
		return fmt.Errorf("marking frame match queue item %d error: %w", id, err)
	}
	return nil
}

// Delete removes one queue row — called once the user accepts, discards, or
// dismisses it. Callers are responsible for cleaning up any image files
// SetDone recorded first.
func (r *FrameMatchQueueRepo) Delete(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM frame_match_queue WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("deleting frame match queue item %d: %w", id, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// scanFrameMatchQueueRow uses the shared rowScanner interface (see
// downloads_repo.go), satisfied by both *sql.Row and *sql.Rows, so it
// serves Get/NextQueued (single row) and List (many) alike.
func scanFrameMatchQueueRow(s rowScanner) (models.FrameMatchQueueItem, error) {
	var item models.FrameMatchQueueItem
	var createdAt, updatedAt string
	var timestampSeconds, score sql.NullFloat64
	var foundFramePath, referenceImagePath, errorMsg sql.NullString

	if err := s.Scan(
		&item.ID, &item.LibraryItemID, &item.ItemTitle, &item.Mode, &item.State,
		&timestampSeconds, &score, &foundFramePath, &referenceImagePath, &errorMsg,
		&createdAt, &updatedAt,
	); err != nil {
		return models.FrameMatchQueueItem{}, err
	}

	if timestampSeconds.Valid {
		item.TimestampSeconds = &timestampSeconds.Float64
	}
	if score.Valid {
		item.Score = &score.Float64
	}
	if foundFramePath.Valid {
		item.FoundFramePath = &foundFramePath.String
	}
	if referenceImagePath.Valid {
		item.ReferenceImagePath = &referenceImagePath.String
	}
	if errorMsg.Valid {
		item.ErrorMsg = &errorMsg.String
	}

	var err error
	item.CreatedAt, err = parseSQLiteTime(createdAt)
	if err != nil {
		return models.FrameMatchQueueItem{}, err
	}
	item.UpdatedAt, err = parseSQLiteTime(updatedAt)
	if err != nil {
		return models.FrameMatchQueueItem{}, err
	}
	return item, nil
}

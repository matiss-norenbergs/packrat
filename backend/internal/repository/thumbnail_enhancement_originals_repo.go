package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type ThumbnailEnhancementOriginalsRepo struct {
	db *sql.DB
}

func NewThumbnailEnhancementOriginalsRepo(db *sql.DB) *ThumbnailEnhancementOriginalsRepo {
	return &ThumbnailEnhancementOriginalsRepo{db: db}
}

// Create records the pre-enhancement backup path for an item — a no-op if
// one already exists (library_item_id is the primary key), so the first
// backup ever taken for an item is always the one kept, even if the item
// is enhanced again later.
func (r *ThumbnailEnhancementOriginalsRepo) Create(ctx context.Context, libraryItemID int64, originalPath string) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO thumbnail_enhancement_originals (library_item_id, original_path)
		VALUES (?, ?)
		ON CONFLICT(library_item_id) DO NOTHING`,
		libraryItemID, originalPath,
	)
	if err != nil {
		return fmt.Errorf("inserting thumbnail enhancement original: %w", err)
	}
	return nil
}

// Get returns the item's backup path, or ErrNotFound if it has none.
func (r *ThumbnailEnhancementOriginalsRepo) Get(ctx context.Context, libraryItemID int64) (string, error) {
	var path string
	err := r.db.QueryRowContext(ctx,
		`SELECT original_path FROM thumbnail_enhancement_originals WHERE library_item_id = ?`,
		libraryItemID,
	).Scan(&path)
	if err == sql.ErrNoRows {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("getting thumbnail enhancement original for item %d: %w", libraryItemID, err)
	}
	return path, nil
}

// GetWithCreatedAt returns the item's backup path and when that backup was
// taken (the start of the current enhancement cycle) — used by
// thumbnailenhance.RevertOriginal to know which history rows the revert
// it's about to perform actually undoes. Returns ErrNotFound if the item
// has no backup.
func (r *ThumbnailEnhancementOriginalsRepo) GetWithCreatedAt(ctx context.Context, libraryItemID int64) (path string, createdAt time.Time, err error) {
	var createdAtStr string
	err = r.db.QueryRowContext(ctx,
		`SELECT original_path, created_at FROM thumbnail_enhancement_originals WHERE library_item_id = ?`,
		libraryItemID,
	).Scan(&path, &createdAtStr)
	if err == sql.ErrNoRows {
		return "", time.Time{}, ErrNotFound
	}
	if err != nil {
		return "", time.Time{}, fmt.Errorf("getting thumbnail enhancement original for item %d: %w", libraryItemID, err)
	}
	createdAt, err = parseSQLiteTime(createdAtStr)
	if err != nil {
		return "", time.Time{}, err
	}
	return path, createdAt, nil
}

// Delete removes the backup pointer — called after a revert (the backup
// was just consumed) or an explicit "delete original" (freeing it,
// keeping the enhanced thumbnail permanent).
func (r *ThumbnailEnhancementOriginalsRepo) Delete(ctx context.Context, libraryItemID int64) error {
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM thumbnail_enhancement_originals WHERE library_item_id = ?`,
		libraryItemID,
	)
	if err != nil {
		return fmt.Errorf("deleting thumbnail enhancement original for item %d: %w", libraryItemID, err)
	}
	return nil
}

// ListItemIDsWithBackup returns the set of library item ids that currently
// have a backup — one bulk query so the history-list handler can enrich
// every row without an N+1 lookup per row.
func (r *ThumbnailEnhancementOriginalsRepo) ListItemIDsWithBackup(ctx context.Context) (map[int64]bool, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT library_item_id FROM thumbnail_enhancement_originals`)
	if err != nil {
		return nil, fmt.Errorf("listing thumbnail enhancement originals: %w", err)
	}
	defer rows.Close()

	out := make(map[int64]bool)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scanning thumbnail enhancement original id: %w", err)
		}
		out[id] = true
	}
	return out, rows.Err()
}

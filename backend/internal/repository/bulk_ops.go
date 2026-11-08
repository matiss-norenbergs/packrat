package repository

import (
	"context"
	"database/sql"
	"fmt"
	"slices"
	"time"

	"packrat/backend/internal/models"
)

// Batch operations behind the all-or-nothing bulk endpoints. Each runs in ONE
// transaction on the single DB connection, validates before it writes, and
// never takes a repo mutex or calls a recorder while the transaction is open
// (lock order, docs/architecture.md). Ids that do not exist are ignored; the
// returned counts are the rows really affected. Lists are processed through
// inChunks so no IN list exceeds SQLite's variable limit.

// execInChunks runs a `... WHERE <col> IN (...)` statement per chunk and sums
// the rows affected. query must contain a single %s for the placeholder list.
func execInChunks[T any](ctx context.Context, tx *sql.Tx, ids []T, queryFmt string, lead ...any) (int, error) {
	total := 0
	err := inChunks(ids, inChunkSize, func(chunk []T) error {
		args := append(slices.Clone(lead), anySlice(chunk)...)
		res, err := tx.ExecContext(ctx, fmt.Sprintf(queryFmt, placeholderList(len(chunk))), args...)
		if err != nil {
			return err
		}
		n, err := res.RowsAffected()
		if err != nil {
			return err
		}
		total += int(n)
		return nil
	})
	return total, err
}

// DeleteByIDs deletes the downloads with the given ids in one transaction. If
// any of them is in an active status nothing is deleted and those ids are
// returned as blocked (the caller answers 409). Missing ids are ignored; the
// count is the number of rows really removed.
func (r *DownloadsRepo) DeleteByIDs(ctx context.Context, ids []int64) (deleted int, blocked []int64, err error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, nil, fmt.Errorf("beginning download delete: %w", err)
	}
	defer tx.Rollback()

	active := make(map[models.DownloadStatus]struct{})
	for _, s := range models.ActiveStatuses() {
		active[s] = struct{}{}
	}
	err = inChunks(ids, inChunkSize, func(chunk []int64) error {
		rows, err := tx.QueryContext(ctx, `SELECT id, status FROM downloads WHERE id IN (`+placeholderList(len(chunk))+`)`, anySlice(chunk)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id int64
			var status models.DownloadStatus
			if err := rows.Scan(&id, &status); err != nil {
				return err
			}
			if _, isActive := active[status]; isActive {
				blocked = append(blocked, id)
			}
		}
		return rows.Err()
	})
	if err != nil {
		return 0, nil, fmt.Errorf("checking downloads before delete: %w", err)
	}
	if len(blocked) > 0 {
		slices.Sort(blocked)
		return 0, blocked, nil
	}

	deleted, err = execInChunks(ctx, tx, ids, `DELETE FROM downloads WHERE id IN (%s)`)
	if err != nil {
		return 0, nil, fmt.Errorf("deleting downloads: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, nil, fmt.Errorf("committing download delete: %w", err)
	}
	return deleted, nil, nil
}

// DeleteByIDs deletes the history entries with the given ids in one
// transaction; missing ids are ignored.
func (r *HistoryRepo) DeleteByIDs(ctx context.Context, ids []int64) (int, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("beginning history delete: %w", err)
	}
	defer tx.Rollback()
	n, err := execInChunks(ctx, tx, ids, `DELETE FROM history WHERE id IN (%s)`)
	if err != nil {
		return 0, fmt.Errorf("deleting history entries: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("committing history delete: %w", err)
	}
	return n, nil
}

// DeleteByIDs deletes the subscriptions with the given ids in one
// transaction; missing ids are ignored. Their seen entries go with them
// through the foreign key cascade, as with the single delete.
func (r *SubscriptionsRepo) DeleteByIDs(ctx context.Context, ids []int64) (int, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("beginning subscription delete: %w", err)
	}
	defer tx.Rollback()
	n, err := execInChunks(ctx, tx, ids, `DELETE FROM subscriptions WHERE id IN (%s)`)
	if err != nil {
		return 0, fmt.Errorf("deleting subscriptions: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("committing subscription delete: %w", err)
	}
	return n, nil
}

// MarkSeenEntries dismisses the listed entries of one subscription in one
// transaction (the batch of MarkSeenEntry); unknown source ids are ignored and
// the count is the rows really updated.
func (r *SubscriptionsRepo) MarkSeenEntries(ctx context.Context, subscriptionID int64, sourceIDs []string) (int, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("beginning mark-seen: %w", err)
	}
	defer tx.Rollback()
	n, err := execInChunks(ctx, tx, sourceIDs,
		`UPDATE subscription_seen_entries SET seen_at = ? WHERE subscription_id = ? AND source_id IN (%s)`,
		time.Now().UTC().Format("2006-01-02 15:04:05"), subscriptionID)
	if err != nil {
		return 0, fmt.Errorf("marking subscription entries seen: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("committing mark-seen: %w", err)
	}
	return n, nil
}

// UnlinkSeenEntries clears the library link of the listed entries of one
// subscription in one transaction (the batch of UnlinkSeenEntry); unknown
// source ids are ignored and the count is the rows really updated.
func (r *SubscriptionsRepo) UnlinkSeenEntries(ctx context.Context, subscriptionID int64, sourceIDs []string) (int, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("beginning unlink: %w", err)
	}
	defer tx.Rollback()
	n, err := execInChunks(ctx, tx, sourceIDs,
		`UPDATE subscription_seen_entries SET library_item_id = NULL WHERE subscription_id = ? AND source_id IN (%s)`,
		subscriptionID)
	if err != nil {
		return 0, fmt.Errorf("unlinking subscription entries: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("committing unlink: %w", err)
	}
	return n, nil
}

// DeleteByIDs deletes the backup history rows with the given ids in one
// transaction and returns the rows it removed, so the caller can delete their
// files AFTER the commit. Missing ids are ignored.
func (r *BackupHistoryRepo) DeleteByIDs(ctx context.Context, ids []int64) ([]models.BackupHistory, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("beginning backup history delete: %w", err)
	}
	defer tx.Rollback()

	var found []models.BackupHistory
	err = inChunks(ids, inChunkSize, func(chunk []int64) error {
		rows, err := tx.QueryContext(ctx, backupHistorySelectColumns+` WHERE id IN (`+placeholderList(len(chunk))+`)`, anySlice(chunk)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			entry, err := scanBackupHistory(rows)
			if err != nil {
				return err
			}
			found = append(found, *entry)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("loading backup history entries: %w", err)
	}
	if _, err := execInChunks(ctx, tx, ids, `DELETE FROM backup_history WHERE id IN (%s)`); err != nil {
		return nil, fmt.Errorf("deleting backup history entries: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("committing backup history delete: %w", err)
	}
	return found, nil
}

// galleryForItem loads the listed gallery rows inside tx and splits the ids
// into the rows found, ids that belong to another item, and ids that do not
// exist.
func galleryForItem(ctx context.Context, tx *sql.Tx, itemID int64, ids []int64) (own []models.ThumbnailGalleryImage, foreign, missing []int64, err error) {
	byID := make(map[int64]models.ThumbnailGalleryImage, len(ids))
	err = inChunks(ids, inChunkSize, func(chunk []int64) error {
		rows, err := tx.QueryContext(ctx, `
			SELECT id, library_item_id, image_path, width, height, timestamp_seconds, is_favorite, created_at
			FROM thumbnail_gallery WHERE id IN (`+placeholderList(len(chunk))+`)`, anySlice(chunk)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			img, err := scanThumbnailGalleryRow(rows)
			if err != nil {
				return err
			}
			byID[img.ID] = img
		}
		return rows.Err()
	})
	if err != nil {
		return nil, nil, nil, err
	}
	for _, id := range ids {
		img, ok := byID[id]
		switch {
		case !ok:
			missing = append(missing, id)
		case img.LibraryItemID != itemID:
			foreign = append(foreign, id)
		default:
			own = append(own, img)
		}
	}
	return own, foreign, missing, nil
}

// SetFavoriteForItem sets the favorite flag of the listed gallery images of one
// library item in one transaction. If any id belongs to another item
// (foreign) or does not exist (missing) nothing is changed and both lists are
// returned. Otherwise updated is the number of rows changed.
func (r *ThumbnailGalleryRepo) SetFavoriteForItem(ctx context.Context, itemID int64, ids []int64, favorite bool) (updated int, foreign, missing []int64, err error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, nil, nil, fmt.Errorf("beginning gallery favorite: %w", err)
	}
	defer tx.Rollback()

	_, foreign, missing, err = galleryForItem(ctx, tx, itemID, ids)
	if err != nil {
		return 0, nil, nil, fmt.Errorf("checking gallery images: %w", err)
	}
	if len(foreign) > 0 || len(missing) > 0 {
		return 0, foreign, missing, nil
	}
	updated, err = execInChunks(ctx, tx, ids, `UPDATE thumbnail_gallery SET is_favorite = ? WHERE id IN (%s)`, favorite)
	if err != nil {
		return 0, nil, nil, fmt.Errorf("updating gallery favorites: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, nil, nil, fmt.Errorf("committing gallery favorite: %w", err)
	}
	return updated, nil, nil, nil
}

// DeleteForItem deletes the listed gallery images of one library item in one
// transaction and returns the removed rows so the caller can delete their
// files AFTER the commit. If any id belongs to another item (foreign) nothing
// is deleted; ids that do not exist are ignored.
func (r *ThumbnailGalleryRepo) DeleteForItem(ctx context.Context, itemID int64, ids []int64) (deleted []models.ThumbnailGalleryImage, foreign []int64, err error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("beginning gallery delete: %w", err)
	}
	defer tx.Rollback()

	own, foreign, _, err := galleryForItem(ctx, tx, itemID, ids)
	if err != nil {
		return nil, nil, fmt.Errorf("checking gallery images: %w", err)
	}
	if len(foreign) > 0 {
		return nil, foreign, nil
	}
	ownIDs := make([]int64, len(own))
	for i, img := range own {
		ownIDs[i] = img.ID
	}
	if _, err := execInChunks(ctx, tx, ownIDs, `DELETE FROM thumbnail_gallery WHERE id IN (%s)`); err != nil {
		return nil, nil, fmt.Errorf("deleting gallery images: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, nil, fmt.Errorf("committing gallery delete: %w", err)
	}
	return own, nil, nil
}

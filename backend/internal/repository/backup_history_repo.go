package repository

import (
	"context"
	"database/sql"
	"fmt"

	"packrat/backend/internal/models"
)

type BackupHistoryRepo struct {
	db *sql.DB
}

func NewBackupHistoryRepo(db *sql.DB) *BackupHistoryRepo {
	return &BackupHistoryRepo{db: db}
}

// Create inserts a complete backup_history row in one shot — unlike
// HistoryRepo.Create's incremental insert, callers here build the whole
// outcome (success or failure) before persisting it.
func (r *BackupHistoryRepo) Create(ctx context.Context, entry models.BackupHistory) (int64, error) {
	res, err := r.db.ExecContext(ctx, `
		INSERT INTO backup_history (
			trigger_type, status, file_name, file_size_bytes,
			library_items_count, collections_count, tags_count, artists_count, error_message
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		entry.TriggerType, entry.Status, entry.FileName, entry.FileSizeBytes,
		entry.LibraryItemsCount, entry.CollectionsCount, entry.TagsCount, entry.ArtistsCount, entry.ErrorMessage,
	)
	if err != nil {
		return 0, fmt.Errorf("inserting backup history entry: %w", err)
	}
	return res.LastInsertId()
}

func (r *BackupHistoryRepo) Get(ctx context.Context, id int64) (*models.BackupHistory, error) {
	row := r.db.QueryRowContext(ctx, backupHistorySelectColumns+` WHERE id = ?`, id)
	entry, err := scanBackupHistory(row)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return entry, err
}

// List returns every backup history entry, most recent first — no LIMIT,
// since DeleteExceedingRetention keeps this table small in practice.
func (r *BackupHistoryRepo) List(ctx context.Context) ([]models.BackupHistory, error) {
	rows, err := r.db.QueryContext(ctx, backupHistorySelectColumns+` ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("listing backup history: %w", err)
	}
	defer rows.Close()

	var out []models.BackupHistory
	for rows.Next() {
		entry, err := scanBackupHistory(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *entry)
	}
	return out, rows.Err()
}

func (r *BackupHistoryRepo) Delete(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM backup_history WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("deleting backup history entry: %w", err)
	}
	return checkRowsAffected(res)
}

// LatestSuccessful returns the most recent successful backup, or (nil, nil)
// if none exist yet — "no backups yet" is a normal state for the scheduler's
// due-check, not an error condition, so it's deliberately not ErrNotFound.
func (r *BackupHistoryRepo) LatestSuccessful(ctx context.Context) (*models.BackupHistory, error) {
	row := r.db.QueryRowContext(ctx, backupHistorySelectColumns+` WHERE status = 'success' ORDER BY created_at DESC LIMIT 1`)
	entry, err := scanBackupHistory(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return entry, err
}

// DeleteExceedingRetention deletes every row past the keep most-recent ones
// and returns the deleted rows, so the caller (backup.RunBackup) can unlink
// their on-disk files — DB and filesystem concerns stay separated, same as
// ArtistsRepo.DeleteImage returning a path rather than touching disk itself.
func (r *BackupHistoryRepo) DeleteExceedingRetention(ctx context.Context, keep int) ([]models.BackupHistory, error) {
	rows, err := r.db.QueryContext(ctx, backupHistorySelectColumns+` ORDER BY created_at DESC LIMIT -1 OFFSET ?`, keep)
	if err != nil {
		return nil, fmt.Errorf("finding backups exceeding retention: %w", err)
	}
	var toDelete []models.BackupHistory
	for rows.Next() {
		entry, err := scanBackupHistory(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		toDelete = append(toDelete, *entry)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for _, entry := range toDelete {
		if _, err := r.db.ExecContext(ctx, `DELETE FROM backup_history WHERE id = ?`, entry.ID); err != nil {
			return nil, fmt.Errorf("deleting backup history entry %d: %w", entry.ID, err)
		}
	}
	return toDelete, nil
}

const backupHistorySelectColumns = `
	SELECT id, trigger_type, status, file_name, file_size_bytes,
		library_items_count, collections_count, tags_count, artists_count, error_message, created_at
	FROM backup_history`

func scanBackupHistory(row rowScanner) (*models.BackupHistory, error) {
	var e models.BackupHistory
	var createdAt string

	err := row.Scan(
		&e.ID, &e.TriggerType, &e.Status, &e.FileName, &e.FileSizeBytes,
		&e.LibraryItemsCount, &e.CollectionsCount, &e.TagsCount, &e.ArtistsCount, &e.ErrorMessage, &createdAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, err
		}
		return nil, fmt.Errorf("scanning backup history entry: %w", err)
	}

	e.CreatedAt, err = parseSQLiteTime(createdAt)
	if err != nil {
		return nil, err
	}
	return &e, nil
}

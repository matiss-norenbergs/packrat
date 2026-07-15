package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"packrat/backend/internal/models"
)

type HistoryRepo struct {
	db *sql.DB
}

func NewHistoryRepo(db *sql.DB) *HistoryRepo {
	return &HistoryRepo{db: db}
}

func (r *HistoryRepo) Create(ctx context.Context, downloadID *int64, url, status string, errMsg *string) (int64, error) {
	res, err := r.db.ExecContext(ctx, `
		INSERT INTO history (download_id, url, status, error_message)
		VALUES (?, ?, ?, ?)`,
		downloadID, url, status, errMsg,
	)
	if err != nil {
		return 0, fmt.Errorf("inserting history entry: %w", err)
	}
	return res.LastInsertId()
}

func (r *HistoryRepo) Get(ctx context.Context, id int64) (*models.History, error) {
	row := r.db.QueryRowContext(ctx, historySelectColumns+` WHERE h.id = ?`, id)
	h, err := scanHistory(row)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return h, err
}

// List returns every history entry, most recent first, capped at 200 rows —
// a simple safety measure since (unlike Library/Downloads, which the user
// actively curates) History is designed to accumulate forever with nothing
// else bounding it. Title/thumbnail come from the originating downloads row
// when it still exists; both are nil once it's been deleted.
func (r *HistoryRepo) List(ctx context.Context) ([]models.History, error) {
	rows, err := r.db.QueryContext(ctx, historySelectColumns+` ORDER BY h.created_at DESC LIMIT 200`)
	if err != nil {
		return nil, fmt.Errorf("listing history: %w", err)
	}
	defer rows.Close()

	var out []models.History
	for rows.Next() {
		h, err := scanHistory(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *h)
	}
	return out, rows.Err()
}

// Delete removes a single history entry by id.
func (r *HistoryRepo) Delete(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM history WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("deleting history entry: %w", err)
	}
	return checkRowsAffected(res)
}

// DeleteOlderThan removes every history entry created before cutoff, returning how many rows were
// deleted — the implementation behind the configurable retention sweep (see cleanupHistory in
// cmd/server/main.go). created_at is stored as SQLite's datetime('now') text (UTC,
// "YYYY-MM-DD HH:MM:SS"), which sorts and compares correctly as a plain string, so cutoff is
// formatted the same way rather than relying on SQLite's own date functions.
func (r *HistoryRepo) DeleteOlderThan(ctx context.Context, cutoff time.Time) (int64, error) {
	res, err := r.db.ExecContext(ctx, `DELETE FROM history WHERE created_at < ?`, cutoff.UTC().Format("2006-01-02 15:04:05"))
	if err != nil {
		return 0, fmt.Errorf("deleting old history entries: %w", err)
	}
	return res.RowsAffected()
}

const historySelectColumns = `
	SELECT h.id, h.download_id, h.url, h.status, h.error_message, h.created_at, d.title, d.thumbnail
	FROM history h
	LEFT JOIN downloads d ON d.id = h.download_id`

func scanHistory(row rowScanner) (*models.History, error) {
	var h models.History
	var createdAt string

	err := row.Scan(
		&h.ID, &h.DownloadID, &h.URL, &h.Status, &h.ErrorMessage, &createdAt, &h.Title, &h.Thumbnail,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, err
		}
		return nil, fmt.Errorf("scanning history entry: %w", err)
	}

	h.CreatedAt, err = parseSQLiteTime(createdAt)
	if err != nil {
		return nil, err
	}
	return &h, nil
}

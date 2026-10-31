package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"packrat/backend/internal/models"
)

// ErrTooManyTableLayouts is returned by Set when saving a new table would exceed the per-account cap.
var ErrTooManyTableLayouts = errors.New("too many saved table layouts")

// UserTableLayoutsRepo stores per-account saved table layouts. The JSON is not validated here; the
// API layer canonicalizes it with models.ParseTableLayout.
type UserTableLayoutsRepo struct {
	db *sql.DB
}

func NewUserTableLayoutsRepo(db *sql.DB) *UserTableLayoutsRepo {
	return &UserTableLayoutsRepo{db: db}
}

// GetAll returns the user's layouts by table id (empty, never nil, when none).
func (r *UserTableLayoutsRepo) GetAll(ctx context.Context, userID int64) (map[string]string, error) {
	out := map[string]string{}
	rows, err := r.db.QueryContext(ctx, `SELECT table_id, layout FROM user_table_layouts WHERE user_id = ?`, userID)
	if err != nil {
		return nil, fmt.Errorf("listing table layouts: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id, layout string
		if err := rows.Scan(&id, &layout); err != nil {
			return nil, fmt.Errorf("scanning table layout: %w", err)
		}
		out[id] = layout
	}
	return out, rows.Err()
}

// Set replaces the layout of one table. Updating an existing table is always allowed; a new one is
// refused with ErrTooManyTableLayouts once the account has models.MaxTableLayoutsPerUser.
func (r *UserTableLayoutsRepo) Set(ctx context.Context, userID int64, tableID, layoutJSON string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("beginning table layout tx: %w", err)
	}
	defer tx.Rollback()
	var exists int
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM user_table_layouts WHERE user_id = ? AND table_id = ?`, userID, tableID).Scan(&exists); err != nil {
		return fmt.Errorf("checking table layout: %w", err)
	}
	if exists == 0 {
		var n int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM user_table_layouts WHERE user_id = ?`, userID).Scan(&n); err != nil {
			return fmt.Errorf("counting table layouts: %w", err)
		}
		if n >= models.MaxTableLayoutsPerUser {
			return ErrTooManyTableLayouts
		}
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO user_table_layouts (user_id, table_id, layout) VALUES (?, ?, ?)
		 ON CONFLICT(user_id, table_id) DO UPDATE SET layout = excluded.layout, updated_at = datetime('now')`,
		userID, tableID, layoutJSON); err != nil {
		return fmt.Errorf("saving table layout %q: %w", tableID, err)
	}
	return tx.Commit()
}

// Delete removes one table's layout; deleting one that was never saved is not an error.
func (r *UserTableLayoutsRepo) Delete(ctx context.Context, userID int64, tableID string) error {
	if _, err := r.db.ExecContext(ctx, `DELETE FROM user_table_layouts WHERE user_id = ? AND table_id = ?`, userID, tableID); err != nil {
		return fmt.Errorf("deleting table layout %q: %w", tableID, err)
	}
	return nil
}

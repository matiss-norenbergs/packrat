package repository

import (
	"context"
	"database/sql"
	"fmt"

	"packrat/backend/internal/models"
)

// UserPreferencesRepo stores per-account UI preferences. Values are not validated here; the API
// layer checks them against models.UserPreferenceSpecs.
type UserPreferencesRepo struct {
	db *sql.DB
}

func NewUserPreferencesRepo(db *sql.DB) *UserPreferencesRepo {
	return &UserPreferencesRepo{db: db}
}

// GetAll returns every known preference of the user, with the in-code default for unset keys.
func (r *UserPreferencesRepo) GetAll(ctx context.Context, userID int64) (map[string]string, error) {
	out := make(map[string]string, len(models.UserPreferenceSpecs))
	for k, spec := range models.UserPreferenceSpecs {
		out[k] = spec.Default
	}
	rows, err := r.db.QueryContext(ctx, `SELECT key, value FROM user_preferences WHERE user_id = ?`, userID)
	if err != nil {
		return nil, fmt.Errorf("listing user preferences: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, fmt.Errorf("scanning user preference: %w", err)
		}
		if _, known := out[k]; known {
			out[k] = v
		}
	}
	return out, rows.Err()
}

// Set upserts the given keys for the user in one transaction.
func (r *UserPreferencesRepo) Set(ctx context.Context, userID int64, values map[string]string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("beginning user preferences tx: %w", err)
	}
	defer tx.Rollback()
	for k, v := range values {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO user_preferences (user_id, key, value) VALUES (?, ?, ?)
			 ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
			userID, k, v); err != nil {
			return fmt.Errorf("saving user preference %q: %w", k, err)
		}
	}
	return tx.Commit()
}

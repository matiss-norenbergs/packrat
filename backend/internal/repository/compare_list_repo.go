package repository

import (
	"context"
	"database/sql"
	"fmt"

	"packrat/backend/internal/models"
)

// CompareListRepo tracks a single, unbounded, unordered-by-user set of
// library items the user wants to line up for side-by-side comparison. It's
// deliberately much thinner than TagsRepo — there's no name uniqueness, no
// per-user scoping (this is a single-user app), and re-adding an
// already-listed item is a silent no-op rather than an error, so no mutex is
// needed either.
type CompareListRepo struct {
	db dbtx

	// rawDB is always the real connection pool, never a WithTx substitution
	// — Add opens its own subordinate transaction and SQLite doesn't support
	// nesting one inside another, same rationale as TagsRepo.rawDB.
	rawDB *sql.DB
}

func NewCompareListRepo(db *sql.DB) *CompareListRepo {
	return &CompareListRepo{db: db, rawDB: db}
}

// WithTx returns a copy of r whose queries run against tx instead of the
// underlying connection pool — see TagsRepo.WithTx for the full rationale.
func (r *CompareListRepo) WithTx(tx *sql.Tx) *CompareListRepo {
	cp := *r
	cp.db = tx
	return &cp
}

// List returns every library item currently in the compare list, ordered by
// when it was added — oldest first, matching how the list visually grows.
func (r *CompareListRepo) List(ctx context.Context) ([]models.LibraryItem, error) {
	query := librarySelectColumns + `
		JOIN compare_list cl ON cl.library_id = l.id
		ORDER BY cl.added_at`
	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("listing compare list: %w", err)
	}
	defer rows.Close()

	var out []models.LibraryItem
	for rows.Next() {
		item, err := scanLibraryItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *item)
	}
	return out, rows.Err()
}

// Add inserts every id not already present — idempotent, so re-adding an
// item already on the list is a silent no-op rather than a duplicate-key
// error. Ids that don't correspond to a real library item are silently
// skipped (INSERT OR IGNORE also swallows the FK violation this would
// otherwise cause) rather than failing the whole batch.
func (r *CompareListRepo) Add(ctx context.Context, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}

	tx, err := r.rawDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("beginning compare-list add transaction: %w", err)
	}
	defer tx.Rollback()

	for _, id := range ids {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO compare_list (library_id) VALUES (?)`, id); err != nil {
			return fmt.Errorf("adding item %d to compare list: %w", id, err)
		}
	}
	return tx.Commit()
}

// Remove drops a single item from the compare list.
func (r *CompareListRepo) Remove(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM compare_list WHERE library_id = ?`, id)
	if err != nil {
		return fmt.Errorf("removing item from compare list: %w", err)
	}
	return checkRowsAffected(res)
}

// Clear empties the whole compare list.
func (r *CompareListRepo) Clear(ctx context.Context) error {
	if _, err := r.db.ExecContext(ctx, `DELETE FROM compare_list`); err != nil {
		return fmt.Errorf("clearing compare list: %w", err)
	}
	return nil
}

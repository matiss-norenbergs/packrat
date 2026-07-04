package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"packrat/backend/internal/models"
)

// ErrDuplicateName is returned by Create/Update when another collection
// already uses the requested name (collections.name is UNIQUE).
var ErrDuplicateName = errors.New("collection name already in use")

type CollectionsRepo struct {
	db *sql.DB
}

func NewCollectionsRepo(db *sql.DB) *CollectionsRepo {
	return &CollectionsRepo{db: db}
}

func (r *CollectionsRepo) nameInUse(ctx context.Context, name string, excludeID int64) (bool, error) {
	var id int64
	err := r.db.QueryRowContext(ctx, `SELECT id FROM collections WHERE name = ? AND id != ?`, name, excludeID).Scan(&id)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("checking collection name uniqueness: %w", err)
	}
	return true, nil
}

func (r *CollectionsRepo) Create(ctx context.Context, c *models.Collection) (int64, error) {
	inUse, err := r.nameInUse(ctx, c.Name, 0)
	if err != nil {
		return 0, err
	}
	if inUse {
		return 0, ErrDuplicateName
	}

	res, err := r.db.ExecContext(ctx, `
		INSERT INTO collections (name, root_path, default_quality, default_download_type)
		VALUES (?, ?, ?, ?)`,
		c.Name, c.RootPath, c.DefaultQuality, c.DefaultDownloadType,
	)
	if err != nil {
		return 0, fmt.Errorf("inserting collection: %w", err)
	}
	return res.LastInsertId()
}

func (r *CollectionsRepo) Get(ctx context.Context, id int64) (*models.Collection, error) {
	row := r.db.QueryRowContext(ctx, collectionSelectColumns+` WHERE id = ?`, id)
	c, err := scanCollection(row)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return c, err
}

func (r *CollectionsRepo) List(ctx context.Context) ([]models.Collection, error) {
	rows, err := r.db.QueryContext(ctx, collectionSelectColumns+` ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("listing collections: %w", err)
	}
	defer rows.Close()

	var out []models.Collection
	for rows.Next() {
		c, err := scanCollection(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// Update overwrites name/root_path/default_quality/default_download_type for
// id. Callers apply partial-update semantics before calling this (fetch,
// merge, write) — this method always writes all four columns.
func (r *CollectionsRepo) Update(ctx context.Context, id int64, c *models.Collection) error {
	inUse, err := r.nameInUse(ctx, c.Name, id)
	if err != nil {
		return err
	}
	if inUse {
		return ErrDuplicateName
	}

	res, err := r.db.ExecContext(ctx, `
		UPDATE collections
		SET name = ?, root_path = ?, default_quality = ?, default_download_type = ?, updated_at = datetime('now')
		WHERE id = ?`,
		c.Name, c.RootPath, c.DefaultQuality, c.DefaultDownloadType, id,
	)
	if err != nil {
		return fmt.Errorf("updating collection: %w", err)
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

func (r *CollectionsRepo) Delete(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM collections WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("deleting collection: %w", err)
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

const collectionSelectColumns = `
	SELECT id, name, root_path, default_quality, default_download_type, filename_template,
	       jellyfin_library, created_at, updated_at
	FROM collections`

func scanCollection(row rowScanner) (*models.Collection, error) {
	var c models.Collection
	var createdAt, updatedAt string

	err := row.Scan(
		&c.ID, &c.Name, &c.RootPath, &c.DefaultQuality, &c.DefaultDownloadType, &c.FilenameTemplate,
		&c.JellyfinLibrary, &createdAt, &updatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, err
		}
		return nil, fmt.Errorf("scanning collection: %w", err)
	}

	c.CreatedAt, err = parseSQLiteTime(createdAt)
	if err != nil {
		return nil, err
	}
	c.UpdatedAt, err = parseSQLiteTime(updatedAt)
	if err != nil {
		return nil, err
	}

	return &c, nil
}

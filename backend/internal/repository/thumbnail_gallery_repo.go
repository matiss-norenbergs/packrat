package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"packrat/backend/internal/models"
)

type ThumbnailGalleryRepo struct {
	db *sql.DB
}

func NewThumbnailGalleryRepo(db *sql.DB) *ThumbnailGalleryRepo {
	return &ThumbnailGalleryRepo{db: db}
}

// Create records a saved gallery image and returns its new id.
func (r *ThumbnailGalleryRepo) Create(ctx context.Context, libraryItemID int64, imagePath string, width, height *int) (int64, error) {
	res, err := r.db.ExecContext(ctx, `
		INSERT INTO thumbnail_gallery (library_item_id, image_path, width, height)
		VALUES (?, ?, ?, ?)`,
		libraryItemID, imagePath, width, height,
	)
	if err != nil {
		return 0, fmt.Errorf("inserting thumbnail gallery image for item %d: %w", libraryItemID, err)
	}
	return res.LastInsertId()
}

// ListByLibraryItemID returns an item's saved gallery images, newest first.
func (r *ThumbnailGalleryRepo) ListByLibraryItemID(ctx context.Context, libraryItemID int64) ([]models.ThumbnailGalleryImage, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, library_item_id, image_path, width, height, created_at
		FROM thumbnail_gallery WHERE library_item_id = ? ORDER BY id DESC`, libraryItemID,
	)
	if err != nil {
		return nil, fmt.Errorf("listing thumbnail gallery for item %d: %w", libraryItemID, err)
	}
	defer rows.Close()

	var out []models.ThumbnailGalleryImage
	for rows.Next() {
		img, err := scanThumbnailGalleryRow(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning thumbnail gallery row: %w", err)
		}
		out = append(out, img)
	}
	return out, rows.Err()
}

// Get returns one gallery image by id, or ErrNotFound.
func (r *ThumbnailGalleryRepo) Get(ctx context.Context, id int64) (models.ThumbnailGalleryImage, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT id, library_item_id, image_path, width, height, created_at
		FROM thumbnail_gallery WHERE id = ?`, id,
	)
	img, err := scanThumbnailGalleryRow(row)
	if err == sql.ErrNoRows {
		return models.ThumbnailGalleryImage{}, ErrNotFound
	}
	if err != nil {
		return models.ThumbnailGalleryImage{}, fmt.Errorf("loading thumbnail gallery image %d: %w", id, err)
	}
	return img, nil
}

// CountByLibraryItemID returns how many gallery images one item has —
// for single-item response endpoints (see CountsByLibraryItemIDs for the
// batched equivalent used by list endpoints).
func (r *ThumbnailGalleryRepo) CountByLibraryItemID(ctx context.Context, libraryItemID int64) (int, error) {
	var count int
	err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM thumbnail_gallery WHERE library_item_id = ?`, libraryItemID,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("counting thumbnail gallery images for item %d: %w", libraryItemID, err)
	}
	return count, nil
}

// CountsByLibraryItemIDs batch-fetches gallery image counts for a page of
// library items in one query — the same shape as TagsByLibraryIDs, so a
// list endpoint never does a per-item query. ids not present in the
// returned map have zero gallery images.
func (r *ThumbnailGalleryRepo) CountsByLibraryItemIDs(ctx context.Context, ids []int64) (map[int64]int, error) {
	out := make(map[int64]int, len(ids))
	if len(ids) == 0 {
		return out, nil
	}

	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT library_item_id, COUNT(*) FROM thumbnail_gallery
		WHERE library_item_id IN (`+placeholders+`)
		GROUP BY library_item_id`, args...)
	if err != nil {
		return nil, fmt.Errorf("batch-counting thumbnail gallery images: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var libraryItemID int64
		var count int
		if err := rows.Scan(&libraryItemID, &count); err != nil {
			return nil, fmt.Errorf("scanning thumbnail gallery count: %w", err)
		}
		out[libraryItemID] = count
	}
	return out, rows.Err()
}

// Delete removes one gallery image row. Callers are responsible for
// removing the underlying image file first.
func (r *ThumbnailGalleryRepo) Delete(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM thumbnail_gallery WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("deleting thumbnail gallery image %d: %w", id, err)
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

// scanThumbnailGalleryRow uses the shared rowScanner interface (see
// downloads_repo.go), satisfied by both *sql.Row and *sql.Rows.
func scanThumbnailGalleryRow(s rowScanner) (models.ThumbnailGalleryImage, error) {
	var img models.ThumbnailGalleryImage
	var createdAt string
	var width, height sql.NullInt64

	if err := s.Scan(&img.ID, &img.LibraryItemID, &img.ImagePath, &width, &height, &createdAt); err != nil {
		return models.ThumbnailGalleryImage{}, err
	}

	if width.Valid {
		w := int(width.Int64)
		img.Width = &w
	}
	if height.Valid {
		h := int(height.Int64)
		img.Height = &h
	}

	var err error
	img.CreatedAt, err = parseSQLiteTime(createdAt)
	if err != nil {
		return models.ThumbnailGalleryImage{}, err
	}
	return img, nil
}

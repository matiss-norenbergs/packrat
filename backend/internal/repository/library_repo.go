package repository

import (
	"context"
	"database/sql"
	"fmt"

	"packrat/backend/internal/models"
)

type LibraryRepo struct {
	db *sql.DB
}

func NewLibraryRepo(db *sql.DB) *LibraryRepo {
	return &LibraryRepo{db: db}
}

func (r *LibraryRepo) Create(ctx context.Context, item *models.LibraryItem) (int64, error) {
	res, err := r.db.ExecContext(ctx, `
		INSERT INTO library (download_id, title, filename, path, collection_id, folder, original_url,
		                      video_id, uploader, duration, resolution, thumbnail, description, status, file_size_bytes)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		item.DownloadID, item.Title, item.Filename, item.Path, item.CollectionID, item.Folder, item.OriginalURL,
		item.VideoID, item.Uploader, item.Duration, item.Resolution, item.Thumbnail, item.Description, item.Status, item.FileSizeBytes,
	)
	if err != nil {
		return 0, fmt.Errorf("inserting library item: %w", err)
	}
	return res.LastInsertId()
}

func (r *LibraryRepo) Get(ctx context.Context, id int64) (*models.LibraryItem, error) {
	row := r.db.QueryRowContext(ctx, librarySelectColumns+` WHERE l.id = ?`, id)
	return scanLibraryItem(row)
}

func (r *LibraryRepo) List(ctx context.Context) ([]models.LibraryItem, error) {
	rows, err := r.db.QueryContext(ctx, librarySelectColumns+` ORDER BY l.downloaded_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("listing library: %w", err)
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

const librarySelectColumns = `
	SELECT l.id, l.download_id, l.title, l.filename, l.path, l.collection_id, c.name, l.folder, l.original_url, l.video_id,
	       l.uploader, l.duration, l.resolution, l.thumbnail, l.description, l.downloaded_at, l.status, l.file_size_bytes
	FROM library l
	LEFT JOIN collections c ON c.id = l.collection_id`

func scanLibraryItem(row rowScanner) (*models.LibraryItem, error) {
	var item models.LibraryItem
	var downloadedAt string

	err := row.Scan(
		&item.ID, &item.DownloadID, &item.Title, &item.Filename, &item.Path, &item.CollectionID, &item.CollectionName, &item.Folder,
		&item.OriginalURL, &item.VideoID, &item.Uploader, &item.Duration, &item.Resolution, &item.Thumbnail,
		&item.Description, &downloadedAt, &item.Status, &item.FileSizeBytes,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, err
		}
		return nil, fmt.Errorf("scanning library item: %w", err)
	}

	item.DownloadedAt, err = parseSQLiteTime(downloadedAt)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

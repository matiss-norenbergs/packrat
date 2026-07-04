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
		                      video_id, uploader, duration, resolution, thumbnail, description, artist, release_year, status, file_size_bytes)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		item.DownloadID, item.Title, item.Filename, item.Path, item.CollectionID, item.Folder, item.OriginalURL,
		item.VideoID, item.Uploader, item.Duration, item.Resolution, item.Thumbnail, item.Description, item.Artist, item.ReleaseYear, item.Status, item.FileSizeBytes,
	)
	if err != nil {
		return 0, fmt.Errorf("inserting library item: %w", err)
	}
	return res.LastInsertId()
}

func (r *LibraryRepo) Get(ctx context.Context, id int64) (*models.LibraryItem, error) {
	row := r.db.QueryRowContext(ctx, librarySelectColumns+` WHERE l.id = ?`, id)
	item, err := scanLibraryItem(row)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return item, err
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

func (r *LibraryRepo) Delete(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM library WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("deleting library item: %w", err)
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

func (r *LibraryRepo) UpdateTitle(ctx context.Context, id int64, title string) error {
	res, err := r.db.ExecContext(ctx, `UPDATE library SET title = ? WHERE id = ?`, title, id)
	if err != nil {
		return fmt.Errorf("updating library title: %w", err)
	}
	return checkRowsAffected(res)
}

// UpdateFilename is used by Rename when the physical filename changes —
// the file itself has already been renamed on disk by the caller via
// fsutil.RenamePair before this is called.
func (r *LibraryRepo) UpdateFilename(ctx context.Context, id int64, filename, path string, thumbnail *string) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE library SET filename = ?, path = ?, thumbnail = ? WHERE id = ?`,
		filename, path, thumbnail, id,
	)
	if err != nil {
		return fmt.Errorf("updating library filename: %w", err)
	}
	return checkRowsAffected(res)
}

// UpdateLocation is used by Move — the file has already been relocated on
// disk by the caller via fsutil.RenamePair before this is called.
func (r *LibraryRepo) UpdateLocation(ctx context.Context, id int64, collectionID *int64, folder, filename, path string, thumbnail *string) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE library SET collection_id = ?, folder = ?, filename = ?, path = ?, thumbnail = ? WHERE id = ?`,
		collectionID, folder, filename, path, thumbnail, id,
	)
	if err != nil {
		return fmt.Errorf("updating library location: %w", err)
	}
	return checkRowsAffected(res)
}

// UpdateMetadata is used by Refresh Metadata and the Edit dialog's field
// updates. resolution uses COALESCE since a re-fetch might not include
// width/height — nil leaves the existing value untouched rather than
// clobbering it with an unknown one. artist/releaseYear are plain
// overwrites (nil clears them), matching how the Edit dialog sends them.
func (r *LibraryRepo) UpdateMetadata(ctx context.Context, id int64, title, uploader *string, duration *int, resolution *string, description, artist *string, releaseYear *int) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE library
		SET title = COALESCE(?, title), uploader = ?, duration = ?,
		    resolution = COALESCE(?, resolution), description = ?, artist = ?, release_year = ?
		WHERE id = ?`,
		title, uploader, duration, resolution, description, artist, releaseYear, id,
	)
	if err != nil {
		return fmt.Errorf("updating library metadata: %w", err)
	}
	return checkRowsAffected(res)
}

// UpdateThumbnail sets the item's thumbnail path — used by the
// redownload/quick-grab/choose-from-video thumbnail actions after they've
// written a new sidecar image file.
func (r *LibraryRepo) UpdateThumbnail(ctx context.Context, id int64, thumbnail *string) error {
	res, err := r.db.ExecContext(ctx, `UPDATE library SET thumbnail = ? WHERE id = ?`, thumbnail, id)
	if err != nil {
		return fmt.Errorf("updating library thumbnail: %w", err)
	}
	return checkRowsAffected(res)
}

// UpdateOriginalURL sets or clears (when url is nil) the item's source URL —
// used both to fill in a URL for a previously URL-less imported item, and by
// the Edit dialog's normal field-editing flow.
func (r *LibraryRepo) UpdateOriginalURL(ctx context.Context, id int64, url *string) error {
	res, err := r.db.ExecContext(ctx, `UPDATE library SET original_url = ? WHERE id = ?`, url, id)
	if err != nil {
		return fmt.Errorf("updating library original_url: %w", err)
	}
	return checkRowsAffected(res)
}

// ListPaths returns the set of relative media paths already tracked in the
// library table, for the import scanner to skip on disk.
func (r *LibraryRepo) ListPaths(ctx context.Context) (map[string]bool, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT path FROM library`)
	if err != nil {
		return nil, fmt.Errorf("listing library paths: %w", err)
	}
	defer rows.Close()

	out := make(map[string]bool)
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, fmt.Errorf("scanning library path: %w", err)
		}
		out[p] = true
	}
	return out, rows.Err()
}

func checkRowsAffected(res sql.Result) error {
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

const librarySelectColumns = `
	SELECT l.id, l.download_id, l.title, l.filename, l.path, l.collection_id, c.name, l.folder, l.original_url, l.video_id,
	       l.uploader, l.duration, l.resolution, l.thumbnail, l.description, l.artist, l.release_year, l.downloaded_at, l.status, l.file_size_bytes
	FROM library l
	LEFT JOIN collections c ON c.id = l.collection_id`

func scanLibraryItem(row rowScanner) (*models.LibraryItem, error) {
	var item models.LibraryItem
	var downloadedAt string

	err := row.Scan(
		&item.ID, &item.DownloadID, &item.Title, &item.Filename, &item.Path, &item.CollectionID, &item.CollectionName, &item.Folder,
		&item.OriginalURL, &item.VideoID, &item.Uploader, &item.Duration, &item.Resolution, &item.Thumbnail,
		&item.Description, &item.Artist, &item.ReleaseYear, &downloadedAt, &item.Status, &item.FileSizeBytes,
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

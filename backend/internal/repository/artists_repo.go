package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"

	"packrat/backend/internal/models"
)

// ErrArtistNameInUse is returned by Create/Rename when another artist
// already uses the requested name (artists.name is UNIQUE).
var ErrArtistNameInUse = errors.New("artist name already in use")

type ArtistsRepo struct {
	db dbtx

	// mu serializes every check-then-write name-uniqueness sequence
	// (Create, Rename) — same race TagsRepo.mu prevents (see its doc
	// comment in tags_repo.go). A pointer so WithTx copies share the same
	// lock as the original.
	mu *sync.Mutex
}

func NewArtistsRepo(db *sql.DB) *ArtistsRepo {
	return &ArtistsRepo{db: db, mu: &sync.Mutex{}}
}

// WithTx returns a copy of r whose queries run against tx instead of the
// underlying connection pool — see TagsRepo.WithTx for the full rationale.
func (r *ArtistsRepo) WithTx(tx *sql.Tx) *ArtistsRepo {
	cp := *r
	cp.db = tx
	return &cp
}

func (r *ArtistsRepo) nameInUse(ctx context.Context, name string, excludeID int64) (bool, error) {
	var id int64
	err := r.db.QueryRowContext(ctx, `SELECT id FROM artists WHERE name = ? AND id != ?`, name, excludeID).Scan(&id)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("checking artist name uniqueness: %w", err)
	}
	return true, nil
}

// Create adds a public artist — for callers that don't care about privacy
// (e.g. backup restore); CreateWithPrivacy takes the flag explicitly.
func (r *ArtistsRepo) Create(ctx context.Context, name string, birthday *string) (*models.Artist, error) {
	return r.CreateWithPrivacy(ctx, name, birthday, false)
}

// CreateWithPrivacy adds an artist with an explicit privacy flag.
func (r *ArtistsRepo) CreateWithPrivacy(ctx context.Context, name string, birthday *string, isPrivate bool) (*models.Artist, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.createLocked(ctx, name, birthday, isPrivate)
}

// createLocked performs the actual check-then-insert; callers must already
// hold r.mu.
func (r *ArtistsRepo) createLocked(ctx context.Context, name string, birthday *string, isPrivate bool) (*models.Artist, error) {
	inUse, err := r.nameInUse(ctx, name, 0)
	if err != nil {
		return nil, err
	}
	if inUse {
		return nil, ErrArtistNameInUse
	}

	res, err := r.db.ExecContext(ctx, `INSERT INTO artists (name, birthday, is_private) VALUES (?, ?, ?)`, name, birthday, isPrivate)
	if err != nil {
		return nil, fmt.Errorf("inserting artist: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return r.Get(ctx, id)
}

func (r *ArtistsRepo) Get(ctx context.Context, id int64) (*models.Artist, error) {
	var a models.Artist
	var createdAt string
	err := r.db.QueryRowContext(ctx, `SELECT id, name, selected_image_path, birthday, is_private, created_at FROM artists WHERE id = ?`, id).
		Scan(&a.ID, &a.Name, &a.SelectedImagePath, &a.Birthday, &a.IsPrivate, &createdAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scanning artist: %w", err)
	}
	a.CreatedAt, err = parseSQLiteTime(createdAt)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// List returns every artist with how many library items currently have it,
// ordered by name — used by the Artists management page.
func (r *ArtistsRepo) List(ctx context.Context) ([]models.ArtistWithCount, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT a.id, a.name, a.selected_image_path, a.birthday, a.is_private, a.created_at, COUNT(l.id) AS usage_count
		FROM artists a
		LEFT JOIN library l ON l.artist_id = a.id
		GROUP BY a.id
		ORDER BY a.name`)
	if err != nil {
		return nil, fmt.Errorf("listing artists: %w", err)
	}
	defer rows.Close()

	var out []models.ArtistWithCount
	for rows.Next() {
		var a models.ArtistWithCount
		var createdAt string
		if err := rows.Scan(&a.ID, &a.Name, &a.SelectedImagePath, &a.Birthday, &a.IsPrivate, &createdAt, &a.UsageCount); err != nil {
			return nil, fmt.Errorf("scanning artist: %w", err)
		}
		a.CreatedAt, err = parseSQLiteTime(createdAt)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// SetSelectedImage narrowly updates just the artist's chosen display image —
// kept separate from Rename so picking/clearing a picture never needs to
// round-trip the artist's name (mirrors LibraryRepo.UpdateThumbnail's
// narrow-update style). path == nil clears the selection without touching
// the underlying gallery.
func (r *ArtistsRepo) SetSelectedImage(ctx context.Context, artistID int64, path *string) error {
	res, err := r.db.ExecContext(ctx, `UPDATE artists SET selected_image_path = ? WHERE id = ?`, path, artistID)
	if err != nil {
		return fmt.Errorf("updating artist selected image: %w", err)
	}
	return checkRowsAffected(res)
}

// AddImage records a newly copied-in gallery image for an artist.
func (r *ArtistsRepo) AddImage(ctx context.Context, artistID int64, relativePath string) (*models.ArtistImage, error) {
	res, err := r.db.ExecContext(ctx, `INSERT INTO artist_images (artist_id, relative_path) VALUES (?, ?)`, artistID, relativePath)
	if err != nil {
		return nil, fmt.Errorf("inserting artist image: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return r.GetImage(ctx, id)
}

func (r *ArtistsRepo) GetImage(ctx context.Context, imageID int64) (*models.ArtistImage, error) {
	var img models.ArtistImage
	var createdAt string
	err := r.db.QueryRowContext(ctx, `SELECT id, artist_id, relative_path, created_at FROM artist_images WHERE id = ?`, imageID).
		Scan(&img.ID, &img.ArtistID, &img.RelativePath, &createdAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scanning artist image: %w", err)
	}
	img.CreatedAt, err = parseSQLiteTime(createdAt)
	if err != nil {
		return nil, err
	}
	return &img, nil
}

// ListImages returns an artist's full image gallery, oldest first.
func (r *ArtistsRepo) ListImages(ctx context.Context, artistID int64) ([]models.ArtistImage, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, artist_id, relative_path, created_at FROM artist_images WHERE artist_id = ? ORDER BY created_at, id`, artistID)
	if err != nil {
		return nil, fmt.Errorf("listing artist images: %w", err)
	}
	defer rows.Close()

	var out []models.ArtistImage
	for rows.Next() {
		var img models.ArtistImage
		var createdAt string
		if err := rows.Scan(&img.ID, &img.ArtistID, &img.RelativePath, &createdAt); err != nil {
			return nil, fmt.Errorf("scanning artist image: %w", err)
		}
		img.CreatedAt, err = parseSQLiteTime(createdAt)
		if err != nil {
			return nil, err
		}
		out = append(out, img)
	}
	return out, rows.Err()
}

// UpdateImagePath rewrites an existing gallery image's stored path in
// place — used by the one-off image-derivative backfill tool to point an
// already-recorded row at its newly re-encoded file without changing the
// row's identity (id, created_at).
func (r *ArtistsRepo) UpdateImagePath(ctx context.Context, imageID int64, relativePath string) error {
	res, err := r.db.ExecContext(ctx, `UPDATE artist_images SET relative_path = ? WHERE id = ?`, relativePath, imageID)
	if err != nil {
		return fmt.Errorf("updating artist image path: %w", err)
	}
	return checkRowsAffected(res)
}

// DeleteImage removes a gallery image's row and hands back its relative
// path so the caller can also unlink the file and, if it was the artist's
// selected image, clear that pointer too.
func (r *ArtistsRepo) DeleteImage(ctx context.Context, imageID int64) (string, error) {
	img, err := r.GetImage(ctx, imageID)
	if err != nil {
		return "", err
	}
	if _, err := r.db.ExecContext(ctx, `DELETE FROM artist_images WHERE id = ?`, imageID); err != nil {
		return "", fmt.Errorf("deleting artist image: %w", err)
	}
	return img.RelativePath, nil
}

// Update overwrites an artist's name and birthday together — the Artist
// dialog's one save action covers both fields, so there's no need for two
// separate narrow updates the way SetSelectedImage is split out (that one's
// driven by a different, image-picker-specific action). isPrivate nil
// leaves the privacy flag unchanged, so clients that don't know about it
// can't reset it.
func (r *ArtistsRepo) Update(ctx context.Context, id int64, newName string, birthday *string, isPrivate *bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, err := r.Get(ctx, id); err != nil {
		return err
	}
	inUse, err := r.nameInUse(ctx, newName, id)
	if err != nil {
		return err
	}
	if inUse {
		return ErrArtistNameInUse
	}

	res, err := r.db.ExecContext(ctx, `UPDATE artists SET name = ?, birthday = ?, is_private = COALESCE(?, is_private) WHERE id = ?`, newName, birthday, isPrivate, id)
	if err != nil {
		return fmt.Errorf("updating artist: %w", err)
	}
	return checkRowsAffected(res)
}

// Delete removes an artist; ON DELETE SET NULL on library.artist_id and
// downloads.override_artist_id clears the reference on affected rows
// automatically rather than deleting anything.
func (r *ArtistsRepo) Delete(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM artists WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("deleting artist: %w", err)
	}
	return checkRowsAffected(res)
}

// PrivateArtistIDs returns the set of artist ids currently marked private —
// fetched once per request and cross-referenced against each item's own
// ArtistID, the same fetch-once-then-lookup shape as TagsRepo.PrivateTagNames.
func (r *ArtistsRepo) PrivateArtistIDs(ctx context.Context) (map[int64]bool, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id FROM artists WHERE is_private = 1`)
	if err != nil {
		return nil, fmt.Errorf("listing private artists: %w", err)
	}
	defer rows.Close()

	out := make(map[int64]bool)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scanning private artist: %w", err)
		}
		out[id] = true
	}
	return out, rows.Err()
}

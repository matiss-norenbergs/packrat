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

func (r *ArtistsRepo) Create(ctx context.Context, name string) (*models.Artist, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.createLocked(ctx, name)
}

// createLocked performs the actual check-then-insert; callers must already
// hold r.mu.
func (r *ArtistsRepo) createLocked(ctx context.Context, name string) (*models.Artist, error) {
	inUse, err := r.nameInUse(ctx, name, 0)
	if err != nil {
		return nil, err
	}
	if inUse {
		return nil, ErrArtistNameInUse
	}

	res, err := r.db.ExecContext(ctx, `INSERT INTO artists (name) VALUES (?)`, name)
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
	err := r.db.QueryRowContext(ctx, `SELECT id, name, created_at FROM artists WHERE id = ?`, id).
		Scan(&a.ID, &a.Name, &createdAt)
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
		SELECT a.id, a.name, a.created_at, COUNT(l.id) AS usage_count
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
		if err := rows.Scan(&a.ID, &a.Name, &createdAt, &a.UsageCount); err != nil {
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

func (r *ArtistsRepo) Rename(ctx context.Context, id int64, newName string) error {
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

	res, err := r.db.ExecContext(ctx, `UPDATE artists SET name = ? WHERE id = ?`, newName, id)
	if err != nil {
		return fmt.Errorf("renaming artist: %w", err)
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

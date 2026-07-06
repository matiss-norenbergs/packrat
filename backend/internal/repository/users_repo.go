package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"packrat/backend/internal/models"
)

type UsersRepo struct {
	db *sql.DB
}

func NewUsersRepo(db *sql.DB) *UsersRepo {
	return &UsersRepo{db: db}
}

func (r *UsersRepo) Create(ctx context.Context, username, passwordHash string) (*models.User, error) {
	res, err := r.db.ExecContext(ctx, `INSERT INTO users (username, password_hash) VALUES (?, ?)`, username, passwordHash)
	if err != nil {
		return nil, fmt.Errorf("inserting user: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return r.GetByID(ctx, id)
}

func (r *UsersRepo) GetByID(ctx context.Context, id int64) (*models.User, error) {
	var u models.User
	var createdAt string
	err := r.db.QueryRowContext(ctx, `SELECT id, username, password_hash, created_at FROM users WHERE id = ?`, id).
		Scan(&u.ID, &u.Username, &u.PasswordHash, &createdAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scanning user: %w", err)
	}
	u.CreatedAt, err = parseSQLiteTime(createdAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *UsersRepo) GetByUsername(ctx context.Context, username string) (*models.User, error) {
	var u models.User
	var createdAt string
	err := r.db.QueryRowContext(ctx, `SELECT id, username, password_hash, created_at FROM users WHERE username = ?`, username).
		Scan(&u.ID, &u.Username, &u.PasswordHash, &createdAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scanning user: %w", err)
	}
	u.CreatedAt, err = parseSQLiteTime(createdAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// Count reports how many users exist — used to decide whether the frontend
// should show the first-run setup wizard (count == 0) or a login form.
func (r *UsersRepo) Count(ctx context.Context) (int, error) {
	var n int
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
		return 0, fmt.Errorf("counting users: %w", err)
	}
	return n, nil
}

func (r *UsersRepo) CreateSession(ctx context.Context, token string, userID int64, expiresAt time.Time) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`,
		token, userID, expiresAt.UTC().Format("2006-01-02 15:04:05"),
	)
	if err != nil {
		return fmt.Errorf("creating session: %w", err)
	}
	return nil
}

// GetValidSession looks up a session by token, treating an expired or
// missing token identically (ErrNotFound) — callers only need to know
// whether the session is currently usable, not why it isn't.
func (r *UsersRepo) GetValidSession(ctx context.Context, token string) (*models.Session, error) {
	var s models.Session
	var expiresAt, createdAt string
	err := r.db.QueryRowContext(ctx,
		`SELECT token, user_id, expires_at, created_at FROM sessions WHERE token = ? AND expires_at > datetime('now')`,
		token,
	).Scan(&s.Token, &s.UserID, &expiresAt, &createdAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scanning session: %w", err)
	}
	s.ExpiresAt, err = parseSQLiteTime(expiresAt)
	if err != nil {
		return nil, err
	}
	s.CreatedAt, err = parseSQLiteTime(createdAt)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// UpdatePasswordHash overwrites the stored bcrypt hash for a user — used by
// the change-password flow. Existing sessions are left untouched; a changed
// password doesn't invalidate the session the request itself is using, and
// this is a single-user app so there's no other-device threat model to
// address here.
func (r *UsersRepo) UpdatePasswordHash(ctx context.Context, userID int64, passwordHash string) error {
	res, err := r.db.ExecContext(ctx, `UPDATE users SET password_hash = ? WHERE id = ?`, passwordHash, userID)
	if err != nil {
		return fmt.Errorf("updating password hash: %w", err)
	}
	return checkRowsAffected(res)
}

func (r *UsersRepo) DeleteSession(ctx context.Context, token string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM sessions WHERE token = ?`, token)
	if err != nil {
		return fmt.Errorf("deleting session: %w", err)
	}
	return checkRowsAffected(res)
}

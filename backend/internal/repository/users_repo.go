package repository

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
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

const userColumns = `id, username, password_hash, created_at, COALESCE(totp_secret_enc, ''), COALESCE(totp_pending_enc, ''),
	totp_enabled, totp_last_step, security_ack_at`

func scanUser(row *sql.Row) (*models.User, error) {
	var u models.User
	var createdAt string
	var ackAt sql.NullString
	err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &createdAt, &u.TOTPSecretEnc, &u.TOTPPendingEnc,
		&u.TOTPEnabled, &u.TOTPLastStep, &ackAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scanning user: %w", err)
	}
	if u.CreatedAt, err = parseSQLiteTime(createdAt); err != nil {
		return nil, err
	}
	if ackAt.Valid {
		t, err := parseSQLiteTime(ackAt.String)
		if err != nil {
			return nil, err
		}
		u.SecurityAckAt = &t
	}
	return &u, nil
}

func (r *UsersRepo) GetByID(ctx context.Context, id int64) (*models.User, error) {
	return scanUser(r.db.QueryRowContext(ctx, `SELECT `+userColumns+` FROM users WHERE id = ?`, id))
}

func (r *UsersRepo) GetByUsername(ctx context.Context, username string) (*models.User, error) {
	return scanUser(r.db.QueryRowContext(ctx, `SELECT `+userColumns+` FROM users WHERE username = ?`, username))
}

// First returns the oldest account — the only one, since setup is single-user. Used by the admin
// commands, which act on "the" user.
func (r *UsersRepo) First(ctx context.Context) (*models.User, error) {
	return scanUser(r.db.QueryRowContext(ctx, `SELECT `+userColumns+` FROM users ORDER BY id LIMIT 1`))
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

// SessionMeta is what a session records about the device that logged in.
type SessionMeta struct {
	Client    string
	IP        string
	UserAgent string
}

const sessionTimeLayout = "2006-01-02 15:04:05"

// SessionTouchInterval is the most often a session's last_seen_at is written.
const SessionTouchInterval = time.Minute

func (r *UsersRepo) CreateSession(ctx context.Context, token string, userID int64, expiresAt time.Time, meta SessionMeta) error {
	publicID, err := newSessionPublicID()
	if err != nil {
		return fmt.Errorf("creating session id: %w", err)
	}
	_, err = r.db.ExecContext(ctx,
		`INSERT INTO sessions (token, user_id, expires_at, public_id, client, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		token, userID, expiresAt.UTC().Format(sessionTimeLayout), publicID, meta.Client, meta.IP, meta.UserAgent,
	)
	if err != nil {
		return fmt.Errorf("creating session: %w", err)
	}
	return nil
}

// newSessionPublicID is random and unrelated to the token: knowing it reveals nothing about the
// credential, it only lets the owner name one of their sessions (revoke it).
func newSessionPublicID() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

const sessionColumns = `token, user_id, expires_at, created_at, COALESCE(public_id, ''), last_seen_at, client, ip, user_agent`

func scanSession(row rowScanner) (*models.Session, error) {
	var s models.Session
	var expiresAt, createdAt string
	var lastSeen sql.NullString
	if err := row.Scan(&s.Token, &s.UserID, &expiresAt, &createdAt, &s.PublicID, &lastSeen, &s.Client, &s.IP, &s.UserAgent); err != nil {
		return nil, err
	}
	var err error
	if s.ExpiresAt, err = parseSQLiteTime(expiresAt); err != nil {
		return nil, err
	}
	if s.CreatedAt, err = parseSQLiteTime(createdAt); err != nil {
		return nil, err
	}
	if lastSeen.Valid {
		t, err := parseSQLiteTime(lastSeen.String)
		if err != nil {
			return nil, err
		}
		s.LastSeenAt = &t
	}
	return &s, nil
}

// GetValidSession looks up a session by token, treating an expired or
// missing token identically (ErrNotFound) — callers only need to know
// whether the session is currently usable, not why it isn't.
func (r *UsersRepo) GetValidSession(ctx context.Context, token string) (*models.Session, error) {
	s, err := scanSession(r.db.QueryRowContext(ctx,
		`SELECT `+sessionColumns+` FROM sessions WHERE token = ? AND expires_at > datetime('now')`, token))
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scanning session: %w", err)
	}
	return s, nil
}

// TouchSession records activity, but writes at most once per SessionTouchInterval per session
// (the guard is in the UPDATE, so concurrent requests can't both write).
func (r *UsersRepo) TouchSession(ctx context.Context, token string, now time.Time) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE sessions SET last_seen_at = ? WHERE token = ? AND (last_seen_at IS NULL OR last_seen_at <= ?)`,
		now.UTC().Format(sessionTimeLayout), token, now.Add(-SessionTouchInterval).UTC().Format(sessionTimeLayout),
	)
	if err != nil {
		return fmt.Errorf("touching session: %w", err)
	}
	return nil
}

// ListSessions returns the user's unexpired sessions, most recently active first.
func (r *UsersRepo) ListSessions(ctx context.Context, userID int64) ([]models.Session, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+sessionColumns+` FROM sessions WHERE user_id = ? AND expires_at > datetime('now')
		 ORDER BY COALESCE(last_seen_at, created_at) DESC, created_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("listing sessions: %w", err)
	}
	defer rows.Close()
	out := []models.Session{}
	for rows.Next() {
		s, err := scanSession(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning session: %w", err)
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

// DeleteSessionByPublicID revokes one of the user's sessions; an unknown id, or one that belongs to
// another user, is ErrNotFound.
func (r *UsersRepo) DeleteSessionByPublicID(ctx context.Context, userID int64, publicID string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ? AND public_id = ?`, userID, publicID)
	if err != nil {
		return fmt.Errorf("deleting session: %w", err)
	}
	return checkRowsAffected(res)
}

// DeleteOtherSessions revokes every session of the user except the one with keepToken and reports
// how many went.
func (r *UsersRepo) DeleteOtherSessions(ctx context.Context, userID int64, keepToken string) (int, error) {
	res, err := r.db.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ? AND token <> ?`, userID, keepToken)
	if err != nil {
		return 0, fmt.Errorf("deleting other sessions: %w", err)
	}
	n, err := res.RowsAffected()
	return int(n), err
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

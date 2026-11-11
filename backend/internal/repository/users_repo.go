package repository

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"packrat/backend/internal/models"
)

type UsersRepo struct {
	db *sql.DB

	// onSessionsRevoked is called after sessions are deleted (logout, revoke, sign-out-others),
	// so live connections tied to them can be closed. Set once at startup.
	onSessionsRevoked func()

	// now is the clock for session expiry (nil means time.Now); tests inject one.
	now func() time.Time
}

// SetClock replaces the clock session expiry is judged and extended by (tests).
func (r *UsersRepo) SetClock(now func() time.Time) { r.now = now }

// Now is the repository's current time: what login stamps expiries from and the middleware touches with.
func (r *UsersRepo) Now() time.Time {
	if r.now != nil {
		return r.now()
	}
	return time.Now()
}

// SetOnSessionsRevoked registers fn to run after sessions are deleted through this repo.
func (r *UsersRepo) SetOnSessionsRevoked(fn func()) { r.onSessionsRevoked = fn }

func (r *UsersRepo) sessionsRevoked() {
	if r.onSessionsRevoked != nil {
		r.onSessionsRevoked()
	}
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

// ErrSetupAlreadyDone is returned by CreateFirst when a user already exists.
var ErrSetupAlreadyDone = errors.New("setup already completed")

// CreateFirst inserts the user only if the users table is empty, in a single
// statement, so concurrent first-run calls cannot both succeed.
func (r *UsersRepo) CreateFirst(ctx context.Context, username, passwordHash string) (*models.User, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO users (username, password_hash) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)`,
		username, passwordHash)
	if err != nil {
		return nil, fmt.Errorf("inserting user: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, ErrSetupAlreadyDone
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

// SessionLifetime is how long a session lasts after login and after each slide.
const SessionLifetime = 30 * 24 * time.Hour

// SessionSlideAfter is how much of the lifetime must be used up before the expiry moves forward
// again, so it is written at most once a day: a touch extends only when less than
// SessionLifetime-SessionSlideAfter remains.
const SessionSlideAfter = 24 * time.Hour

// HashSessionToken is what the sessions table stores for a raw token: hex(SHA-256(token)). The
// token is 256 bits of randomness, not a password, so a plain unsalted hash is enough — it only has
// to make a leaked database or backup useless for signing in. Every UsersRepo method that takes a
// token hashes it here; callers always pass the raw token and can't forget.
func HashSessionToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// CreateSession stores the session under HashSessionToken(token); the raw token is not kept.
func (r *UsersRepo) CreateSession(ctx context.Context, token string, userID int64, expiresAt time.Time, meta SessionMeta) error {
	publicID, err := newSessionPublicID()
	if err != nil {
		return fmt.Errorf("creating session id: %w", err)
	}
	_, err = r.db.ExecContext(ctx,
		`INSERT INTO sessions (token, user_id, expires_at, public_id, client, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		HashSessionToken(token), userID, expiresAt.UTC().Format(sessionTimeLayout), publicID, meta.Client, meta.IP, meta.UserAgent,
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

// scanSession fills TokenHash from the database; Token (raw) is left empty for the caller to set.
func scanSession(row rowScanner) (*models.Session, error) {
	var s models.Session
	var expiresAt, createdAt string
	var lastSeen sql.NullString
	if err := row.Scan(&s.TokenHash, &s.UserID, &expiresAt, &createdAt, &s.PublicID, &lastSeen, &s.Client, &s.IP, &s.UserAgent); err != nil {
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

// GetValidSession looks up a session by raw token, treating an expired or
// missing token identically (ErrNotFound) — callers only need to know
// whether the session is currently usable, not why it isn't.
func (r *UsersRepo) GetValidSession(ctx context.Context, token string) (*models.Session, error) {
	s, err := scanSession(r.db.QueryRowContext(ctx,
		`SELECT `+sessionColumns+` FROM sessions WHERE token = ? AND expires_at > ?`,
		HashSessionToken(token), r.Now().UTC().Format(sessionTimeLayout)))
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scanning session: %w", err)
	}
	s.Token = token // the raw token this caller already holds; never from the database
	return s, nil
}

// TouchSession records activity and slides the expiry, in ONE statement so concurrent requests
// cannot both write. It writes only when last_seen_at is older than SessionTouchInterval, and in
// that same write moves expires_at to now+SessionLifetime when less than
// SessionLifetime-SessionSlideAfter is left (so at most once a day, and an active session never
// expires). A session already expired at now is never touched or revived. extended reports whether
// the expiry moved, decided by the statement itself (no re-query), so the caller can re-issue the
// cookies. A row that was not written (throttled, expired, unknown) is (false, nil).
func (r *UsersRepo) TouchSession(ctx context.Context, token string, now time.Time) (extended bool, err error) {
	nowS := now.UTC().Format(sessionTimeLayout)
	newExpiry := now.Add(SessionLifetime).UTC().Format(sessionTimeLayout)
	slideBelow := now.Add(SessionLifetime - SessionSlideAfter).UTC().Format(sessionTimeLayout)
	var got string
	err = r.db.QueryRowContext(ctx,
		`UPDATE sessions SET last_seen_at = ?, expires_at = CASE WHEN expires_at < ? THEN ? ELSE expires_at END
		 WHERE token = ? AND expires_at > ? AND (last_seen_at IS NULL OR last_seen_at <= ?)
		 RETURNING expires_at`,
		nowS, slideBelow, newExpiry, HashSessionToken(token), nowS, now.Add(-SessionTouchInterval).UTC().Format(sessionTimeLayout),
	).Scan(&got)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("touching session: %w", err)
	}
	// RETURNING sees the new row, so "extended" is "the expiry now equals newExpiry". An unextended
	// row keeps an expiry >= slideBelow; it equals newExpiry only if it was already exactly
	// now+SessionLifetime (login in the same second), where one redundant cookie re-issue with the
	// same lifetime is harmless. A concurrent writer at this instant is stopped by the
	// last_seen_at guard, so two callers never both see true.
	return got == newExpiry, nil
}

// ListSessions returns the user's unexpired sessions, most recently active first.
func (r *UsersRepo) ListSessions(ctx context.Context, userID int64) ([]models.Session, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+sessionColumns+` FROM sessions WHERE user_id = ? AND expires_at > ?
		 ORDER BY COALESCE(last_seen_at, created_at) DESC, created_at DESC`, userID, r.Now().UTC().Format(sessionTimeLayout))
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
	if err := checkRowsAffected(res); err != nil {
		return err
	}
	r.sessionsRevoked()
	return nil
}

// DeleteOtherSessions revokes every session of the user except the one with keepToken (raw) and reports
// how many went.
func (r *UsersRepo) DeleteOtherSessions(ctx context.Context, userID int64, keepToken string) (int, error) {
	res, err := r.db.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ? AND token <> ?`, userID, HashSessionToken(keepToken))
	if err != nil {
		return 0, fmt.Errorf("deleting other sessions: %w", err)
	}
	n, err := res.RowsAffected()
	if err == nil && n > 0 {
		r.sessionsRevoked()
	}
	return int(n), err
}

// ChangePassword stores the new hash and signs out every session except the one
// with keepToken in ONE transaction, so a failure between the two cannot leave
// the new password set with old sessions still alive (the admin commands already
// do the same, see AdminResetPassword). It reports how many sessions went.
func (r *UsersRepo) ChangePassword(ctx context.Context, userID int64, passwordHash, keepToken string) (int, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `UPDATE users SET password_hash = ? WHERE id = ?`, passwordHash, userID)
	if err != nil {
		return 0, fmt.Errorf("updating password hash: %w", err)
	}
	if err := checkRowsAffected(res); err != nil {
		return 0, err
	}
	res, err = tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ? AND token <> ?`, userID, HashSessionToken(keepToken))
	if err != nil {
		return 0, fmt.Errorf("deleting other sessions: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	if n > 0 {
		r.sessionsRevoked()
	}
	return int(n), nil
}

// UpdatePasswordHash overwrites the stored bcrypt hash for a user — used by
// the change-password flow. It does not touch sessions; the handler signs
// out the other ones with DeleteOtherSessions.
func (r *UsersRepo) UpdatePasswordHash(ctx context.Context, userID int64, passwordHash string) error {
	res, err := r.db.ExecContext(ctx, `UPDATE users SET password_hash = ? WHERE id = ?`, passwordHash, userID)
	if err != nil {
		return fmt.Errorf("updating password hash: %w", err)
	}
	return checkRowsAffected(res)
}

func (r *UsersRepo) DeleteSession(ctx context.Context, token string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM sessions WHERE token = ?`, HashSessionToken(token))
	if err != nil {
		return fmt.Errorf("deleting session: %w", err)
	}
	if err := checkRowsAffected(res); err != nil {
		return err
	}
	r.sessionsRevoked()
	return nil
}

// DeleteExpiredSessions removes every session whose expiry has passed and reports how many went.
// It deliberately does NOT call sessionsRevoked: an expired session is already rejected by
// GetValidSession, and every live WebSocket bound to it is closed by the hub's own ping-tick check
// (which treats expiry as "gone"), so there is nothing to tell the hub.
func (r *UsersRepo) DeleteExpiredSessions(ctx context.Context) (int64, error) {
	res, err := r.db.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at <= ?`, r.Now().UTC().Format(sessionTimeLayout))
	if err != nil {
		return 0, fmt.Errorf("deleting expired sessions: %w", err)
	}
	return res.RowsAffected()
}

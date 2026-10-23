package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"packrat/backend/internal/models"
)

// RecoveryCode is one stored (hashed) recovery code.
type RecoveryCode struct {
	ID   int64
	Hash string
}

// LoginFailureSummary aggregates failed attempts for the security notice.
type LoginFailureSummary struct {
	Count int
	Since time.Time
	Last  *time.Time
}

const sqliteTimeFmt = "2006-01-02 15:04:05"

type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func (r *UsersRepo) SetPendingTOTP(ctx context.Context, userID int64, pendingEnc string) error {
	res, err := r.db.ExecContext(ctx, `UPDATE users SET totp_pending_enc = ? WHERE id = ?`, pendingEnc, userID)
	if err != nil {
		return fmt.Errorf("storing pending totp secret: %w", err)
	}
	return checkRowsAffected(res)
}

// EnableTOTP promotes secretEnc to the active secret, records the accepted step and stores the
// recovery-code hashes — in one transaction, so 2FA is never on without codes.
func (r *UsersRepo) EnableTOTP(ctx context.Context, userID int64, secretEnc string, step int64, codeHashes []string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx,
		`UPDATE users SET totp_secret_enc = ?, totp_pending_enc = NULL, totp_enabled = 1, totp_last_step = ? WHERE id = ? AND totp_enabled = 0`,
		secretEnc, step, userID)
	if err != nil {
		return fmt.Errorf("enabling totp: %w", err)
	}
	if err := checkRowsAffected(res); err != nil {
		return err
	}
	if err := replaceRecoveryCodes(ctx, tx, userID, codeHashes); err != nil {
		return err
	}
	return tx.Commit()
}

func replaceRecoveryCodes(ctx context.Context, tx execer, userID int64, hashes []string) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM recovery_codes WHERE user_id = ?`, userID); err != nil {
		return fmt.Errorf("clearing recovery codes: %w", err)
	}
	for _, h := range hashes {
		if _, err := tx.ExecContext(ctx, `INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)`, userID, h); err != nil {
			return fmt.Errorf("storing recovery code: %w", err)
		}
	}
	return nil
}

// ReplaceRecoveryCodes swaps the whole set; the old codes stop working.
func (r *UsersRepo) ReplaceRecoveryCodes(ctx context.Context, userID int64, hashes []string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := replaceRecoveryCodes(ctx, tx, userID, hashes); err != nil {
		return err
	}
	return tx.Commit()
}

// AdvanceTOTPStep records step as used, reporting false if it (or a later one) already was — so a
// code can't be replayed, even by two concurrent requests.
func (r *UsersRepo) AdvanceTOTPStep(ctx context.Context, userID, step int64) (bool, error) {
	res, err := r.db.ExecContext(ctx, `UPDATE users SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?`, step, userID, step)
	if err != nil {
		return false, fmt.Errorf("advancing totp step: %w", err)
	}
	n, err := res.RowsAffected()
	return n == 1, err
}

func (r *UsersRepo) ListRecoveryCodes(ctx context.Context, userID int64) ([]RecoveryCode, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, code_hash FROM recovery_codes WHERE user_id = ?`, userID)
	if err != nil {
		return nil, fmt.Errorf("listing recovery codes: %w", err)
	}
	defer rows.Close()
	var out []RecoveryCode
	for rows.Next() {
		var c RecoveryCode
		if err := rows.Scan(&c.ID, &c.Hash); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *UsersRepo) CountRecoveryCodes(ctx context.Context, userID int64) (int, error) {
	var n int
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM recovery_codes WHERE user_id = ?`, userID).Scan(&n); err != nil {
		return 0, fmt.Errorf("counting recovery codes: %w", err)
	}
	return n, nil
}

// ConsumeRecoveryCode deletes one code, reporting false if it was already used.
func (r *UsersRepo) ConsumeRecoveryCode(ctx context.Context, id int64) (bool, error) {
	res, err := r.db.ExecContext(ctx, `DELETE FROM recovery_codes WHERE id = ?`, id)
	if err != nil {
		return false, fmt.Errorf("consuming recovery code: %w", err)
	}
	n, err := res.RowsAffected()
	return n == 1, err
}

func disableTOTP(ctx context.Context, tx execer, userID int64) error {
	if _, err := tx.ExecContext(ctx,
		`UPDATE users SET totp_secret_enc = NULL, totp_pending_enc = NULL, totp_enabled = 0, totp_last_step = 0 WHERE id = ?`, userID); err != nil {
		return fmt.Errorf("clearing totp: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM recovery_codes WHERE user_id = ?`, userID); err != nil {
		return fmt.Errorf("clearing recovery codes: %w", err)
	}
	return nil
}

// DisableTOTP turns 2FA off and wipes the secret, pending secret and recovery codes. Sessions are
// left alone: the owner just proved possession of a second factor.
func (r *UsersRepo) DisableTOTP(ctx context.Context, userID int64) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := disableTOTP(ctx, tx, userID); err != nil {
		return err
	}
	return tx.Commit()
}

// AdminResetPassword sets a new password hash and deletes every session in one transaction, so a
// stolen session dies with the old password. Used by the --reset-password command.
func (r *UsersRepo) AdminResetPassword(ctx context.Context, userID int64, passwordHash string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `UPDATE users SET password_hash = ? WHERE id = ?`, passwordHash, userID)
	if err != nil {
		return fmt.Errorf("updating password hash: %w", err)
	}
	if err := checkRowsAffected(res); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM sessions`); err != nil {
		return fmt.Errorf("deleting sessions: %w", err)
	}
	return tx.Commit()
}

// AdminDisableTOTP is DisableTOTP plus deleting every session. Used by the --disable-2fa command.
func (r *UsersRepo) AdminDisableTOTP(ctx context.Context, userID int64) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := disableTOTP(ctx, tx, userID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM sessions`); err != nil {
		return fmt.Errorf("deleting sessions: %w", err)
	}
	return tx.Commit()
}

// CountSessions reports how many sessions exist (tests and diagnostics).
func (r *UsersRepo) CountSessions(ctx context.Context) (int, error) {
	var n int
	err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sessions`).Scan(&n)
	return n, err
}

// RecordLoginFailure persists a failed attempt (time, address, step — never what was typed) and
// prunes rows older than retention.
func (r *UsersRepo) RecordLoginFailure(ctx context.Context, ip, kind string, at time.Time, retention time.Duration) error {
	if _, err := r.db.ExecContext(ctx, `INSERT INTO login_failures (ip, kind, created_at) VALUES (?, ?, ?)`,
		ip, kind, at.UTC().Format(sqliteTimeFmt)); err != nil {
		return fmt.Errorf("recording login failure: %w", err)
	}
	_, err := r.db.ExecContext(ctx, `DELETE FROM login_failures WHERE created_at < ?`,
		at.Add(-retention).UTC().Format(sqliteTimeFmt))
	return err
}

// LoginFailuresSince summarises failures after the user's last acknowledgement (or since the
// account was created if there was none).
func (r *UsersRepo) LoginFailuresSince(ctx context.Context, user *models.User) (LoginFailureSummary, error) {
	since := user.CreatedAt
	if user.SecurityAckAt != nil {
		since = *user.SecurityAckAt
	}
	var count int
	var last sql.NullString
	err := r.db.QueryRowContext(ctx, `SELECT COUNT(*), MAX(created_at) FROM login_failures WHERE created_at > ?`,
		since.UTC().Format(sqliteTimeFmt)).Scan(&count, &last)
	if err != nil {
		return LoginFailureSummary{}, fmt.Errorf("counting login failures: %w", err)
	}
	out := LoginFailureSummary{Count: count, Since: since}
	if last.Valid {
		t, err := parseSQLiteTime(last.String)
		if err != nil {
			return out, err
		}
		out.Last = &t
	}
	return out, nil
}

// AckSecurityNotice marks the failed-login notice as seen as of at.
func (r *UsersRepo) AckSecurityNotice(ctx context.Context, userID int64, at time.Time) error {
	_, err := r.db.ExecContext(ctx, `UPDATE users SET security_ack_at = ? WHERE id = ?`, at.UTC().Format(sqliteTimeFmt), userID)
	return err
}

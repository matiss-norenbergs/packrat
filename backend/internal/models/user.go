package models

import "time"

type User struct {
	ID           int64
	Username     string
	PasswordHash string
	CreatedAt    time.Time

	// Two-factor (TOTP) state. The secrets are AES-GCM ciphertext, never plaintext.
	TOTPSecretEnc  string
	TOTPPendingEnc string
	TOTPEnabled    bool
	TOTPLastStep   int64
	// SecurityAckAt is when the owner last dismissed the failed-login notice (nil = never).
	SecurityAckAt *time.Time
}

type Session struct {
	Token     string
	UserID    int64
	ExpiresAt time.Time
	CreatedAt time.Time
}

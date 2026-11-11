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

// Session is one signed-in device.
//
// Token rule: the database (and TokenHash) only ever holds hex(SHA-256(token)). Token is the RAW
// token the caller presented to UsersRepo.GetValidSession — it is copied from the lookup argument,
// never read from the database, so it is empty on sessions from ListSessions. It exists so
// handlers can re-set the cookie and so a WebSocket can re-check its own session; it lives in
// memory for the request only and must never be serialized or logged. UsersRepo methods take raw
// tokens and hash them themselves.
type Session struct {
	Token     string
	TokenHash string
	UserID    int64
	ExpiresAt time.Time
	CreatedAt time.Time

	// PublicID identifies the session in the API without exposing the token.
	PublicID string
	// LastSeenAt is nil until the first throttled touch after login.
	LastSeenAt *time.Time
	// Client is "web" or "desktop"; empty for sessions that predate the metadata columns.
	Client    string
	IP        string
	UserAgent string
}

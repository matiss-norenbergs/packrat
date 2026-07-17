package backup

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

const envelopeVersion = 1

// Envelope is the on-disk/in-transit shape of an exported backup file —
// the same struct whether the payload is encrypted or not, so the client
// can always parse the outer JSON to decide whether it needs to prompt for
// a password before handing the file back for import.
type Envelope struct {
	Packrat    bool   `json:"packrat"` // sentinel: lets Open() reject a random JSON file with a clear error
	Version    int    `json:"version"`
	Kind       string `json:"kind"` // "settings" | "library"
	ExportedAt string `json:"exportedAt"`
	Encrypted  bool   `json:"encrypted"`
	Salt       string `json:"salt,omitempty"` // base64, present only if encrypted
	Data       string `json:"data"`           // base64: plaintext bytes if !encrypted, else (nonce+ciphertext)
}

// Seal wraps plaintext (already-marshaled JSON bundle bytes) into an
// Envelope, encrypting it first when password is non-empty.
func Seal(kind string, plaintext []byte, password string) (Envelope, error) {
	env := Envelope{
		Packrat:    true,
		Version:    envelopeVersion,
		Kind:       kind,
		ExportedAt: time.Now().UTC().Format(time.RFC3339),
	}

	if password == "" {
		env.Data = base64.StdEncoding.EncodeToString(plaintext)
		return env, nil
	}

	salt, ciphertext, err := encrypt(plaintext, password)
	if err != nil {
		return Envelope{}, fmt.Errorf("encrypting export: %w", err)
	}
	env.Encrypted = true
	env.Salt = base64.StdEncoding.EncodeToString(salt)
	env.Data = base64.StdEncoding.EncodeToString(ciphertext)
	return env, nil
}

var (
	ErrNotPackratExport = errors.New("not a packrat export file")
	ErrWrongKind        = errors.New("wrong export type for this import")
)

// Open validates env and returns the plaintext bundle bytes, decrypting with
// password if the envelope is encrypted. Pass wantKind to enforce that a
// settings file can't be fed into a library import or vice versa.
func Open(env Envelope, wantKind, password string) ([]byte, error) {
	if !env.Packrat {
		return nil, ErrNotPackratExport
	}
	if env.Kind != wantKind {
		return nil, fmt.Errorf("%w: file is %q, expected %q", ErrWrongKind, env.Kind, wantKind)
	}

	data, err := base64.StdEncoding.DecodeString(env.Data)
	if err != nil {
		return nil, fmt.Errorf("decoding export data: %w", err)
	}

	if !env.Encrypted {
		return data, nil
	}

	salt, err := base64.StdEncoding.DecodeString(env.Salt)
	if err != nil {
		return nil, fmt.Errorf("decoding salt: %w", err)
	}
	return decrypt(salt, data, password)
}

// ParseEnvelope is a small convenience for handlers that receive the raw
// file text as a string (the frontend just does file.text() client-side).
func ParseEnvelope(raw string) (Envelope, error) {
	var env Envelope
	if err := json.Unmarshal([]byte(raw), &env); err != nil {
		return Envelope{}, fmt.Errorf("parsing export file: %w", err)
	}
	return env, nil
}

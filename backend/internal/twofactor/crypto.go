package twofactor

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Crypto protects TOTP secrets at rest (AES-256-GCM) and hashes recovery codes (HMAC-SHA256),
// both under one 32-byte key that never lives in the database.
type Crypto struct {
	key [32]byte
}

// NewCrypto builds a Crypto from raw key material (any length; hashed down to 32 bytes).
func NewCrypto(material []byte) *Crypto {
	return &Crypto{key: sha256.Sum256(material)}
}

// LoadCrypto resolves the key: the PACKRAT_SECRET_KEY env value when set, otherwise a hex key
// file at keyFilePath, generated (mode 0600) on first use. The default therefore lives next to
// the database, in the data volume.
func LoadCrypto(envValue, keyFilePath string) (*Crypto, error) {
	if envValue != "" {
		return NewCrypto([]byte(envValue)), nil
	}
	raw, err := os.ReadFile(keyFilePath)
	if err == nil {
		material, err := hex.DecodeString(strings.TrimSpace(string(raw)))
		if err != nil || len(material) != 32 {
			return nil, fmt.Errorf("key file %s is corrupt; if 2FA is lost, run --disable-2fa and delete it", keyFilePath)
		}
		return NewCrypto(material), nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("reading key file: %w", err)
	}
	material := make([]byte, 32)
	if _, err := rand.Read(material); err != nil {
		return nil, err
	}
	if err := os.WriteFile(keyFilePath, []byte(hex.EncodeToString(material)+"\n"), 0o600); err != nil {
		return nil, fmt.Errorf("writing key file: %w", err)
	}
	return NewCrypto(material), nil
}

func (c *Crypto) aead() (cipher.AEAD, error) {
	block, err := aes.NewCipher(c.key[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// aad binds a ciphertext to its owner so rows can't be swapped between users.
func aad(userID int64) []byte { return []byte("packrat-2fa:" + strconv.FormatInt(userID, 10)) }

// Seal encrypts plaintext for userID; the result is base64 (nonce || ciphertext).
func (c *Crypto) Seal(userID int64, plaintext string) (string, error) {
	g, err := c.aead()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, g.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(g.Seal(nonce, nonce, []byte(plaintext), aad(userID))), nil
}

// ErrCannotDecrypt means the stored secret doesn't open with the current key (key file lost or
// PACKRAT_SECRET_KEY changed). `packrat --disable-2fa` is the way out.
var ErrCannotDecrypt = errors.New("two-factor secret cannot be decrypted with the current key; run `packrat --disable-2fa`")

func (c *Crypto) Open(userID int64, sealed string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(sealed)
	if err != nil {
		return "", ErrCannotDecrypt
	}
	g, err := c.aead()
	if err != nil {
		return "", err
	}
	if len(raw) < g.NonceSize() {
		return "", ErrCannotDecrypt
	}
	pt, err := g.Open(nil, raw[:g.NonceSize()], raw[g.NonceSize():], aad(userID))
	if err != nil {
		return "", ErrCannotDecrypt
	}
	return string(pt), nil
}

// HashRecoveryCode returns the keyed hash stored for a normalised recovery code.
func (c *Crypto) HashRecoveryCode(normalised string) string {
	m := hmac.New(sha256.New, c.key[:])
	m.Write([]byte("recovery:" + normalised))
	return hex.EncodeToString(m.Sum(nil))
}

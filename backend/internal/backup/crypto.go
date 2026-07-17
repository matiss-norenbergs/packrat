package backup

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"fmt"

	"golang.org/x/crypto/scrypt"
)

const (
	saltLen = 16
	keyLen  = 32 // AES-256
)

// deriveKey turns a password + salt into a 32-byte AES key. Cost parameters
// match scrypt's own recommended interactive defaults (N=2^15, r=8, p=1) —
// this only needs to run once per export/import, not on a hot path, so the
// extra cost over weaker settings is free.
func deriveKey(password string, salt []byte) ([]byte, error) {
	return scrypt.Key([]byte(password), salt, 1<<15, 8, 1, keyLen)
}

// encrypt returns (salt, ciphertext) for plaintext under password. ciphertext
// has the GCM nonce prepended, so decrypt only needs the salt back alongside it.
func encrypt(plaintext []byte, password string) (salt, ciphertext []byte, err error) {
	salt = make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return nil, nil, fmt.Errorf("generating salt: %w", err)
	}

	key, err := deriveKey(password, salt)
	if err != nil {
		return nil, nil, fmt.Errorf("deriving key: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, nil, fmt.Errorf("creating cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, fmt.Errorf("creating GCM: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, nil, fmt.Errorf("generating nonce: %w", err)
	}

	ciphertext = gcm.Seal(nonce, nonce, plaintext, nil)
	return salt, ciphertext, nil
}

// ErrIncorrectPassword covers both a genuinely wrong password and a corrupt/
// tampered file — GCM's authentication tag can't distinguish the two, and
// neither can we, so callers should surface one user-facing message for both.
var ErrIncorrectPassword = errors.New("incorrect password or corrupt file")

func decrypt(salt, ciphertext []byte, password string) ([]byte, error) {
	key, err := deriveKey(password, salt)
	if err != nil {
		return nil, fmt.Errorf("deriving key: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("creating cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("creating GCM: %w", err)
	}

	if len(ciphertext) < gcm.NonceSize() {
		return nil, ErrIncorrectPassword
	}
	nonce, sealed := ciphertext[:gcm.NonceSize()], ciphertext[gcm.NonceSize():]

	plaintext, err := gcm.Open(nil, nonce, sealed, nil)
	if err != nil {
		return nil, ErrIncorrectPassword
	}
	return plaintext, nil
}

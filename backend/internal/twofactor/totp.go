// Package twofactor holds the TOTP, secret-at-rest, recovery-code and login-challenge pieces of
// two-factor auth. HTTP wiring lives in internal/api.
package twofactor

import (
	"time"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

const (
	// Issuer is what authenticator apps show above the account name.
	Issuer = "Packrat"
	// PeriodSeconds, Digits, secret size and SHA-1 are the RFC 6238 defaults every authenticator
	// app supports.
	PeriodSeconds = 30
	secretBytes   = 20 // 160 bits
	// DriftSteps is how many 30 s steps either side of "now" are accepted.
	DriftSteps = 1
)

// GenerateSecret makes a fresh secret, returning it base32-encoded plus the otpauth:// URL
// (issuer "Packrat", account = username) that authenticator apps read from a QR code.
func GenerateSecret(account string) (secret, otpauthURL string, err error) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      Issuer,
		AccountName: account,
		Period:      PeriodSeconds,
		SecretSize:  secretBytes,
		Digits:      otp.DigitsSix,
		Algorithm:   otp.AlgorithmSHA1,
	})
	if err != nil {
		return "", "", err
	}
	return key.Secret(), key.URL(), nil
}

// IsCodeFormat reports whether s is exactly six ASCII digits.
func IsCodeFormat(s string) bool {
	if len(s) != 6 {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// Verify checks code against secret at time now, accepting ±DriftSteps steps of clock drift, and
// returns the matching time step. A step at or below lastStep is rejected, so a code can never be
// used twice (nor can an older one once a newer one was accepted). The library compares in
// constant time; all candidate steps are always evaluated.
func Verify(secret, code string, now time.Time, lastStep int64) (step int64, ok bool) {
	if !IsCodeFormat(code) {
		return 0, false
	}
	current := now.Unix() / PeriodSeconds
	for off := int64(-DriftSteps); off <= DriftSteps; off++ {
		s := current + off
		valid, err := totp.ValidateCustom(code, secret, time.Unix(s*PeriodSeconds, 0), totp.ValidateOpts{
			Period:    PeriodSeconds,
			Skew:      0,
			Digits:    otp.DigitsSix,
			Algorithm: otp.AlgorithmSHA1,
		})
		if err == nil && valid && s > lastStep && !ok {
			step, ok = s, true
		}
	}
	return step, ok
}

// CodeAt returns the code for secret at t (tests and tooling).
func CodeAt(secret string, t time.Time) (string, error) {
	return totp.GenerateCodeCustom(secret, t, totp.ValidateOpts{
		Period: PeriodSeconds, Digits: otp.DigitsSix, Algorithm: otp.AlgorithmSHA1,
	})
}

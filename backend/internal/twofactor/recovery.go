package twofactor

import (
	"crypto/rand"
	"strings"
)

const (
	// RecoveryCodeCount codes are issued per set.
	RecoveryCodeCount = 10
	// recoveryAlphabet has 32 symbols (no I, O, 0, 1 to avoid misreading), so 8 characters carry
	// 40 bits.
	recoveryAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	recoveryLength   = 8
)

// GenerateRecoveryCodes returns n fresh codes formatted XXXX-XXXX.
func GenerateRecoveryCodes(n int) ([]string, error) {
	out := make([]string, 0, n)
	for len(out) < n {
		b := make([]byte, recoveryLength)
		if _, err := rand.Read(b); err != nil {
			return nil, err
		}
		var sb strings.Builder
		for i, v := range b {
			if i == recoveryLength/2 {
				sb.WriteByte('-')
			}
			sb.WriteByte(recoveryAlphabet[int(v)%len(recoveryAlphabet)]) // 256 % 32 == 0: unbiased
		}
		out = append(out, sb.String())
	}
	return out, nil
}

// NormalizeRecoveryCode upper-cases and drops dashes/whitespace, so "k7f2 9qxm" matches
// "K7F2-9QXM". It returns "" for input that can't be a recovery code.
func NormalizeRecoveryCode(in string) string {
	var sb strings.Builder
	for _, r := range strings.ToUpper(in) {
		switch {
		case r == '-' || r == ' ' || r == '\t':
		case strings.ContainsRune(recoveryAlphabet, r):
			sb.WriteRune(r)
		default:
			return ""
		}
	}
	if sb.Len() != recoveryLength {
		return ""
	}
	return sb.String()
}

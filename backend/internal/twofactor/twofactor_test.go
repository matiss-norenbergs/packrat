package twofactor

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// RFC 6238 test secret ("12345678901234567890") in base32.
const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

func TestVerifyKnownVectorAndDrift(t *testing.T) {
	at := time.Unix(59, 0) // RFC 6238: T=59 -> 94287082 (8 digits); last six digits 287082
	step, ok := Verify(rfcSecret, "287082", at, 0)
	if !ok || step != 1 {
		t.Fatalf("RFC vector: ok=%v step=%d", ok, step)
	}

	base := time.Unix(1_700_000_010, 0)
	baseStep := base.Unix() / PeriodSeconds
	code := func(offset int64) string {
		c, err := CodeAt(rfcSecret, time.Unix((baseStep+offset)*PeriodSeconds, 0))
		if err != nil {
			t.Fatal(err)
		}
		return c
	}
	for _, off := range []int64{-1, 0, 1} {
		if s, ok := Verify(rfcSecret, code(off), base, 0); !ok || s != baseStep+off {
			t.Errorf("offset %d: ok=%v step=%d", off, ok, s)
		}
	}
	for _, off := range []int64{-2, 2} {
		if _, ok := Verify(rfcSecret, code(off), base, 0); ok {
			t.Errorf("offset %d must be rejected", off)
		}
	}
}

func TestVerifyRejectsWrongMalformedAndReplayed(t *testing.T) {
	now := time.Unix(1_700_000_010, 0)
	good, _ := CodeAt(rfcSecret, now)
	wrong := "000000"
	if wrong == good {
		wrong = "000001"
	}
	for _, bad := range []string{wrong, "", "12345", "1234567", "12345a", good + " ", " " + good, "１２３４５６"} {
		if _, ok := Verify(rfcSecret, bad, now, 0); ok {
			t.Errorf("%q must be rejected", bad)
		}
	}
	step, ok := Verify(rfcSecret, good, now, 0)
	if !ok {
		t.Fatal("good code rejected")
	}
	if _, ok := Verify(rfcSecret, good, now, step); ok {
		t.Error("replaying the same step must be rejected")
	}
	// An older code is rejected once a newer step was used.
	older, _ := CodeAt(rfcSecret, now.Add(-PeriodSeconds*time.Second))
	if _, ok := Verify(rfcSecret, older, now, step); ok {
		t.Error("an earlier step than the last used must be rejected")
	}
}

func TestGenerateSecretShape(t *testing.T) {
	secret, url, err := GenerateSecret("admin")
	if err != nil {
		t.Fatal(err)
	}
	if len(secret) != 32 { // 20 bytes -> 32 base32 chars, no padding
		t.Errorf("secret length %d", len(secret))
	}
	for _, want := range []string{"otpauth://totp/Packrat:admin", "secret=" + secret, "issuer=Packrat", "period=30", "digits=6", "algorithm=SHA1"} {
		if !strings.Contains(url, want) {
			t.Errorf("url %q lacks %q", url, want)
		}
	}
}

func TestCryptoRoundTripAndBinding(t *testing.T) {
	c := NewCrypto([]byte("key"))
	sealed, err := c.Seal(7, "SECRET")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(sealed, "SECRET") {
		t.Fatal("ciphertext leaks plaintext")
	}
	if got, err := c.Open(7, sealed); err != nil || got != "SECRET" {
		t.Fatalf("open: %q %v", got, err)
	}
	if _, err := c.Open(8, sealed); err == nil {
		t.Error("ciphertext must be bound to its user")
	}
	if _, err := NewCrypto([]byte("other")).Open(7, sealed); err != ErrCannotDecrypt {
		t.Errorf("wrong key: %v", err)
	}
	if _, err := c.Open(7, "!!!"); err != ErrCannotDecrypt {
		t.Errorf("garbage: %v", err)
	}
	if c.HashRecoveryCode("ABCD2345") == NewCrypto([]byte("other")).HashRecoveryCode("ABCD2345") {
		t.Error("recovery hash must depend on the key")
	}
}

func TestLoadCryptoKeyFileAndEnv(t *testing.T) {
	path := filepath.Join(t.TempDir(), "k.key")
	a, err := LoadCrypto("", path)
	if err != nil {
		t.Fatal(err)
	}
	if st, err := os.Stat(path); err != nil || st.Size() == 0 {
		t.Fatalf("key file not created: %v", err)
	}
	b, err := LoadCrypto("", path)
	if err != nil {
		t.Fatal(err)
	}
	sealed, _ := a.Seal(1, "x")
	if got, err := b.Open(1, sealed); err != nil || got != "x" {
		t.Fatalf("reloaded key must match: %q %v", got, err)
	}
	// The env var wins and ignores (and doesn't create) the file.
	envPath := filepath.Join(t.TempDir(), "none.key")
	e, err := LoadCrypto("from-env", envPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(envPath); err == nil {
		t.Error("env key must not create a key file")
	}
	if _, err := e.Open(1, sealed); err == nil {
		t.Error("env key must differ from the file key")
	}
	os.WriteFile(path, []byte("not-hex"), 0o600)
	if _, err := LoadCrypto("", path); err == nil {
		t.Error("corrupt key file must be an error, not silently regenerated")
	}
}

func TestRecoveryCodes(t *testing.T) {
	codes, err := GenerateRecoveryCodes(RecoveryCodeCount)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, c := range codes {
		if len(c) != 9 || c[4] != '-' {
			t.Errorf("format %q", c)
		}
		if NormalizeRecoveryCode(c) != strings.ReplaceAll(c, "-", "") {
			t.Errorf("%q does not normalise to itself", c)
		}
		seen[c] = true
	}
	if len(seen) != RecoveryCodeCount {
		t.Error("duplicate codes")
	}
	for in, want := range map[string]string{"k7f2-9qxm": "K7F29QXM", " K7F2 9QXM ": "K7F29QXM", "K7F29QXM": "K7F29QXM", "K7F2-9QX": "", "K7F2-9QXO": "", "": ""} {
		if got := NormalizeRecoveryCode(in); got != want {
			t.Errorf("%q: got %q want %q", in, got, want)
		}
	}
}

type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

func TestChallengeSingleUseExpiryAndAttempts(t *testing.T) {
	ck := &clock{time.Unix(1_700_000_000, 0)}
	s := NewChallenges(ck.now)

	tok, _ := s.Create(5)
	if uid, ok := s.Lookup(tok); !ok || uid != 5 {
		t.Fatal("lookup")
	}
	if !s.Consume(tok) {
		t.Fatal("first consume must succeed")
	}
	if s.Consume(tok) {
		t.Fatal("a challenge is single use")
	}
	if _, ok := s.Lookup(tok); ok {
		t.Fatal("consumed challenge still resolves")
	}

	tok, _ = s.Create(5)
	for i := 1; i < ChallengeMaxAttempts; i++ {
		if s.Fail(tok) {
			t.Fatalf("destroyed after only %d wrong codes", i)
		}
	}
	if !s.Fail(tok) {
		t.Fatalf("must be destroyed on wrong code %d", ChallengeMaxAttempts)
	}
	if s.Consume(tok) {
		t.Fatal("a destroyed challenge can't be consumed even with the right code")
	}

	tok, _ = s.Create(5)
	ck.t = ck.t.Add(ChallengeTTL - time.Second)
	if _, ok := s.Lookup(tok); !ok {
		t.Fatal("should still be live just before the TTL")
	}
	ck.t = ck.t.Add(2 * time.Second)
	if _, ok := s.Lookup(tok); ok {
		t.Fatal("must expire after the TTL")
	}
	if _, ok := s.Lookup("not-a-token"); ok {
		t.Fatal("unknown token")
	}
}

func TestChallengeStoreIsBounded(t *testing.T) {
	s := NewChallenges(nil)
	first, _ := s.Create(1)
	for i := 0; i < maxChallenges+10; i++ {
		s.Create(1)
	}
	if len(s.items) > maxChallenges {
		t.Fatalf("%d challenges held", len(s.items))
	}
	if _, ok := s.Lookup(first); ok {
		t.Fatal("oldest should have been evicted")
	}
}

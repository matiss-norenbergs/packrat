package admincmd

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"packrat/backend/internal/db"
	"packrat/backend/internal/repository"
)

func newUsers(t *testing.T) *repository.UsersRepo {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	dir, _ := filepath.Abs("../../../database/migrations")
	if err := db.Migrate(conn, dir); err != nil {
		t.Fatal(err)
	}
	return repository.NewUsersRepo(conn)
}

func TestParseArgs(t *testing.T) {
	cases := []struct {
		args    []string
		cmd     Command
		stdin   bool
		wantErr bool
	}{
		{nil, CommandNone, false, false},
		{[]string{"--reset-password"}, CommandResetPassword, false, false},
		{[]string{"--reset-password", "--password-stdin"}, CommandResetPassword, true, false},
		{[]string{"--disable-2fa"}, CommandDisable2FA, false, false},
		{[]string{"--password-stdin"}, CommandNone, false, true},
		{[]string{"--disable-2fa", "--password-stdin"}, CommandNone, false, true},
		{[]string{"--reset-password", "--disable-2fa"}, CommandNone, false, true},
		{[]string{"--reset-password=hunter2"}, CommandNone, false, true}, // never a password argument
		{[]string{"--bogus"}, CommandNone, false, true},
	}
	for _, tc := range cases {
		cmd, stdin, err := ParseArgs(tc.args)
		if (err != nil) != tc.wantErr || cmd != tc.cmd || stdin != tc.stdin {
			t.Errorf("%v: got (%v, %v, %v)", tc.args, cmd, stdin, err)
		}
	}
}

func TestReadPasswordLine(t *testing.T) {
	for in, want := range map[string]string{"s3cret-pass\n": "s3cret-pass", "s3cret-pass\r\n": "s3cret-pass", "no-newline": "no-newline", " spaced \n": " spaced "} {
		got, err := ReadPasswordLine(strings.NewReader(in))
		if err != nil || got != want {
			t.Errorf("%q: got %q, %v", in, got, err)
		}
	}
	if _, err := ReadPasswordLine(strings.NewReader("")); err == nil {
		t.Error("empty stdin must be an error")
	}
}

func TestResetPasswordChangesHashAndDeletesSessions(t *testing.T) {
	users := newUsers(t)
	ctx := context.Background()
	hash, _ := bcrypt.GenerateFromPassword([]byte("old-password"), bcrypt.MinCost)
	u, err := users.Create(ctx, "admin", string(hash))
	if err != nil {
		t.Fatal(err)
	}
	for _, tok := range []string{"a", "b"} {
		if err := users.CreateSession(ctx, tok, u.ID, time.Now().Add(time.Hour), repository.SessionMeta{}); err != nil {
			t.Fatal(err)
		}
	}

	if err := ResetPassword(ctx, users, "short"); err == nil {
		t.Fatal("short password must be rejected")
	}
	if n, _ := users.CountSessions(ctx); n != 2 {
		t.Fatalf("a rejected reset must leave sessions alone, have %d", n)
	}

	if err := ResetPassword(ctx, users, "brand-new-password"); err != nil {
		t.Fatal(err)
	}
	got, _ := users.GetByID(ctx, u.ID)
	if bcrypt.CompareHashAndPassword([]byte(got.PasswordHash), []byte("brand-new-password")) != nil {
		t.Fatal("new password not stored")
	}
	if n, _ := users.CountSessions(ctx); n != 0 {
		t.Fatalf("sessions must be deleted, %d left", n)
	}
}

func TestDisable2FAClearsEverythingAndDeletesSessions(t *testing.T) {
	users := newUsers(t)
	ctx := context.Background()
	u, _ := users.Create(ctx, "admin", "hash")
	if err := users.SetPendingTOTP(ctx, u.ID, "pending-ct"); err != nil {
		t.Fatal(err)
	}
	if err := users.EnableTOTP(ctx, u.ID, "secret-ct", 99, []string{"h1", "h2"}); err != nil {
		t.Fatal(err)
	}
	if err := users.SetPendingTOTP(ctx, u.ID, "pending-again"); err != nil {
		t.Fatal(err)
	}
	if err := users.CreateSession(ctx, "tok", u.ID, time.Now().Add(time.Hour), repository.SessionMeta{}); err != nil {
		t.Fatal(err)
	}

	if err := Disable2FA(ctx, users); err != nil {
		t.Fatal(err)
	}
	got, _ := users.GetByID(ctx, u.ID)
	if got.TOTPEnabled || got.TOTPSecretEnc != "" || got.TOTPPendingEnc != "" || got.TOTPLastStep != 0 {
		t.Fatalf("2FA state not cleared: %+v", got)
	}
	if n, _ := users.CountRecoveryCodes(ctx, u.ID); n != 0 {
		t.Fatalf("%d recovery codes left", n)
	}
	if n, _ := users.CountSessions(ctx); n != 0 {
		t.Fatalf("%d sessions left", n)
	}
}

func TestCommandsWithoutAnAccount(t *testing.T) {
	users := newUsers(t)
	if err := ResetPassword(context.Background(), users, "long-enough-pass"); err == nil {
		t.Error("reset without an account must fail")
	}
	if err := Disable2FA(context.Background(), users); err == nil {
		t.Error("disable without an account must fail")
	}
}

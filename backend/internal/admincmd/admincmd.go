// Package admincmd implements the host-side recovery commands of the server binary
// (--reset-password, --disable-2fa). They act straight on the database and need neither the
// running server nor the 2FA encryption key.
package admincmd

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"

	"packrat/backend/internal/repository"
)

// MinPasswordLength matches the first-run setup form.
const MinPasswordLength = 8

type Command int

const (
	CommandNone Command = iota
	CommandResetPassword
	CommandDisable2FA
)

// Usage is printed on a bad invocation.
const Usage = `usage:
  packrat                              start the server
  packrat --reset-password             set a new password (prompts twice; use "docker exec -it")
  packrat --reset-password --password-stdin
                                       read the new password from stdin instead
  packrat --disable-2fa                turn two-factor auth off for the account
Both commands also sign out every session.`

// ParseArgs interprets the command line (without the program name). No arguments means "run the
// server". The password is never accepted as an argument — it would land in shell history and
// the process list.
func ParseArgs(args []string) (cmd Command, passwordStdin bool, err error) {
	for _, a := range args {
		switch a {
		case "--reset-password", "-reset-password":
			if cmd != CommandNone && cmd != CommandResetPassword {
				return CommandNone, false, errors.New("choose one command")
			}
			cmd = CommandResetPassword
		case "--disable-2fa", "-disable-2fa":
			if cmd != CommandNone && cmd != CommandDisable2FA {
				return CommandNone, false, errors.New("choose one command")
			}
			cmd = CommandDisable2FA
		case "--password-stdin", "-password-stdin":
			passwordStdin = true
		default:
			return CommandNone, false, fmt.Errorf("unknown argument %q", a)
		}
	}
	if cmd == CommandNone && len(args) > 0 {
		return CommandNone, false, errors.New("--password-stdin only goes with --reset-password")
	}
	if passwordStdin && cmd != CommandResetPassword {
		return CommandNone, false, errors.New("--password-stdin only goes with --reset-password")
	}
	return cmd, passwordStdin, nil
}

// ValidatePassword applies the same rule as first-run setup.
func ValidatePassword(password string) error {
	if utf8.RuneCountInString(password) < MinPasswordLength {
		return fmt.Errorf("password must be at least %d characters", MinPasswordLength)
	}
	return nil
}

// ReadPasswordLine reads one line (the --password-stdin path), trimming only the line ending.
func ReadPasswordLine(r io.Reader) (string, error) {
	line, err := bufio.NewReader(r).ReadString('\n')
	if err != nil && !(errors.Is(err, io.EOF) && line != "") {
		return "", errors.New("no password on stdin")
	}
	return strings.TrimRight(line, "\r\n"), nil
}

// ResetPassword sets the account's password and signs out every session.
func ResetPassword(ctx context.Context, users *repository.UsersRepo, password string) error {
	if err := ValidatePassword(password); err != nil {
		return err
	}
	user, err := users.First(ctx)
	if errors.Is(err, repository.ErrNotFound) {
		return errors.New("no account exists yet; open the web UI to create it")
	}
	if err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return users.AdminResetPassword(ctx, user.ID, string(hash))
}

// Disable2FA clears the secret, pending secret and recovery codes and signs out every session.
func Disable2FA(ctx context.Context, users *repository.UsersRepo) error {
	user, err := users.First(ctx)
	if errors.Is(err, repository.ErrNotFound) {
		return errors.New("no account exists yet")
	}
	if err != nil {
		return err
	}
	return users.AdminDisableTOTP(ctx, user.ID)
}

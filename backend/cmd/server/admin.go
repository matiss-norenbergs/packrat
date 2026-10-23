package main

import (
	"context"
	"errors"
	"fmt"
	"os"

	"golang.org/x/term"

	"packrat/backend/internal/admincmd"
	"packrat/backend/internal/config"
	"packrat/backend/internal/db"
	"packrat/backend/internal/repository"
)

// runAdmin handles the host-side recovery commands. It returns handled=false when args ask for
// nothing special (start the server); otherwise the process should exit with err's status.
func runAdmin(args []string) (handled bool, err error) {
	cmd, passwordStdin, err := admincmd.ParseArgs(args)
	if err != nil {
		return true, fmt.Errorf("%w\n\n%s", err, admincmd.Usage)
	}
	if cmd == admincmd.CommandNone {
		return false, nil
	}

	// Collect the password before touching the database so a typo costs nothing.
	var password string
	if cmd == admincmd.CommandResetPassword {
		if password, err = readNewPassword(passwordStdin); err != nil {
			return true, err
		}
	}

	cfg, err := config.Load()
	if err != nil {
		return true, err
	}
	conn, err := db.Open(cfg.DBPath)
	if err != nil {
		return true, err
	}
	defer conn.Close()
	// Migrate too, so the command works on a database the new version hasn't started against yet.
	if err := db.Migrate(conn, migrationsDir()); err != nil {
		return true, err
	}
	users := repository.NewUsersRepo(conn)
	ctx := context.Background()

	switch cmd {
	case admincmd.CommandResetPassword:
		if err := admincmd.ResetPassword(ctx, users, password); err != nil {
			return true, err
		}
		fmt.Fprintln(os.Stderr, "Password updated. All sessions were signed out.")
	case admincmd.CommandDisable2FA:
		if err := admincmd.Disable2FA(ctx, users); err != nil {
			return true, err
		}
		fmt.Fprintln(os.Stderr, "Two-factor authentication disabled and recovery codes removed. All sessions were signed out.")
	}
	return true, nil
}

func readNewPassword(fromStdin bool) (string, error) {
	if fromStdin {
		password, err := admincmd.ReadPasswordLine(os.Stdin)
		if err != nil {
			return "", err
		}
		return password, admincmd.ValidatePassword(password)
	}
	fd := int(os.Stdin.Fd())
	if !term.IsTerminal(fd) {
		return "", errors.New("no terminal to prompt on; run with `docker exec -it`, or pass --password-stdin")
	}
	fmt.Fprint(os.Stderr, "New password: ")
	first, err := term.ReadPassword(fd)
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return "", err
	}
	if err := admincmd.ValidatePassword(string(first)); err != nil {
		return "", err
	}
	fmt.Fprint(os.Stderr, "Repeat password: ")
	second, err := term.ReadPassword(fd)
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return "", err
	}
	if string(first) != string(second) {
		return "", errors.New("passwords do not match")
	}
	return string(first), nil
}

func migrationsDir() string {
	if dir := os.Getenv("MIGRATIONS_DIR"); dir != "" {
		return dir
	}
	return "../database/migrations"
}

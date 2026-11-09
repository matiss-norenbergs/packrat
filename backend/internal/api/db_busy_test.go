package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"packrat/backend/internal/db"
	"packrat/backend/internal/models"
)

// A write that cannot get the database's write lock within the busy timeout must
// reach the client as 503 + Retry-After with a short message, never as a 500
// carrying SQLite's own text, and nothing may be half done. Once the lock is
// free the same request succeeds.
func TestBusyDatabaseAnswers503NotRaw500(t *testing.T) {
	e := newBkEnv(t)
	ctx := context.Background()

	// Shrink the handler's pool to one connection with a short busy timeout (15 s
	// in production) and hold the write lock from a second pool on the same file.
	e.conn.SetMaxOpenConns(1)
	if _, err := e.conn.Exec(`PRAGMA busy_timeout = 100`); err != nil {
		t.Fatal(err)
	}
	var seq int
	var name, file string
	if err := e.conn.QueryRow(`PRAGMA database_list`).Scan(&seq, &name, &file); err != nil {
		t.Fatal(err)
	}
	holderDB, err := db.Open(file)
	if err != nil {
		t.Fatal(err)
	}
	defer holderDB.Close()

	id := e.download(models.StatusCompleted)
	body := bkJSON(t, map[string]any{"ids": []int64{id}})

	tx, err := holderDB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	// A transaction (bulk delete) and a plain write (settings) both hit the lock.
	for _, tc := range []struct{ name, method, path, body string }{
		{"bulk delete (transaction)", http.MethodPost, "/api/downloads/bulk-delete", body},
		{"settings save (transaction)", http.MethodPatch, "/api/settings", `{"maxConcurrentDownloads":2}`},
	} {
		w := e.send(tc.method, tc.path, tc.body, true)
		if w.Code != http.StatusServiceUnavailable {
			tx.Rollback()
			t.Fatalf("%s: status = %d, want 503: %s", tc.name, w.Code, w.Body)
		}
		if w.Header().Get("Retry-After") == "" {
			t.Errorf("%s: no Retry-After header", tc.name)
		}
		if msg := w.Body.String(); !strings.Contains(msg, databaseBusyMessage) || strings.Contains(strings.ToLower(msg), "sqlite") || strings.Contains(msg, "locked") {
			t.Errorf("%s: body %q should be the short retry message only", tc.name, msg)
		}
	}
	if _, err := e.downloads.Get(ctx, id); err != nil {
		t.Errorf("the download was removed by a request that answered 503: %v", err)
	}

	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	w := e.post("/downloads/bulk-delete", body)
	e.want(w, http.StatusOK)
	if _, err := e.downloads.Get(ctx, id); err == nil {
		t.Error("download still exists after the successful retry")
	}
}

func TestServerErrorStatus(t *testing.T) {
	if s, msg := serverErrorStatus(errors.New("boom")); s != http.StatusInternalServerError || msg != "boom" {
		t.Errorf("plain error: %d %q", s, msg)
	}
	busy := fmt.Errorf("saving: %w", errors.New("database is locked (5) (SQLITE_BUSY)"))
	if s, msg := serverErrorStatus(busy); s != http.StatusServiceUnavailable || msg != databaseBusyMessage {
		t.Errorf("busy error: %d %q", s, msg)
	}
}

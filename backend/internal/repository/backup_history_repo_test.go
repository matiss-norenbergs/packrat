package repository

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"packrat/backend/internal/db"
	"packrat/backend/internal/models"
)

func openBackupHistoryTest(t *testing.T) (*BackupHistoryRepo, *sql.DB) {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "packrat_test.db"))
	if err != nil {
		t.Fatalf("opening test db: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	migrationsDir, err := filepath.Abs("../../../database/migrations")
	if err != nil {
		t.Fatalf("resolving migrations dir: %v", err)
	}
	if err := db.Migrate(conn, migrationsDir); err != nil {
		t.Fatalf("migrating test db: %v", err)
	}
	return NewBackupHistoryRepo(conn), conn
}

// seedBackupRows inserts rows oldest-first, alternating success/failed
// pattern given by statuses, one minute apart; returns ids in insert order.
func seedBackupRows(t *testing.T, repo *BackupHistoryRepo, conn *sql.DB, statuses []string) []int64 {
	t.Helper()
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	var ids []int64
	for i, st := range statuses {
		e := models.BackupHistory{TriggerType: "scheduled", Status: st}
		if st == "success" {
			name := fmt.Sprintf("backup-%d.json", i)
			e.FileName = &name
		} else {
			msg := "boom"
			e.ErrorMessage = &msg
		}
		id, err := repo.Create(ctx, e)
		if err != nil {
			t.Fatalf("create: %v", err)
		}
		ts := base.Add(time.Duration(i) * time.Minute).Format("2006-01-02 15:04:05")
		if _, err := conn.ExecContext(ctx, `UPDATE backup_history SET created_at = ? WHERE id = ?`, ts, id); err != nil {
			t.Fatalf("set created_at: %v", err)
		}
		ids = append(ids, id)
	}
	return ids
}

func remainingBackupIDs(t *testing.T, repo *BackupHistoryRepo, status string) map[int64]bool {
	t.Helper()
	all, err := repo.List(context.Background())
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	out := map[int64]bool{}
	for _, e := range all {
		if e.Status == status {
			out[e.ID] = true
		}
	}
	return out
}

func TestBackupHistoryRepo_PruneByStatus(t *testing.T) {
	ctx := context.Background()
	repo, conn := openBackupHistoryTest(t)

	// 10 successes interleaved with 30 failures: pattern s,f,f,f repeated.
	var statuses []string
	for i := 0; i < 10; i++ {
		statuses = append(statuses, "success", "failed", "failed", "failed")
	}
	ids := seedBackupRows(t, repo, conn, statuses)

	deleted, err := repo.DeleteSuccessfulExceedingRetention(ctx, 4)
	if err != nil {
		t.Fatal(err)
	}
	if len(deleted) != 6 {
		t.Fatalf("deleted %d successes, want 6", len(deleted))
	}
	for _, d := range deleted {
		if d.Status != "success" || d.FileName == nil {
			t.Fatalf("unexpected deleted row %+v", d)
		}
	}
	if got := len(remainingBackupIDs(t, repo, "failed")); got != 30 {
		t.Fatalf("failed rows = %d after success prune, want 30 untouched", got)
	}
	keptS := remainingBackupIDs(t, repo, "success")
	for _, i := range []int{36, 32, 28, 24} { // newest four successes
		if !keptS[ids[i]] {
			t.Errorf("newest success %d missing", ids[i])
		}
	}
	if len(keptS) != 4 {
		t.Fatalf("kept %d successes, want 4", len(keptS))
	}

	deleted, err = repo.DeleteFailedExceedingRetention(ctx, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(deleted) != 10 {
		t.Fatalf("deleted %d failed, want 10", len(deleted))
	}
	for _, d := range deleted {
		if d.Status != "failed" {
			t.Fatalf("deleted non-failed row %+v", d)
		}
	}
	keptF := remainingBackupIDs(t, repo, "failed")
	if len(keptF) != 20 {
		t.Fatalf("kept %d failed, want 20", len(keptF))
	}
	if !keptF[ids[39]] || keptF[ids[1]] {
		t.Errorf("failed pruning kept the wrong rows")
	}
	if got := len(remainingBackupIDs(t, repo, "success")); got != 4 {
		t.Fatalf("successes = %d after failed prune, want 4", got)
	}
}

func TestBackupHistoryRepo_SameSecondTieBreak(t *testing.T) {
	ctx := context.Background()
	repo, conn := openBackupHistoryTest(t)
	ids := seedBackupRows(t, repo, conn, []string{"failed", "failed", "failed"})
	if _, err := conn.ExecContext(ctx, `UPDATE backup_history SET created_at = '2026-01-01 00:00:00'`); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.DeleteFailedExceedingRetention(ctx, 1); err != nil {
		t.Fatal(err)
	}
	kept := remainingBackupIDs(t, repo, "failed")
	if len(kept) != 1 || !kept[ids[2]] {
		t.Fatalf("expected only newest id %d kept, got %v", ids[2], kept)
	}
}

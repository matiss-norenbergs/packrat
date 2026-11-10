package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// --- pool setup -------------------------------------------------------------

// Every pragma in the DSN must be applied to EVERY connection the pool opens,
// not just the first: foreign keys in particular are per connection, and one
// connection without them would silently skip ON DELETE actions and checks.
func TestEveryPooledConnectionGetsTheSetup(t *testing.T) {
	conn := openTest(t)
	conns, release := pinAllConns(t, conn)
	defer release()

	if got := conn.Stats().OpenConnections; got != MaxOpenConns {
		t.Fatalf("pool holds %d connections, want %d (the test would not prove anything)", got, MaxOpenConns)
	}
	for i, c := range conns {
		var fk, busy int
		var mode string
		ctx := context.Background()
		if err := c.QueryRowContext(ctx, "PRAGMA foreign_keys").Scan(&fk); err != nil {
			t.Fatal(err)
		}
		if err := c.QueryRowContext(ctx, "PRAGMA busy_timeout").Scan(&busy); err != nil {
			t.Fatal(err)
		}
		if err := c.QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&mode); err != nil {
			t.Fatal(err)
		}
		if fk != 1 {
			t.Errorf("connection %d: foreign_keys = %d, want 1", i, fk)
		}
		if want := int(BusyTimeout.Milliseconds()); busy != want {
			t.Errorf("connection %d: busy_timeout = %d, want %d", i, busy, want)
		}
		if mode != "wal" {
			t.Errorf("connection %d: journal_mode = %q, want wal", i, mode)
		}
	}
}

// A foreign key violation must fail on whichever connection the statement lands.
func TestForeignKeysEnforcedOnEveryConnection(t *testing.T) {
	conn := openTest(t)
	mustExec(t, conn, "CREATE TABLE p (id INTEGER PRIMARY KEY)")
	mustExec(t, conn, "CREATE TABLE c (id INTEGER PRIMARY KEY, p INTEGER REFERENCES p(id))")
	conns, release := pinAllConns(t, conn)
	defer release()
	for i, c := range conns {
		if _, err := c.ExecContext(context.Background(), "INSERT INTO c (p) VALUES (999)"); err == nil {
			t.Errorf("connection %d accepted a row with a dangling foreign key", i)
		}
	}
}

// --- the point of the change ---------------------------------------------------

// While a write transaction is open (it holds the write lock), reads on other
// connections must complete. With a single connection they waited for the
// commit. The transaction is only committed AFTER the reads are done, so this
// does not depend on timing: a blocked read fails the test by timeout.
func TestReadsDoNotWaitForAnOpenWriteTransaction(t *testing.T) {
	conn := openTest(t)
	mustExec(t, conn, "CREATE TABLE t (x INTEGER)")
	mustExec(t, conn, "INSERT INTO t VALUES (1)")

	tx, err := conn.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec("INSERT INTO t VALUES (2)"); err != nil {
		t.Fatal(err)
	}

	const readers, perReader = 12, 25
	var wg sync.WaitGroup
	errs := make(chan error, readers)
	for r := 0; r < readers; r++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < perReader; i++ {
				var n int
				if err := conn.QueryRow("SELECT COUNT(*) FROM t").Scan(&n); err != nil {
					errs <- err
					return
				}
				if n != 1 { // the open transaction's row is not visible yet
					errs <- fmt.Errorf("read saw %d rows, want 1 (committed state only)", n)
					return
				}
			}
		}()
	}
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("reads are blocked behind an open write transaction")
	}
	close(errs)
	for err := range errs {
		t.Error(err)
	}

	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if n := count(t, conn, "SELECT COUNT(*) FROM t"); n != 2 {
		t.Errorf("after commit: %d rows, want 2", n)
	}
}

// Transactions that read a value and then write it back (the check-then-update
// shape used all over the repositories) must not lose updates and must not fail
// with SQLITE_BUSY. That is what _txlock=immediate buys: a deferred transaction
// that read, then found another connection had committed, fails instantly.
func TestConcurrentReadModifyWriteTransactionsLoseNothing(t *testing.T) {
	conn := openTest(t)
	mustExec(t, conn, "CREATE TABLE counter (id INTEGER PRIMARY KEY, v INTEGER NOT NULL)")
	mustExec(t, conn, "INSERT INTO counter VALUES (1, 0)")

	const workers, perWorker = 8, 40
	var wg sync.WaitGroup
	errs := make(chan error, workers*perWorker)
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < perWorker; i++ {
				tx, err := conn.BeginTx(context.Background(), nil)
				if err != nil {
					errs <- err
					return
				}
				var v int
				if err := tx.QueryRow("SELECT v FROM counter WHERE id = 1").Scan(&v); err != nil {
					tx.Rollback()
					errs <- err
					return
				}
				if _, err := tx.Exec("UPDATE counter SET v = ? WHERE id = 1", v+1); err != nil {
					tx.Rollback()
					errs <- err
					return
				}
				if err := tx.Commit(); err != nil {
					errs <- err
					return
				}
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Errorf("transaction failed: %v (busy=%v)", err, IsBusy(err))
	}
	if got := count(t, conn, "SELECT v FROM counter WHERE id = 1"); got != workers*perWorker {
		t.Errorf("counter = %d, want %d: updates were lost", got, workers*perWorker)
	}
}

// Control for the test above: this is the failure the default (deferred) BEGIN
// has, which is why Open sets _txlock=immediate. Reads on a deferred transaction
// take a snapshot; a write that commits after it makes the later write fail
// with BUSY at once, busy_timeout or not.
func TestDeferredReadThenWriteFailsWithoutImmediate(t *testing.T) {
	conn := openTest(t)
	mustExec(t, conn, "CREATE TABLE t (x INTEGER)")
	mustExec(t, conn, "INSERT INTO t VALUES (1)")

	a, err := conn.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	// A raw BEGIN is deferred: the driver's _txlock only applies to BeginTx.
	if _, err := a.ExecContext(context.Background(), "BEGIN"); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := a.QueryRowContext(context.Background(), "SELECT COUNT(*) FROM t").Scan(&n); err != nil {
		t.Fatal(err)
	}
	mustExec(t, conn, "INSERT INTO t VALUES (2)") // another connection commits
	start := time.Now()
	_, err = a.ExecContext(context.Background(), "INSERT INTO t VALUES (3)")
	if !IsBusy(err) {
		t.Fatalf("deferred read-then-write err = %v, want a busy error", err)
	}
	if time.Since(start) > BusyTimeout/2 {
		t.Errorf("failed after %v: expected an immediate failure that busy_timeout cannot help", time.Since(start))
	}
	a.ExecContext(context.Background(), "ROLLBACK")
}

// BeginTx takes the write lock up front: a second transaction cannot begin
// until the first one ends.
func TestBeginTxTakesTheWriteLock(t *testing.T) {
	conn := openTest(t)
	mustExec(t, conn, "CREATE TABLE t (x INTEGER)")

	first, err := conn.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Rollback()

	var secondBegan atomic.Bool
	secondDone := make(chan error, 1)
	go func() {
		tx, err := conn.BeginTx(context.Background(), nil)
		if err == nil {
			secondBegan.Store(true)
			err = tx.Commit()
		}
		secondDone <- err
	}()

	time.Sleep(300 * time.Millisecond)
	if secondBegan.Load() {
		t.Fatal("a second transaction began while the first still held the write lock")
	}
	if err := first.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-secondDone:
		if err != nil {
			t.Fatalf("second transaction: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("second transaction never got the write lock after the first committed")
	}

	// A read-only transaction does not take it.
	hold, err := conn.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer hold.Rollback()
	ro, err := conn.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("read-only transaction while a writer is open: %v", err)
	}
	ro.Rollback()
}

// --- rebuild migrations on a warm pool -------------------------------------------

// The rebuild migration must still run with foreign keys off when the pool has
// several (idle, warm) connections and readers are active: no ON DELETE
// CASCADE / SET NULL action may fire on the sibling tables, no reader may see
// an error, and every pooled connection must have foreign keys on afterwards.
func TestRebuildOnAWarmPoolKeepsSiblingsAndForeignKeys(t *testing.T) {
	conn, dir := seeded(t)
	_, release := pinAllConns(t, conn) // open every connection of the pool
	release()
	if got := conn.Stats().OpenConnections; got != MaxOpenConns {
		t.Fatalf("pool holds %d connections, want %d", got, MaxOpenConns)
	}

	stop := make(chan struct{})
	var wg sync.WaitGroup
	readErrs := make(chan error, 64)
	for r := 0; r < 4; r++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				var n int
				if err := conn.QueryRow("SELECT COUNT(*) FROM kids").Scan(&n); err != nil {
					select {
					case readErrs <- err:
					default:
					}
					return
				}
				if n != 1 {
					select {
					case readErrs <- fmt.Errorf("reader saw %d kids, want 1", n):
					default:
					}
					return
				}
			}
		}()
	}

	writeFile(t, dir, "000002_rebuild.up.sql", rebuildUp)
	err := Migrate(conn, dir)
	close(stop)
	wg.Wait()
	close(readErrs)
	if err != nil {
		t.Fatal(err)
	}
	for e := range readErrs {
		t.Errorf("reader during rebuild: %v", e)
	}

	if n := count(t, conn, "SELECT COUNT(*) FROM parents WHERE extra = 'x'"); n != 1 {
		t.Errorf("parents rebuilt rows = %d", n)
	}
	if n := count(t, conn, "SELECT COUNT(*) FROM kids"); n != 1 {
		t.Errorf("kids (ON DELETE CASCADE) = %d rows, want 1: foreign keys were on during the rebuild", n)
	}
	if n := count(t, conn, "SELECT COUNT(*) FROM notes WHERE parent_id = 1"); n != 1 {
		t.Errorf("notes (ON DELETE SET NULL) keeping parent_id = %d rows, want 1: foreign keys were on during the rebuild", n)
	}
	assertHealthy(t, conn)
}

// --- busy errors ---------------------------------------------------------------

// lockWrites holds the write lock on a separate connection and returns a
// function that releases it, plus a connection whose busy timeout is short so
// a blocked write fails quickly.
func lockWrites(t *testing.T, conn *sql.DB) (shortBusy *sql.Conn, unlock func()) {
	t.Helper()
	ctx := context.Background()
	holder, err := conn.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := holder.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		t.Fatal(err)
	}
	short, err := conn.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := short.ExecContext(ctx, "PRAGMA busy_timeout = 50"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		short.ExecContext(ctx, "PRAGMA busy_timeout = 15000") // the connection goes back to the pool
		short.Close()
		holder.Close()
	})
	return short, func() {
		if _, err := holder.ExecContext(ctx, "ROLLBACK"); err != nil {
			t.Error(err)
		}
	}
}

func TestIsBusy(t *testing.T) {
	conn := openTest(t)
	mustExec(t, conn, "CREATE TABLE t (x INTEGER UNIQUE)")
	mustExec(t, conn, "INSERT INTO t VALUES (1)")

	short, unlock := lockWrites(t, conn)
	_, busyErr := short.ExecContext(context.Background(), "INSERT INTO t VALUES (2)")
	unlock()
	if !IsBusy(busyErr) {
		t.Fatalf("a write blocked by another connection's write lock: IsBusy(%v) = false", busyErr)
	}
	if !IsBusy(fmt.Errorf("saving things: %w", busyErr)) {
		t.Error("IsBusy must see through wrapping")
	}
	if !IsBusy(errors.New("x: database is locked (5) (SQLITE_BUSY)")) {
		t.Error("IsBusy must recognise the message when the error type was lost")
	}

	_, uniqueErr := conn.Exec("INSERT INTO t VALUES (1)")
	if uniqueErr == nil || IsBusy(uniqueErr) {
		t.Errorf("a constraint violation is not busy: err=%v", uniqueErr)
	}
	for _, err := range []error{nil, context.Canceled, context.DeadlineExceeded, sql.ErrNoRows, errors.New("boom")} {
		if IsBusy(err) {
			t.Errorf("IsBusy(%v) = true", err)
		}
	}
}

func TestRetryBusyRetriesUntilTheLockIsFree(t *testing.T) {
	conn := openTest(t)
	mustExec(t, conn, "CREATE TABLE t (x INTEGER)")
	short, unlock := lockWrites(t, conn)

	go func() {
		time.Sleep(400 * time.Millisecond)
		unlock()
	}()
	attempts := 0
	err := RetryBusy(context.Background(), func() error {
		attempts++
		_, err := short.ExecContext(context.Background(), "INSERT INTO t VALUES (1)")
		return err
	})
	if err != nil {
		t.Fatalf("RetryBusy: %v", err)
	}
	if attempts < 2 {
		t.Errorf("attempts = %d, want the first to hit the held lock", attempts)
	}
	if n := count(t, conn, "SELECT COUNT(*) FROM t"); n != 1 {
		t.Errorf("rows = %d, want exactly 1 (a retried write must not be applied twice)", n)
	}
}

func TestRetryBusyStopsWhenTheContextEnds(t *testing.T) {
	conn := openTest(t)
	mustExec(t, conn, "CREATE TABLE t (x INTEGER)")
	short, unlock := lockWrites(t, conn)
	defer unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	start := time.Now()
	err := RetryBusy(ctx, func() error {
		_, err := short.ExecContext(context.Background(), "INSERT INTO t VALUES (1)")
		return err
	})
	if !IsBusy(err) {
		t.Fatalf("err = %v, want the busy error once the context ended", err)
	}
	if d := time.Since(start); d > 5*time.Second {
		t.Errorf("RetryBusy outlived its context by far: %v", d)
	}
}

func TestRetryBusyDoesNotRetryOtherErrors(t *testing.T) {
	boom := errors.New("boom")
	calls := 0
	err := RetryBusy(context.Background(), func() error { calls++; return boom })
	if !errors.Is(err, boom) || calls != 1 {
		t.Errorf("err=%v calls=%d, want boom after exactly one call", err, calls)
	}
	v, err := RetryBusyValue(context.Background(), func() (string, error) { return "ok", nil })
	if v != "ok" || err != nil {
		t.Errorf("RetryBusyValue = %q, %v", v, err)
	}
}

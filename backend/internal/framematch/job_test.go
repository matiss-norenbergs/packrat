package framematch

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

func waitState(t *testing.T, s *JobStore, id, want string) JobStatus {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if st, ok := s.Get(id); ok && st.State == want {
			return st
		}
		time.Sleep(5 * time.Millisecond)
	}
	st, _ := s.Get(id)
	t.Fatalf("job %s never reached %q (now %+v)", id, want, st)
	return JobStatus{}
}

func TestRunExclusiveTimesOutHungMatch(t *testing.T) {
	_, err := runExclusive(context.Background(), 50*time.Millisecond, func(ctx context.Context) (Result, error) {
		<-ctx.Done()
		return Result{}, ctx.Err()
	})
	if err == nil || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("err = %v", err)
	}
	// The lock was released.
	if _, err := runExclusive(context.Background(), time.Second, func(context.Context) (Result, error) { return Result{}, nil }); err != nil {
		t.Fatal(err)
	}
}

func TestJobDeadlineStartsAfterLockAcquired(t *testing.T) {
	s := NewJobStore()
	s.timeout = 500 * time.Millisecond

	matchSem <- struct{}{} // another match is running
	id := s.startFunc(func(ctx context.Context) (Result, error) {
		select {
		case <-time.After(10 * time.Millisecond):
			return Result{Score: 1}, nil
		case <-ctx.Done():
			return Result{}, ctx.Err()
		}
	})
	time.Sleep(900 * time.Millisecond) // longer than the whole timeout
	if st, _ := s.Get(id); st.State != "running" {
		t.Fatalf("job should still be waiting, got %q", st.State)
	}
	<-matchSem
	waitState(t, s, id, "done")
}

func TestJobLockWaitIsCancellable(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	s := NewJobStore()
	s.SetBaseContext(ctx)

	matchSem <- struct{}{}
	defer func() { <-matchSem }()
	id := s.startFunc(func(context.Context) (Result, error) {
		t.Error("must not run")
		return Result{}, nil
	})
	cancel()
	st := waitState(t, s, id, "error")
	if !strings.Contains(st.ErrorMsg, "canceled") {
		t.Fatalf("error = %q", st.ErrorMsg)
	}
}

func TestJobStoreEvictsFinishedJobsAfterTTL(t *testing.T) {
	clock := &fakeClock{t: time.Unix(1_000_000, 0)}
	s := NewJobStore()
	s.now = clock.Now

	doneID := s.startFunc(func(context.Context) (Result, error) { return Result{Score: 90}, nil })
	waitState(t, s, doneID, "done")

	release := make(chan struct{})
	runningID := s.startFunc(func(ctx context.Context) (Result, error) { <-release; return Result{}, nil })
	waitState(t, s, runningID, "running")
	// The running job holds matchSem; let it finish so later tests aren't blocked.
	defer func() {
		close(release)
		waitState(t, s, runningID, "done")
	}()

	clock.Advance(jobTTL - time.Minute)
	if _, ok := s.Get(doneID); !ok {
		t.Fatal("finished job evicted before TTL")
	}
	clock.Advance(2 * time.Minute)
	if _, ok := s.Get(doneID); ok {
		t.Fatal("finished job still present after TTL")
	}
	clock.Advance(24 * time.Hour)
	if st, ok := s.Get(runningID); !ok || st.State != "running" {
		t.Fatalf("running job must never be evicted: %v %+v", ok, st)
	}
}

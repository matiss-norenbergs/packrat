package framematch

import (
	"context"
	"testing"
	"time"

	"packrat/backend/internal/models"
)

func TestMatchTimeoutFor(t *testing.T) {
	m := time.Minute
	cases := []struct {
		name string
		in   time.Duration
		want time.Duration
	}{
		{"unknown", 0, 5 * m},
		{"negative is unknown", -3 * m, 5 * m},
		{"10 min", 10 * m, 5 * m},          // 4.5 min, raised to the minimum
		{"12 min boundary", 12 * m, 5 * m}, // 5 min exactly
		{"39 min", 39 * m, 11*m + 45*time.Second},
		{"60 min", 60 * m, 17 * m},
		{"2 h", 120 * m, 32 * m},
		{"10 h", 600 * m, 60 * m}, // capped
	}
	for _, c := range cases {
		got := matchTimeoutFor(c.in)
		if got != c.want {
			t.Errorf("%s: matchTimeoutFor(%s) = %s, want %s", c.name, c.in, got, c.want)
		}
		if got < matchTimeout || got > maxMatchTimeout {
			t.Errorf("%s: %s outside [%s, %s]", c.name, got, matchTimeout, maxMatchTimeout)
		}
	}
}

// deadlineOf runs a job via startWithDuration and returns the time left on
// the context handed to the match function.
func deadlineOf(t *testing.T, s *JobStore, dur func(context.Context) time.Duration) time.Duration {
	t.Helper()
	got := make(chan time.Duration, 1)
	id := s.startWithDuration(dur, func(ctx context.Context) (Result, error) {
		d, ok := ctx.Deadline()
		if !ok {
			t.Error("match context has no deadline")
		}
		got <- time.Until(d)
		return Result{}, nil
	})
	waitState(t, s, id, "done")
	return <-got
}

func near(t *testing.T, got, want time.Duration) {
	t.Helper()
	if got > want || got < want-10*time.Second {
		t.Fatalf("deadline in %s, want about %s", got, want)
	}
}

func TestJobDeadlineScalesWithDuration(t *testing.T) {
	s := NewJobStore()
	near(t, deadlineOf(t, s, func(context.Context) time.Duration { return 2 * time.Hour }), 32*time.Minute)
}

func TestJobDeadlineFlatWhenDurationUnknown(t *testing.T) {
	s := NewJobStore()
	near(t, deadlineOf(t, s, nil), matchTimeout)
	near(t, deadlineOf(t, s, func(context.Context) time.Duration { return 0 }), matchTimeout) // failed probe
}

func TestJobTimeoutOverrideWinsOverDuration(t *testing.T) {
	s := NewJobStore()
	s.timeout = 90 * time.Second
	probed := false
	d := deadlineOf(t, s, func(context.Context) time.Duration { probed = true; return 5 * time.Hour })
	near(t, d, 90*time.Second)
	if probed {
		t.Error("override should skip the probe")
	}
}

// The duration is read before waiting for the match lock, and the lock wait
// does not eat into the computed budget.
func TestJobProbeBeforeLockAndWaitNotCounted(t *testing.T) {
	s := NewJobStore()
	matchSem <- struct{}{} // another match is running
	probedWhileWaiting := make(chan struct{}, 1)
	got := make(chan time.Duration, 1)
	id := s.startWithDuration(func(context.Context) time.Duration {
		probedWhileWaiting <- struct{}{}
		return 2 * time.Hour
	}, func(ctx context.Context) (Result, error) {
		d, _ := ctx.Deadline()
		got <- time.Until(d)
		return Result{}, nil
	})
	select {
	case <-probedWhileWaiting:
	case <-time.After(2 * time.Second):
		t.Fatal("duration not probed before the lock was acquired")
	}
	time.Sleep(1500 * time.Millisecond) // wait on the lock
	<-matchSem
	waitState(t, s, id, "done")
	// 32 min budget, minus nothing for the 1.5 s wait.
	near(t, <-got, 32*time.Minute)
}

func TestTimeoutErrorShowsComputedValue(t *testing.T) {
	_, err := runExclusive(context.Background(), 50*time.Millisecond, func(ctx context.Context) (Result, error) {
		<-ctx.Done()
		return Result{}, ctx.Err()
	})
	if err == nil || err.Error() != "match timed out after 50ms" {
		t.Fatalf("err = %v", err)
	}
}

func TestQueueMatchTimeout(t *testing.T) {
	ctx := context.Background()
	sec := func(n int) *int { return &n }
	probe := func(d time.Duration) func(context.Context, string) time.Duration {
		return func(context.Context, string) time.Duration { return d }
	}
	unexpected := func(context.Context, string) time.Duration { t.Error("probe should not run"); return 0 }

	// Stored duration wins over probing.
	near(t, queueMatchTimeout(ctx, QueueDeps{ProbeDuration: unexpected}, &models.LibraryItem{Duration: sec(7200)}, "v.mp4"), 32*time.Minute)
	// No stored duration: probe.
	near(t, queueMatchTimeout(ctx, QueueDeps{ProbeDuration: probe(2 * time.Hour)}, &models.LibraryItem{}, "v.mp4"), 32*time.Minute)
	// A stored zero counts as unknown.
	near(t, queueMatchTimeout(ctx, QueueDeps{ProbeDuration: probe(2 * time.Hour)}, &models.LibraryItem{Duration: sec(0)}, "v.mp4"), 32*time.Minute)
	// Unknown / failed probe: flat 5 minutes.
	near(t, queueMatchTimeout(ctx, QueueDeps{ProbeDuration: probe(0)}, &models.LibraryItem{}, "v.mp4"), matchTimeout)
	// The override wins.
	if got := queueMatchTimeout(ctx, QueueDeps{MatchTimeout: 1500 * time.Millisecond, ProbeDuration: unexpected}, &models.LibraryItem{Duration: sec(36000)}, "v.mp4"); got != 1500*time.Millisecond {
		t.Fatalf("override: %s", got)
	}
}

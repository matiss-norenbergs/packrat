package jellyfin

import (
	"sync"
	"testing"
	"time"
)

func TestDebouncer_CoalescesBurstIntoOneCall(t *testing.T) {
	var mu sync.Mutex
	var calls []string

	d := NewDebouncer(30*time.Millisecond, func(target string) {
		mu.Lock()
		calls = append(calls, target)
		mu.Unlock()
	})

	d.Trigger("lib-1")
	time.Sleep(10 * time.Millisecond)
	d.Trigger("lib-1") // resets the window before it fires
	time.Sleep(10 * time.Millisecond)
	d.Trigger("lib-1")

	time.Sleep(60 * time.Millisecond) // past the last trigger's delay

	mu.Lock()
	defer mu.Unlock()
	if len(calls) != 1 {
		t.Fatalf("expected exactly 1 call after a burst, got %d: %v", len(calls), calls)
	}
	if calls[0] != "lib-1" {
		t.Fatalf("expected target lib-1, got %q", calls[0])
	}
}

func TestDebouncer_TriggersAfterEachSeparateWindow(t *testing.T) {
	var mu sync.Mutex
	var calls []string

	d := NewDebouncer(20*time.Millisecond, func(target string) {
		mu.Lock()
		calls = append(calls, target)
		mu.Unlock()
	})

	d.Trigger("lib-1")
	time.Sleep(40 * time.Millisecond) // let the first fire

	d.Trigger("lib-1")
	time.Sleep(40 * time.Millisecond) // let the second fire

	mu.Lock()
	defer mu.Unlock()
	if len(calls) != 2 {
		t.Fatalf("expected 2 separate calls across 2 windows, got %d: %v", len(calls), calls)
	}
}

func TestDebouncer_DistinctTargetsFireIndependently(t *testing.T) {
	var mu sync.Mutex
	var calls []string

	d := NewDebouncer(20*time.Millisecond, func(target string) {
		mu.Lock()
		calls = append(calls, target)
		mu.Unlock()
	})

	d.Trigger("lib-1")
	d.Trigger("lib-2")
	time.Sleep(40 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	if len(calls) != 2 {
		t.Fatalf("expected 2 calls (one per target), got %d: %v", len(calls), calls)
	}
}

package jellyfin

import (
	"sync"
	"time"
)

// Debouncer coalesces bursts of refresh requests for the same target (a
// Jellyfin item ID, or "" for a full-library refresh) into a single call
// after a quiet period, so N downloads finishing within the window trigger
// one rescan instead of N — the concern that led to removing the previous
// automatic-refresh-on-every-download behavior in the first place.
type Debouncer struct {
	mu     sync.Mutex
	timers map[string]*time.Timer
	delay  time.Duration
	fn     func(target string)
}

// NewDebouncer returns a Debouncer that calls fn(target) delay after the
// most recent Trigger(target) call for that target, cancelling and
// restarting the wait on every subsequent Trigger for the same target.
func NewDebouncer(delay time.Duration, fn func(target string)) *Debouncer {
	return &Debouncer{
		timers: make(map[string]*time.Timer),
		delay:  delay,
		fn:     fn,
	}
}

// Trigger (re)starts the debounce window for target.
func (d *Debouncer) Trigger(target string) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if t, ok := d.timers[target]; ok {
		t.Stop()
	}
	d.timers[target] = time.AfterFunc(d.delay, func() {
		d.fn(target)
	})
}

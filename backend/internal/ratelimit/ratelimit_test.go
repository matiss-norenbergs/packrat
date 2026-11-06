package ratelimit

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time          { return c.t }
func (c *fakeClock) advance(d time.Duration) { c.t = c.t.Add(d) }

func newTest() (*Limiter, *fakeClock) {
	c := &fakeClock{t: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)}
	return New(c.now), c
}

func TestPerIPBlocksAfterFiveFailuresAndClears(t *testing.T) {
	l, c := newTest()
	for i := 0; i < PerIPMaxFailures-1; i++ {
		l.Fail("1.1.1.1", KindPassword)
		if w := l.Check("1.1.1.1", KindPassword); w != 0 {
			t.Fatalf("blocked after %d failures", i+1)
		}
	}
	l.Fail("1.1.1.1", KindCode) // kinds share the per-IP budget
	if w := l.Check("1.1.1.1", KindPassword); w != PerIPWindow {
		t.Fatalf("want %v block, got %v", PerIPWindow, w)
	}
	if w := l.Check("2.2.2.2", KindPassword); w != 0 {
		t.Fatalf("other IP must be unaffected, got %v", w)
	}
	c.advance(PerIPWindow - time.Minute)
	if w := l.Check("1.1.1.1", KindCode); w != time.Minute {
		t.Fatalf("want 1m left, got %v", w)
	}
	c.advance(time.Minute)
	if w := l.Check("1.1.1.1", KindCode); w != 0 {
		t.Fatalf("block should have cleared, got %v", w)
	}
}

func TestPerIPFailuresExpireOutsideWindow(t *testing.T) {
	l, c := newTest()
	for i := 0; i < PerIPMaxFailures-1; i++ {
		l.Fail("1.1.1.1", KindPassword)
	}
	c.advance(PerIPWindow + time.Second)
	l.Fail("1.1.1.1", KindPassword)
	if w := l.Check("1.1.1.1", KindPassword); w != 0 {
		t.Fatalf("old failures should not count, got %v", w)
	}
}

func TestSuccessResetsIPCounters(t *testing.T) {
	l, _ := newTest()
	for i := 0; i < PerIPMaxFailures-1; i++ {
		l.Fail("1.1.1.1", KindPassword)
	}
	l.Success("1.1.1.1")
	l.Fail("1.1.1.1", KindPassword)
	if w := l.Check("1.1.1.1", KindPassword); w != 0 {
		t.Fatalf("counters should have reset, got %v", w)
	}
}

// failFromManyIPs spreads n failures over distinct IPs so only the global budget is hit.
func failFromManyIPs(l *Limiter, kind Kind, n int, prefix string) {
	for i := 0; i < n; i++ {
		l.Fail(fmt.Sprintf("%s%d", prefix, i), kind)
	}
}

func TestGlobalPasswordCooldownDoubles(t *testing.T) {
	l, c := newTest()
	failFromManyIPs(l, KindPassword, GlobalMaxPassword-1, "a")
	if w := l.Check("9.9.9.9", KindPassword); w != 0 {
		t.Fatalf("blocked too early: %v", w)
	}
	l.Fail("a-last", KindPassword)
	if w := l.Check("9.9.9.9", KindPassword); w != GlobalBaseCooldown {
		t.Fatalf("want %v, got %v", GlobalBaseCooldown, w)
	}
	if w := l.Check("9.9.9.9", KindCode); w != 0 {
		t.Fatalf("code step must be independent, got %v", w)
	}
	c.advance(GlobalBaseCooldown)
	if w := l.Check("9.9.9.9", KindPassword); w != 0 {
		t.Fatalf("cooldown should be over, got %v", w)
	}
	failFromManyIPs(l, KindPassword, GlobalMaxPassword, "b")
	if w := l.Check("9.9.9.9", KindPassword); w != 2*GlobalBaseCooldown {
		t.Fatalf("second trip should double, got %v", w)
	}
	// keep tripping: the cooldown caps at GlobalMaxCooldown
	for i := 0; i < 8; i++ {
		c.advance(GlobalMaxCooldown)
		failFromManyIPs(l, KindPassword, GlobalMaxPassword, fmt.Sprintf("c%d-", i))
	}
	if w := l.Check("9.9.9.9", KindPassword); w > GlobalMaxCooldown || w == 0 {
		t.Fatalf("cooldown must cap at %v, got %v", GlobalMaxCooldown, w)
	}
}

func TestGlobalCodeThresholdAndDecay(t *testing.T) {
	l, c := newTest()
	failFromManyIPs(l, KindCode, GlobalMaxCode, "x")
	if w := l.Check("9.9.9.9", KindCode); w != GlobalBaseCooldown {
		t.Fatalf("want %v, got %v", GlobalBaseCooldown, w)
	}
	c.advance(globalLevelDecayAfter + time.Hour)
	failFromManyIPs(l, KindCode, GlobalMaxCode, "y")
	if w := l.Check("9.9.9.9", KindCode); w != GlobalBaseCooldown {
		t.Fatalf("level should decay after a quiet day, got %v", w)
	}
}

func TestTrackedIPsAreBounded(t *testing.T) {
	l, _ := newTest()
	for i := 0; i < MaxTrackedIPs+500; i++ {
		l.Fail(fmt.Sprintf("ip-%d", i), KindCode)
		if i%7 == 0 { // keep the global budget from tripping the test's intent
			l.mu.Lock()
			l.global[KindCode].failures = nil
			l.mu.Unlock()
		}
	}
	if n := len(l.ips); n > MaxTrackedIPs {
		t.Fatalf("tracked %d IPs, cap is %d", n, MaxTrackedIPs)
	}
}

func TestReserveCountsAttemptsBeforeTheyResolve(t *testing.T) {
	l, _ := newTest()
	var held []*Reservation
	for i := 0; i < PerIPMaxFailures; i++ {
		r, w := l.Reserve("1.1.1.1", KindPassword)
		if w != 0 || r == nil {
			t.Fatalf("reservation %d refused (wait %v)", i, w)
		}
		held = append(held, r)
	}
	if r, w := l.Reserve("1.1.1.1", KindPassword); w != PerIPWindow || r != nil {
		t.Fatalf("over-budget reservation: wait=%v res=%v", w, r)
	}
	// Another address is unaffected.
	if r, w := l.Reserve("2.2.2.2", KindPassword); w != 0 {
		t.Fatalf("other address blocked: %v", w)
	} else {
		r.Release()
	}
	// Releasing frees a slot without counting a failure.
	held[0].Release()
	held[0].Release() // idempotent
	if r, w := l.Reserve("1.1.1.1", KindPassword); w != 0 {
		t.Fatalf("slot not freed: %v", w)
	} else {
		r.Release()
	}
	// Failing the rest trips the real block.
	for _, r := range held[1:] {
		r.Fail(KindPassword)
		r.Fail(KindPassword) // idempotent: counted once
	}
	if w := l.Check("1.1.1.1", KindPassword); w != 0 {
		t.Fatalf("9 failures must not block yet: %v", w)
	}
	r, _ := l.Reserve("1.1.1.1", KindPassword)
	r.Fail(KindPassword)
	if w := l.Check("1.1.1.1", KindPassword); w != PerIPWindow {
		t.Fatalf("10th failure must block: %v", w)
	}
}

func TestReserveGlobalBudgetAndSuccess(t *testing.T) {
	l := New(nil)
	var held []*Reservation
	for i := 0; i < GlobalMaxCode; i++ {
		r, w := l.Reserve(fmt.Sprintf("ip-%d", i), KindCode)
		if w != 0 {
			t.Fatalf("reservation %d refused: %v", i, w)
		}
		held = append(held, r)
	}
	if _, w := l.Reserve("fresh", KindCode); w != GlobalBaseCooldown {
		t.Fatalf("global budget exhausted: wait=%v", w)
	}
	if _, w := l.Reserve("fresh", KindPassword); w != 0 {
		t.Fatalf("password budget is separate: %v", w)
	}
	for _, r := range held {
		r.Release()
	}
	if _, w := l.Reserve("fresh2", KindCode); w != 0 {
		t.Fatalf("released slots must be reusable: %v", w)
	}

	// Success clears an address's failures but keeps other in-flight reservations intact.
	l2 := New(nil)
	for i := 0; i < PerIPMaxFailures-2; i++ {
		l2.Fail("9.9.9.9", KindPassword)
	}
	inflight, _ := l2.Reserve("9.9.9.9", KindPassword)
	l2.Success("9.9.9.9")
	for i := 0; i < PerIPMaxFailures-1; i++ {
		r, w := l2.Reserve("9.9.9.9", KindPassword)
		if w != 0 {
			t.Fatalf("after success reservation %d refused: %v", i, w)
		}
		r.Release()
	}
	inflight.Release()
}

func TestReserveIsRaceFree(t *testing.T) {
	l := New(nil)
	var admitted atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if r, w := l.Reserve("3.3.3.3", KindPassword); w == 0 {
				admitted.Add(1)
				r.Fail(KindPassword)
			}
		}()
	}
	wg.Wait()
	if got := admitted.Load(); got != PerIPMaxFailures {
		t.Fatalf("%d admitted, want %d", got, PerIPMaxFailures)
	}
}

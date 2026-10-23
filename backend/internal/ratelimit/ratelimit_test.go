package ratelimit

import (
	"fmt"
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

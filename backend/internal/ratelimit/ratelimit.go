// Package ratelimit throttles failed login-style attempts (wrong passwords, wrong 2FA codes).
//
// It only ever delays: a block always expires, so nobody — the owner included — can be locked out
// permanently by someone else's bad guesses. State is in memory and bounded; it resets on restart.
package ratelimit

import (
	"container/list"
	"sync"
	"time"
)

// Kind is the step an attempt belongs to. Each has its own global budget.
type Kind string

const (
	KindPassword Kind = "password"
	KindCode     Kind = "code"
)

// Tunables — constants for now, easy to adjust.
const (
	// PerIPMaxFailures failures (of any kind) from one address within PerIPWindow block that
	// address for PerIPWindow.
	PerIPMaxFailures = 5
	PerIPWindow      = 15 * time.Minute

	GlobalWindow          = time.Hour
	GlobalMaxPassword     = 15
	GlobalMaxCode         = 10
	GlobalBaseCooldown    = 15 * time.Minute
	GlobalMaxCooldown     = 4 * time.Hour
	globalLevelDecayAfter = 24 * time.Hour

	// MaxTrackedIPs bounds memory; the least recently created entry is evicted first.
	MaxTrackedIPs = 10000
)

type ipState struct {
	ip           string
	failures     []time.Time
	blockedUntil time.Time
	elem         *list.Element
}

type globalState struct {
	failures     []time.Time
	blockedUntil time.Time
	level        int // number of consecutive trips; the next cooldown is base << level
	lastTrip     time.Time
}

// Limiter is safe for concurrent use.
type Limiter struct {
	mu     sync.Mutex
	now    func() time.Time
	ips    map[string]*ipState
	order  *list.List // front = oldest
	global map[Kind]*globalState
}

// New returns a Limiter; pass nil to use the wall clock.
func New(now func() time.Time) *Limiter {
	if now == nil {
		now = time.Now
	}
	return &Limiter{
		now:    now,
		ips:    make(map[string]*ipState),
		order:  list.New(),
		global: map[Kind]*globalState{KindPassword: {}, KindCode: {}},
	}
}

func globalLimit(k Kind) int {
	if k == KindCode {
		return GlobalMaxCode
	}
	return GlobalMaxPassword
}

// Check reports how long the caller must wait before attempting the given step; zero means go
// ahead. It applies to correct attempts too (a block can't reveal whether a guess was right).
func (l *Limiter) Check(ip string, kind Kind) time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	var wait time.Duration
	if st, ok := l.ips[ip]; ok && st.blockedUntil.After(now) {
		wait = st.blockedUntil.Sub(now)
	}
	if g := l.global[kind]; g != nil && g.blockedUntil.After(now) {
		if d := g.blockedUntil.Sub(now); d > wait {
			wait = d
		}
	}
	return wait
}

// Fail records a failed attempt of the given kind from ip.
func (l *Limiter) Fail(ip string, kind Kind) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()

	st := l.ips[ip]
	if st == nil {
		st = &ipState{ip: ip}
		st.elem = l.order.PushBack(st)
		l.ips[ip] = st
		for len(l.ips) > MaxTrackedIPs {
			oldest := l.order.Front()
			old := oldest.Value.(*ipState)
			l.order.Remove(oldest)
			delete(l.ips, old.ip)
		}
	}
	st.failures = prune(st.failures, now, PerIPWindow)
	st.failures = append(st.failures, now)
	if len(st.failures) >= PerIPMaxFailures {
		st.blockedUntil = now.Add(PerIPWindow)
		st.failures = nil
	}

	g := l.global[kind]
	if g == nil {
		return
	}
	g.failures = prune(g.failures, now, GlobalWindow)
	g.failures = append(g.failures, now)
	if len(g.failures) >= globalLimit(kind) {
		if !g.lastTrip.IsZero() && now.Sub(g.lastTrip) > globalLevelDecayAfter {
			g.level = 0
		}
		cooldown := GlobalBaseCooldown << g.level
		if cooldown > GlobalMaxCooldown || cooldown <= 0 {
			cooldown = GlobalMaxCooldown
		} else {
			g.level++
		}
		g.blockedUntil = now.Add(cooldown)
		g.lastTrip = now
		g.failures = nil
	}
}

// Success clears the failure counters of ip (call after a completed login). It does not lift an
// active block or the global counters.
func (l *Limiter) Success(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if st, ok := l.ips[ip]; ok {
		st.failures = nil
		if !st.blockedUntil.After(l.now()) {
			l.order.Remove(st.elem)
			delete(l.ips, ip)
		}
	}
}

func prune(ts []time.Time, now time.Time, window time.Duration) []time.Time {
	i := 0
	for i < len(ts) && now.Sub(ts[i]) >= window {
		i++
	}
	return ts[i:]
}

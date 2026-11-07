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
	PerIPMaxFailures = 10
	PerIPWindow      = 15 * time.Minute

	GlobalWindow          = time.Hour
	GlobalMaxPassword     = 30
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
	pending      int // attempts admitted by Reserve that have not resolved yet
	blockedUntil time.Time
	elem         *list.Element
}

type globalState struct {
	failures     []time.Time
	pending      int
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

// Reservation is one admitted attempt. Reserve counts it against the limits straight away (under
// the limiter's lock), so concurrent requests cannot all pass the check before any failure is
// recorded. Resolve it with Fail (the attempt was wrong) or Release (anything else); both are
// idempotent, so a deferred Release is a safe catch-all. A nil Reservation is a no-op.
type Reservation struct {
	l     *Limiter
	ip    string
	kinds []Kind
	done  bool
}

// Reserve is Check plus an atomic claim: when the caller may proceed (wait == 0) the attempt is
// held against the per-address and global budgets of kinds until the Reservation is resolved, and
// attempts that would exceed a budget are refused with the wait a trip would impose. The returned
// Reservation is nil when wait > 0.
func (l *Limiter) Reserve(ip string, kinds ...Kind) (*Reservation, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()

	var wait time.Duration
	if st, ok := l.ips[ip]; ok {
		if st.blockedUntil.After(now) {
			wait = st.blockedUntil.Sub(now)
		} else {
			st.failures = prune(st.failures, now, PerIPWindow)
			if len(st.failures)+st.pending >= PerIPMaxFailures {
				wait = PerIPWindow
			}
		}
	}
	for _, k := range kinds {
		g := l.global[k]
		if g == nil {
			continue
		}
		var w time.Duration
		if g.blockedUntil.After(now) {
			w = g.blockedUntil.Sub(now)
		} else {
			g.failures = prune(g.failures, now, GlobalWindow)
			if len(g.failures)+g.pending >= globalLimit(k) {
				w = g.nextCooldown(now)
			}
		}
		if w > wait {
			wait = w
		}
	}
	if wait > 0 {
		return nil, wait
	}

	st := l.ensureIP(ip)
	st.pending++
	for _, k := range kinds {
		if g := l.global[k]; g != nil {
			g.pending++
		}
	}
	return &Reservation{l: l, ip: ip, kinds: kinds}, 0
}

// Fail turns the reservation into a recorded failure of kind (counted once against the address
// and the global budget for kind); the other kinds it held are released.
func (r *Reservation) Fail(kind Kind) {
	if r == nil {
		return
	}
	r.l.mu.Lock()
	defer r.l.mu.Unlock()
	if r.done {
		return
	}
	r.done = true
	r.l.dropPendingLocked(r.ip, r.kinds)
	r.l.failLocked(r.ip, kind)
}

// Release gives the reservation back without recording a failure.
func (r *Reservation) Release() {
	if r == nil {
		return
	}
	r.l.mu.Lock()
	defer r.l.mu.Unlock()
	if r.done {
		return
	}
	r.done = true
	r.l.dropPendingLocked(r.ip, r.kinds)
	if st, ok := r.l.ips[r.ip]; ok {
		r.l.dropIfIdleLocked(st)
	}
}

func (l *Limiter) dropPendingLocked(ip string, kinds []Kind) {
	if st, ok := l.ips[ip]; ok && st.pending > 0 {
		st.pending--
	}
	for _, k := range kinds {
		if g := l.global[k]; g != nil && g.pending > 0 {
			g.pending--
		}
	}
}

func (l *Limiter) dropIfIdleLocked(st *ipState) {
	if st.pending == 0 && len(st.failures) == 0 && !st.blockedUntil.After(l.now()) {
		l.order.Remove(st.elem)
		delete(l.ips, st.ip)
	}
}

// ensureIP returns the state for ip, creating it (and evicting the oldest beyond the bound).
func (l *Limiter) ensureIP(ip string) *ipState {
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
	return st
}

// nextCooldown is the block the next trip of g would impose (the same arithmetic as failLocked).
func (g *globalState) nextCooldown(now time.Time) time.Duration {
	level := g.level
	if !g.lastTrip.IsZero() && now.Sub(g.lastTrip) > globalLevelDecayAfter {
		level = 0
	}
	cooldown := GlobalBaseCooldown << level
	if cooldown > GlobalMaxCooldown || cooldown <= 0 {
		cooldown = GlobalMaxCooldown
	}
	return cooldown
}

// Fail records a failed attempt of the given kind from ip.
func (l *Limiter) Fail(ip string, kind Kind) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.failLocked(ip, kind)
}

func (l *Limiter) failLocked(ip string, kind Kind) {
	now := l.now()

	st := l.ensureIP(ip)
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
		l.dropIfIdleLocked(st)
	}
}

func prune(ts []time.Time, now time.Time, window time.Duration) []time.Time {
	i := 0
	for i < len(ts) && now.Sub(ts[i]) >= window {
		i++
	}
	return ts[i:]
}

package twofactor

import (
	"container/list"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"
)

const (
	// ChallengeTTL is how long a correct password keeps the second step open.
	ChallengeTTL = 5 * time.Minute
	// ChallengeMaxAttempts wrong codes destroy the challenge (the password must be re-entered).
	ChallengeMaxAttempts = 5
	maxChallenges        = 1000
)

type challenge struct {
	key      string
	userID   int64
	expires  time.Time
	attempts int
	elem     *list.Element
}

// Challenges is the in-memory store of pending second-factor logins. A challenge is random
// (256 bits), single-use, short-lived and server-side only; it is not a session and no endpoint
// accepts it as one. Tokens are held as hashes. Restarting the server drops them (re-enter the
// password), which is fine.
type Challenges struct {
	mu    sync.Mutex
	now   func() time.Time
	items map[string]*challenge
	order *list.List
}

func NewChallenges(now func() time.Time) *Challenges {
	if now == nil {
		now = time.Now
	}
	return &Challenges{now: now, items: map[string]*challenge{}, order: list.New()}
}

func keyOf(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// Create opens a challenge for userID and returns its token.
func (s *Challenges) Create(userID int64) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := hex.EncodeToString(b)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked()
	ch := &challenge{key: keyOf(token), userID: userID, expires: s.now().Add(ChallengeTTL)}
	ch.elem = s.order.PushBack(ch)
	s.items[ch.key] = ch
	for len(s.items) > maxChallenges {
		s.removeLocked(s.order.Front().Value.(*challenge))
	}
	return token, nil
}

// Lookup returns the user a live challenge belongs to.
func (s *Challenges) Lookup(token string) (userID int64, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ch := s.liveLocked(token)
	if ch == nil {
		return 0, false
	}
	return ch.userID, true
}

// Fail counts a wrong code and reports whether the challenge is now destroyed.
func (s *Challenges) Fail(token string) (destroyed bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ch := s.liveLocked(token)
	if ch == nil {
		return true
	}
	ch.attempts++
	if ch.attempts >= ChallengeMaxAttempts {
		s.removeLocked(ch)
		return true
	}
	return false
}

// Consume uses the challenge up, reporting false if it was already gone — only the caller that
// gets true may start a session.
func (s *Challenges) Consume(token string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	ch := s.liveLocked(token)
	if ch == nil {
		return false
	}
	s.removeLocked(ch)
	return true
}

func (s *Challenges) liveLocked(token string) *challenge {
	ch := s.items[keyOf(token)]
	if ch == nil {
		return nil
	}
	if !ch.expires.After(s.now()) {
		s.removeLocked(ch)
		return nil
	}
	return ch
}

func (s *Challenges) removeLocked(ch *challenge) {
	s.order.Remove(ch.elem)
	delete(s.items, ch.key)
}

func (s *Challenges) sweepLocked() {
	now := s.now()
	for e := s.order.Front(); e != nil; {
		next := e.Next()
		if ch := e.Value.(*challenge); !ch.expires.After(now) {
			s.removeLocked(ch)
		}
		e = next
	}
}

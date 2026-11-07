package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"packrat/backend/internal/ratelimit"
	"packrat/backend/internal/twofactor"
)

func (e *authTestEnv) loginFailureCount(t *testing.T) int {
	t.Helper()
	var n int
	if err := e.conn.QueryRow(`SELECT COUNT(*) FROM login_failures`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// fireConcurrently runs n requests released at the same moment and returns the status codes.
func fireConcurrently(n int, do func(i int) *httptest.ResponseRecorder) []int {
	codes := make([]int, n)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			codes[i] = do(i).Code
		}(i)
	}
	close(start)
	wg.Wait()
	return codes
}

func count(codes []int, want int) int {
	n := 0
	for _, c := range codes {
		if c == want {
			n++
		}
	}
	return n
}

func TestConcurrentWrongPasswordsStopAtThePerIPLimit(t *testing.T) {
	e := newAuthTestEnv(t)
	setupAndLogin(t, e.r)
	before := e.loginFailureCount(t)

	codes := fireConcurrently(50, func(int) *httptest.ResponseRecorder {
		return loginFrom(e, "10.0.0.1:1234", "wrong-password", nil)
	})
	if got := count(codes, http.StatusUnauthorized); got != ratelimit.PerIPMaxFailures {
		t.Fatalf("%d passwords were verified, want %d (codes %v)", got, ratelimit.PerIPMaxFailures, codes)
	}
	if got := count(codes, http.StatusTooManyRequests); got != 50-ratelimit.PerIPMaxFailures {
		t.Fatalf("%d requests got 429, want %d", got, 50-ratelimit.PerIPMaxFailures)
	}
	if got := e.loginFailureCount(t) - before; got != ratelimit.PerIPMaxFailures {
		t.Fatalf("%d failures recorded, want %d", got, ratelimit.PerIPMaxFailures)
	}
	// The block is real afterwards, even for the right password.
	if w := loginFrom(e, "10.0.0.1:1234", "hunter2-hunter2", nil); w.Code != http.StatusTooManyRequests {
		t.Fatalf("blocked address got %d", w.Code)
	}
}

func TestConcurrentWrongPasswordsStopAtTheGlobalLimit(t *testing.T) {
	e := newAuthTestEnv(t)
	setupAndLogin(t, e.r)

	// Every request comes from a different address, so only the global budget can stop them.
	codes := fireConcurrently(80, func(i int) *httptest.ResponseRecorder {
		return loginFrom(e, fmt.Sprintf("10.1.%d.%d:1234", i/200, i%200), "wrong-password", nil)
	})
	if got := count(codes, http.StatusUnauthorized); got != ratelimit.GlobalMaxPassword {
		t.Fatalf("%d passwords were verified, want %d", got, ratelimit.GlobalMaxPassword)
	}
	if got := count(codes, http.StatusTooManyRequests); got != 80-ratelimit.GlobalMaxPassword {
		t.Fatalf("%d requests got 429, want %d", got, 80-ratelimit.GlobalMaxPassword)
	}
}

func TestCorrectLoginAfterFailuresStillWorksAndResetsCounters(t *testing.T) {
	e := newAuthTestEnv(t)
	setupAndLogin(t, e.r)
	for i := 0; i < ratelimit.PerIPMaxFailures-1; i++ {
		if w := loginFrom(e, "10.0.0.2:1", "wrong-password", nil); w.Code != http.StatusUnauthorized {
			t.Fatalf("wrong password %d: %d", i, w.Code)
		}
	}
	if w := loginFrom(e, "10.0.0.2:1", "hunter2-hunter2", nil); w.Code != http.StatusNoContent {
		t.Fatalf("correct login after earlier failures: %d %s", w.Code, w.Body)
	}
	// The success cleared this address's counters: a full budget of misses is available again.
	for i := 0; i < ratelimit.PerIPMaxFailures; i++ {
		if w := loginFrom(e, "10.0.0.2:1", "wrong-password", nil); w.Code != http.StatusUnauthorized {
			t.Fatalf("after reset, wrong password %d: %d", i, w.Code)
		}
	}
	if w := loginFrom(e, "10.0.0.2:1", "wrong-password", nil); w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected the block once the budget is spent: %d", w.Code)
	}
}

func TestMalformedAndCorrectRequestsDoNotConsumeTheBudget(t *testing.T) {
	e := newAuthTestEnv(t)
	setupAndLogin(t, e.r)
	for i := 0; i < 3*ratelimit.PerIPMaxFailures; i++ {
		hr := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{not json`))
		hr.Header.Set("Content-Type", "application/json")
		hr.RemoteAddr = "10.0.0.3:1"
		w := httptest.NewRecorder()
		e.r.ServeHTTP(w, hr)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("bad body %d: %d", i, w.Code)
		}
		if w := loginFrom(e, "10.0.0.3:1", "hunter2-hunter2", nil); w.Code != http.StatusNoContent {
			t.Fatalf("correct login %d: %d", i, w.Code)
		}
	}
}

func TestConcurrentWrongTwoFactorCodesDestroyTheChallenge(t *testing.T) {
	e := newAuthTestEnv(t)
	_, token := setupAndLogin(t, e.r)
	e.enable2FA(t, token)
	ch := e.challenge(t, false)
	before := e.loginFailureCount(t)

	body := `{"challengeToken":"` + ch + `","code":"000000"}`
	codes := fireConcurrently(50, func(int) *httptest.ResponseRecorder { return e.login2fa(body, false) })

	if got := e.loginFailureCount(t) - before; got != twofactor.ChallengeMaxAttempts {
		t.Fatalf("%d codes were verified, want %d (codes %v)", got, twofactor.ChallengeMaxAttempts, codes)
	}
	if got := count(codes, http.StatusNoContent); got != 0 {
		t.Fatalf("a wrong code started a session")
	}
	// The challenge is gone; the password has to be entered again.
	e.Reset()
	w := e.login2fa(body, false)
	if w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), `"challengeExpired":true`) {
		t.Fatalf("challenge should be destroyed: %d %s", w.Code, w.Body)
	}
}

func TestConcurrentTwoFactorCorrectCodeStartsExactlyOneSession(t *testing.T) {
	e := newAuthTestEnv(t)
	_, token := setupAndLogin(t, e.r)
	secret, _ := e.enable2FA(t, token)
	ch := e.challenge(t, false)

	body := `{"challengeToken":"` + ch + `","code":"` + e.currentCode(t, secret) + `"}`
	codes := fireConcurrently(20, func(int) *httptest.ResponseRecorder { return e.login2fa(body, false) })
	if got := count(codes, http.StatusNoContent); got != 1 {
		t.Fatalf("%d sessions started, want exactly 1 (codes %v)", got, codes)
	}
}

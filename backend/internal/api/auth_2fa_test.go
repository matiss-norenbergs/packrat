package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"packrat/backend/internal/ratelimit"
	"packrat/backend/internal/twofactor"
)

const desktopHdr = "X-Client"

func jsonBody[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
		t.Fatalf("decoding %q: %v", w.Body, err)
	}
	return v
}

func (e *authTestEnv) bearer(token string) map[string]string {
	return map[string]string{"Authorization": "Bearer " + token}
}

func (e *authTestEnv) post(path, body, token string) *httptest.ResponseRecorder {
	return authDo(e.r, authReq{method: "POST", path: path, body: body, headers: e.bearer(token)})
}

// currentCode returns the TOTP code valid at the env's clock.
func (e *authTestEnv) currentCode(t *testing.T, secret string) string {
	t.Helper()
	c, err := twofactor.CodeAt(secret, e.clock.t)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// enable2FA walks setup+enable as the (bearer-authenticated) owner and returns the secret and
// recovery codes. The clock moves on a step afterwards so later logins use fresh codes.
func (e *authTestEnv) enable2FA(t *testing.T, token string) (secret string, recovery []string) {
	t.Helper()
	w := e.post("/api/auth/2fa/setup", `{}`, token)
	if w.Code != http.StatusOK {
		t.Fatalf("setup: %d %s", w.Code, w.Body)
	}
	setup := jsonBody[TwoFactorSetupResponse](t, w)
	if !strings.HasPrefix(setup.OtpauthURL, "otpauth://totp/Packrat:admin?") || !strings.Contains(setup.OtpauthURL, "secret="+setup.Secret) {
		t.Fatalf("bad otpauth url %q", setup.OtpauthURL)
	}
	w = e.post("/api/auth/2fa/enable", `{"code":"`+e.currentCode(t, setup.Secret)+`"}`, token)
	if w.Code != http.StatusOK {
		t.Fatalf("enable: %d %s", w.Code, w.Body)
	}
	codes := jsonBody[RecoveryCodesResponse](t, w).RecoveryCodes
	if len(codes) != twofactor.RecoveryCodeCount {
		t.Fatalf("want %d recovery codes, got %d", twofactor.RecoveryCodeCount, len(codes))
	}
	e.clock.advance(time.Duration(twofactor.PeriodSeconds) * time.Second)
	return setup.Secret, codes
}

func (e *authTestEnv) loginStep1(desktop bool) *httptest.ResponseRecorder {
	h := map[string]string{}
	if desktop {
		h[desktopHdr] = "desktop"
	}
	return authDo(e.r, authReq{method: "POST", path: "/api/auth/login", body: creds, headers: h})
}

func (e *authTestEnv) challenge(t *testing.T, desktop bool) string {
	t.Helper()
	w := e.loginStep1(desktop)
	if w.Code != http.StatusOK {
		t.Fatalf("login step 1: %d %s", w.Code, w.Body)
	}
	if len(w.Result().Cookies()) != 0 {
		t.Fatal("password step with 2FA must set no cookies")
	}
	resp := jsonBody[TwoFactorChallengeResponse](t, w)
	if !resp.TwoFactorRequired || resp.ChallengeToken == "" || resp.ExpiresInSeconds != 300 {
		t.Fatalf("bad challenge response %+v", resp)
	}
	return resp.ChallengeToken
}

func (e *authTestEnv) login2fa(body string, desktop bool) *httptest.ResponseRecorder {
	h := map[string]string{}
	if desktop {
		h[desktopHdr] = "desktop"
	}
	return authDo(e.r, authReq{method: "POST", path: "/api/auth/login/2fa", body: body, headers: h})
}

func TestTwoFactorLoginWebAndDesktop(t *testing.T) {
	e := newAuthTestEnv(t)
	_, token := setupAndLogin(t, e.r)
	secret, _ := e.enable2FA(t, token)

	// Web: challenge, then cookies after the code.
	ch := e.challenge(t, false)
	code := e.currentCode(t, secret)
	w := e.login2fa(`{"challengeToken":"`+ch+`","code":"`+code+`"}`, false)
	if w.Code != http.StatusNoContent {
		t.Fatalf("web 2fa: %d %s", w.Code, w.Body)
	}
	cookies := w.Result().Cookies()
	if cookieNamed(cookies, sessionCookieName) == "" || cookieNamed(cookies, csrfCookieName) == "" {
		t.Fatalf("expected session+csrf cookies, got %v", cookies)
	}
	if w := authDo(e.r, authReq{method: "GET", path: "/api/thing", cookies: cookies}); w.Code != http.StatusNoContent {
		t.Fatalf("session from 2fa login unusable: %d", w.Code)
	}

	// The accepted step can't be replayed, even with a fresh challenge.
	ch = e.challenge(t, false)
	if w := e.login2fa(`{"challengeToken":"`+ch+`","code":"`+code+`"}`, false); w.Code != http.StatusUnauthorized {
		t.Fatalf("replayed code: want 401, got %d", w.Code)
	}

	// Desktop: same flow, {token} instead of cookies, only after the second step.
	e.clock.advance(time.Duration(twofactor.PeriodSeconds) * time.Second)
	e.Reset()
	ch = e.challenge(t, true)
	w = e.login2fa(`{"challengeToken":"`+ch+`","code":"`+e.currentCode(t, secret)+`"}`, true)
	if w.Code != http.StatusOK || len(w.Result().Cookies()) != 0 {
		t.Fatalf("desktop 2fa: %d cookies=%v", w.Code, w.Result().Cookies())
	}
	tok := jsonBody[TokenResponse](t, w).Token
	if w := authDo(e.r, authReq{method: "GET", path: "/api/thing", headers: e.bearer(tok)}); w.Code != http.StatusNoContent {
		t.Fatalf("desktop token unusable: %d", w.Code)
	}
}

// Reset clears the limiter between phases of a test that deliberately fails a lot.
func (e *authTestEnv) Reset() { e.deps.Limiter = ratelimit.New(e.clock.now) }

func TestNoOtherPathGivesA2FAAccountASession(t *testing.T) {
	e := newAuthTestEnv(t)
	_, token := setupAndLogin(t, e.r)
	e.enable2FA(t, token)

	// Password step: nothing but a challenge, for web and desktop alike.
	for _, desktop := range []bool{false, true} {
		w := e.loginStep1(desktop)
		if w.Code != http.StatusOK || len(w.Result().Cookies()) != 0 || strings.Contains(w.Body.String(), `"token"`) {
			t.Fatalf("desktop=%v: leaked a session: %d %s", desktop, w.Code, w.Body)
		}
	}
	// The challenge token is not a session credential anywhere.
	ch := e.challenge(t, false)
	if w := authDo(e.r, authReq{method: "GET", path: "/api/thing", headers: e.bearer(ch)}); w.Code != http.StatusUnauthorized {
		t.Fatalf("challenge used as bearer: %d", w.Code)
	}
	if w := authDo(e.r, authReq{method: "GET", path: "/api/thing?token=" + ch}); w.Code != http.StatusUnauthorized {
		t.Fatalf("challenge used as ?token: %d", w.Code)
	}
	// Setup is closed once an account exists, and status stays unauthenticated + 2FA-agnostic.
	if w := authDo(e.r, authReq{method: "POST", path: "/api/auth/setup", body: creds}); w.Code != http.StatusConflict {
		t.Fatalf("setup: %d", w.Code)
	}
	w := authDo(e.r, authReq{method: "GET", path: "/api/auth/status"})
	if strings.Contains(strings.ToLower(w.Body.String()), "two") || strings.Contains(w.Body.String(), "2fa") {
		t.Fatalf("public status leaks 2FA state: %s", w.Body)
	}
	if !strings.Contains(w.Body.String(), `"authenticated":false`) {
		t.Fatalf("status: %s", w.Body)
	}
	// Garbage / missing challenge on the second step.
	for _, body := range []string{`{"challengeToken":"nope","code":"123456"}`, `{"code":"123456"}`} {
		if w := e.login2fa(body, false); w.Code == http.StatusNoContent || w.Code == http.StatusOK {
			t.Fatalf("%s: got a session (%d)", body, w.Code)
		}
	}
}

func TestChallengeDiesAfterFiveWrongCodesAndIsSingleUse(t *testing.T) {
	e := newAuthTestEnv(t)
	_, token := setupAndLogin(t, e.r)
	secret, _ := e.enable2FA(t, token)

	ch := e.challenge(t, false)
	for i := 1; i < twofactor.ChallengeMaxAttempts; i++ {
		w := e.login2fa(`{"challengeToken":"`+ch+`","code":"000000"}`, false)
		if w.Code != http.StatusUnauthorized || strings.Contains(w.Body.String(), "challengeExpired") {
			t.Fatalf("wrong code %d: %d %s", i, w.Code, w.Body)
		}
	}
	w := e.login2fa(`{"challengeToken":"`+ch+`","code":"000000"}`, false)
	if w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), `"challengeExpired":true`) {
		t.Fatalf("5th wrong code must destroy the challenge: %d %s", w.Code, w.Body)
	}
	// Dead, so even the correct code now fails; the password has to be entered again.
	e.Reset()
	if w := e.login2fa(`{"challengeToken":"`+ch+`","code":"`+e.currentCode(t, secret)+`"}`, false); w.Code != http.StatusUnauthorized {
		t.Fatalf("correct code on dead challenge: %d", w.Code)
	}

	ch = e.challenge(t, false)
	body := `{"challengeToken":"` + ch + `","code":"` + e.currentCode(t, secret) + `"}`
	if w := e.login2fa(body, false); w.Code != http.StatusNoContent {
		t.Fatalf("first use: %d %s", w.Code, w.Body)
	}
	if w := e.login2fa(body, false); w.Code != http.StatusUnauthorized {
		t.Fatalf("a challenge is single use: %d", w.Code)
	}

	// Expiry.
	ch = e.challenge(t, false)
	e.clock.advance(twofactor.ChallengeTTL + time.Second)
	e.clock.advance(time.Duration(twofactor.PeriodSeconds) * time.Second)
	w = e.login2fa(`{"challengeToken":"`+ch+`","code":"`+e.currentCode(t, secret)+`"}`, false)
	if w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), "challengeExpired") {
		t.Fatalf("expired challenge: %d %s", w.Code, w.Body)
	}
}

func TestRecoveryCodeSingleUseAndRegeneration(t *testing.T) {
	e := newAuthTestEnv(t)
	_, token := setupAndLogin(t, e.r)
	secret, codes := e.enable2FA(t, token)

	use := func(code string) int {
		ch := e.challenge(t, false)
		return e.login2fa(`{"challengeToken":"`+ch+`","recoveryCode":"`+code+`"}`, false).Code
	}
	// Normalised on input: lower case, no dash, stray spaces.
	messy := " " + strings.ToLower(strings.ReplaceAll(codes[0], "-", "")) + " "
	if c := use(messy); c != http.StatusNoContent {
		t.Fatalf("recovery code: %d", c)
	}
	if c := use(codes[0]); c != http.StatusUnauthorized {
		t.Fatalf("a recovery code is single use: %d", c)
	}
	status := jsonBody[TwoFactorStatusResponse](t, authDo(e.r, authReq{method: "GET", path: "/api/auth/2fa", headers: e.bearer(token)}))
	if !status.Enabled || status.RecoveryCodesRemaining != twofactor.RecoveryCodeCount-1 {
		t.Fatalf("status %+v", status)
	}

	// Regeneration needs the password AND a current code, and invalidates the old set.
	e.Reset()
	if w := e.post("/api/auth/2fa/recovery-codes", `{"password":"wrong-password","code":"`+e.currentCode(t, secret)+`"}`, token); w.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password: %d", w.Code)
	}
	w := e.post("/api/auth/2fa/recovery-codes", `{"password":"hunter2-hunter2","code":"`+e.currentCode(t, secret)+`"}`, token)
	if w.Code != http.StatusOK {
		t.Fatalf("regenerate: %d %s", w.Code, w.Body)
	}
	fresh := jsonBody[RecoveryCodesResponse](t, w).RecoveryCodes
	if len(fresh) != twofactor.RecoveryCodeCount {
		t.Fatalf("got %d codes", len(fresh))
	}
	e.Reset()
	if c := use(codes[1]); c != http.StatusUnauthorized {
		t.Fatalf("old set must be dead: %d", c)
	}
	if c := use(fresh[0]); c != http.StatusNoContent {
		t.Fatalf("new set must work: %d", c)
	}
}

func TestDisableNeedsPasswordAndSecondFactor(t *testing.T) {
	e := newAuthTestEnv(t)
	_, token := setupAndLogin(t, e.r)
	secret, codes := e.enable2FA(t, token)

	if w := e.post("/api/auth/2fa/disable", `{"password":"hunter2-hunter2"}`, token); w.Code != http.StatusBadRequest {
		t.Fatalf("no code: %d", w.Code)
	}
	if w := e.post("/api/auth/2fa/disable", `{"password":"nope-nope-nope","code":"`+e.currentCode(t, secret)+`"}`, token); w.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password: %d", w.Code)
	}
	if w := e.post("/api/auth/2fa/disable", `{"password":"hunter2-hunter2","code":"000000"}`, token); w.Code != http.StatusUnauthorized {
		t.Fatalf("wrong code: %d", w.Code)
	}
	// A recovery code works in place of a TOTP code.
	w := e.post("/api/auth/2fa/disable", `{"password":"hunter2-hunter2","recoveryCode":"`+codes[3]+`"}`, token)
	if w.Code != http.StatusNoContent {
		t.Fatalf("disable: %d %s", w.Code, w.Body)
	}
	// Back to a plain one-step login.
	e.Reset()
	if w := e.loginStep1(false); w.Code != http.StatusNoContent {
		t.Fatalf("login after disable: %d %s", w.Code, w.Body)
	}
	status := jsonBody[TwoFactorStatusResponse](t, authDo(e.r, authReq{method: "GET", path: "/api/auth/2fa", headers: e.bearer(token)}))
	if status.Enabled || status.RecoveryCodesRemaining != 0 {
		t.Fatalf("status %+v", status)
	}
}

func TestEnableRejectsBadCodeAndNeedsSetup(t *testing.T) {
	e := newAuthTestEnv(t)
	_, token := setupAndLogin(t, e.r)
	if w := e.post("/api/auth/2fa/enable", `{"code":"123456"}`, token); w.Code != http.StatusConflict {
		t.Fatalf("enable without setup: %d", w.Code)
	}
	setup := jsonBody[TwoFactorSetupResponse](t, e.post("/api/auth/2fa/setup", `{}`, token))
	if w := e.post("/api/auth/2fa/enable", `{"code":"000000"}`, token); w.Code != http.StatusUnauthorized {
		t.Fatalf("bad code: %d", w.Code)
	}
	if st := jsonBody[TwoFactorStatusResponse](t, authDo(e.r, authReq{method: "GET", path: "/api/auth/2fa", headers: e.bearer(token)})); st.Enabled {
		t.Fatal("must not be enabled by a bad code")
	}
	// Still a one-step login until a good code confirms it.
	if w := e.loginStep1(false); w.Code != http.StatusNoContent {
		t.Fatalf("login before enabling: %d", w.Code)
	}
	if w := e.post("/api/auth/2fa/enable", `{"code":"`+e.currentCode(t, setup.Secret)+`"}`, token); w.Code != http.StatusOK {
		t.Fatalf("enable: %d", w.Code)
	}
	if w := e.post("/api/auth/2fa/setup", `{}`, token); w.Code != http.StatusConflict {
		t.Fatalf("setup while enabled: %d", w.Code)
	}
}

func TestWrongCodesBlockTheIPUntilTheWindowClears(t *testing.T) {
	e := newAuthTestEnv(t)
	_, token := setupAndLogin(t, e.r)
	secret, _ := e.enable2FA(t, token)
	e.Reset()

	// Five wrong codes (each on a fresh challenge) from one address block that address...
	for i := 0; i < ratelimit.PerIPMaxFailures; i++ {
		ch := e.challenge(t, false)
		if w := e.login2fa(`{"challengeToken":"`+ch+`","code":"000000"}`, false); w.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: %d", i+1, w.Code)
		}
	}
	// ...for the password step too, and for the right code.
	w := e.loginStep1(false)
	if w.Code != http.StatusTooManyRequests || w.Header().Get("Retry-After") != "900" {
		t.Fatalf("password step while blocked: %d retry=%q", w.Code, w.Header().Get("Retry-After"))
	}
	if body := jsonBody[struct {
		RetryAfterSeconds int `json:"retryAfterSeconds"`
	}](t, w); body.RetryAfterSeconds != 900 {
		t.Fatalf("body retryAfterSeconds %d", body.RetryAfterSeconds)
	}
	// Another address is unaffected.
	hr := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(creds))
	hr.Header.Set("Content-Type", "application/json")
	hr.RemoteAddr = "10.7.7.7:1"
	rec := httptest.NewRecorder()
	e.r.ServeHTTP(rec, hr)
	if rec.Code != http.StatusOK {
		t.Fatalf("other IP: %d", rec.Code)
	}
	e.clock.advance(ratelimit.PerIPWindow)
	ch := e.challenge(t, false)
	if w := e.login2fa(`{"challengeToken":"`+ch+`","code":"`+e.currentCode(t, secret)+`"}`, false); w.Code != http.StatusNoContent {
		t.Fatalf("after the window: %d %s", w.Code, w.Body)
	}
}

func TestGlobalCodeCooldown(t *testing.T) {
	e := newAuthTestEnv(t)
	_, token := setupAndLogin(t, e.r)
	secret, _ := e.enable2FA(t, token)
	e.Reset()

	// Ten wrong codes in the hour from ten different addresses trip the global code cool-down.
	ch := ""
	for i := 0; i < ratelimit.GlobalMaxCode; i++ {
		ch = e.challenge(t, false)
		hr := httptest.NewRequest("POST", "/api/auth/login/2fa", strings.NewReader(`{"challengeToken":"`+ch+`","code":"000000"}`))
		hr.Header.Set("Content-Type", "application/json")
		hr.RemoteAddr = "10.9.0." + strconv.Itoa(i+1) + ":1"
		e.r.ServeHTTP(httptest.NewRecorder(), hr)
	}
	ch = e.challenge(t, false)
	w := e.login2fa(`{"challengeToken":"`+ch+`","code":"`+e.currentCode(t, secret)+`"}`, false)
	if w.Code != http.StatusTooManyRequests || w.Header().Get("Retry-After") != "900" {
		t.Fatalf("global code cool-down: %d retry=%q", w.Code, w.Header().Get("Retry-After"))
	}
	e.clock.advance(ratelimit.GlobalBaseCooldown)
	ch = e.challenge(t, false)
	if w := e.login2fa(`{"challengeToken":"`+ch+`","code":"`+e.currentCode(t, secret)+`"}`, false); w.Code != http.StatusNoContent {
		t.Fatalf("after cool-down: %d %s", w.Code, w.Body)
	}
}

func TestSecurityNotice(t *testing.T) {
	e := newAuthTestEnv(t)
	_, token := setupAndLogin(t, e.r)
	get := func() SecurityNoticeResponse {
		return jsonBody[SecurityNoticeResponse](t, authDo(e.r, authReq{method: "GET", path: "/api/auth/security-notice", headers: e.bearer(token)}))
	}
	if n := get(); n.FailedAttempts != 0 || n.LastAttemptAt != nil {
		t.Fatalf("fresh account: %+v", n)
	}
	e.clock.advance(5 * time.Second)
	for i := 0; i < 3; i++ {
		loginFrom(e, "10.0.0."+strconv.Itoa(i+1)+":1", "wrong-password", nil)
	}
	n := get()
	if n.FailedAttempts != 3 || n.LastAttemptAt == nil || n.Since == "" {
		t.Fatalf("after failures: %+v", n)
	}
	if w := e.post("/api/auth/security-notice/ack", `{}`, token); w.Code != http.StatusNoContent {
		t.Fatalf("ack: %d", w.Code)
	}
	if n := get(); n.FailedAttempts != 0 {
		t.Fatalf("after ack: %+v", n)
	}
	// Notices need a session.
	if w := authDo(e.r, authReq{method: "GET", path: "/api/auth/security-notice"}); w.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated: %d", w.Code)
	}
}

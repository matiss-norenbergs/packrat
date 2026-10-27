package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/config"
	"packrat/backend/internal/db"
	"packrat/backend/internal/ratelimit"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/twofactor"
)

const tauriOrigin = "tauri://localhost"

// newAuthTestRouter mounts the real auth handlers and middleware (same wiring as SetupRouter) over
// a throwaway DB, with a protected GET and POST route to probe RequireAuth/RequireCSRF.
func newAuthTestRouter(t *testing.T) *gin.Engine {
	t.Helper()
	return newAuthTestEnv(t).r
}

// authTestEnv is the test router plus the pieces tests poke at directly.
type authTestEnv struct {
	r     *gin.Engine
	deps  *AuthDeps
	clock *testClock
	users *repository.UsersRepo
	conn  *sql.DB
}

type testClock struct{ t time.Time }

func (c *testClock) now() time.Time          { return c.t }
func (c *testClock) advance(d time.Duration) { c.t = c.t.Add(d) }

func newAuthTestEnv(t *testing.T) *authTestEnv {
	t.Helper()
	gin.SetMode(gin.TestMode)
	conn, err := db.Open(filepath.Join(t.TempDir(), "packrat_test.db"))
	if err != nil {
		t.Fatalf("opening test db: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	migrationsDir, err := filepath.Abs("../../../database/migrations")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(conn, migrationsDir); err != nil {
		t.Fatalf("migrating test db: %v", err)
	}
	users := repository.NewUsersRepo(conn)
	clock := &testClock{t: time.Now()}
	deps := NewAuthDeps(users, twofactor.NewCrypto([]byte("test-key")), clock.now)

	r := gin.New()
	if err := setTrustedProxies(r, nil); err != nil {
		t.Fatal(err)
	}
	r.Use(CORS(config.DefaultCORSAllowedOrigins))
	public := r.Group("/api")
	public.GET("/auth/status", AuthStatus(users))
	public.POST("/auth/setup", AuthSetup(users))
	public.POST("/auth/login", AuthLogin(deps))
	public.POST("/auth/login/2fa", AuthLogin2FA(deps))
	public.POST("/auth/logout", AuthLogout(users))
	protected := r.Group("/api")
	protected.Use(RequireAuth(users), RequireCSRF())
	ok := func(c *gin.Context) { c.Status(http.StatusNoContent) }
	protected.GET("/thing", ok)
	protected.POST("/thing", ok)
	protected.PATCH("/auth/password", ChangePassword(deps))
	protected.GET("/auth/sessions", ListSessions(users))
	protected.POST("/auth/sessions/revoke-others", RevokeOtherSessions(users))
	protected.DELETE("/auth/sessions/:id", RevokeSession(users))
	protected.GET("/auth/preferences", GetPreferences(repository.NewUserPreferencesRepo(conn)))
	protected.PATCH("/auth/preferences", UpdatePreferences(repository.NewUserPreferencesRepo(conn)))
	protected.GET("/auth/2fa", TwoFactorStatus(deps))
	protected.POST("/auth/2fa/setup", TwoFactorSetup(deps))
	protected.POST("/auth/2fa/enable", TwoFactorEnable(deps))
	protected.POST("/auth/2fa/disable", TwoFactorDisable(deps))
	protected.POST("/auth/2fa/recovery-codes", TwoFactorRegenerateCodes(deps))
	protected.GET("/auth/security-notice", SecurityNotice(deps))
	protected.POST("/auth/security-notice/ack", SecurityNoticeAck(deps))
	return &authTestEnv{r: r, deps: deps, clock: clock, users: users, conn: conn}
}

type authReq struct {
	method, path, body string
	headers            map[string]string
	cookies            []*http.Cookie
}

func authDo(r *gin.Engine, q authReq) *httptest.ResponseRecorder {
	hr := httptest.NewRequest(q.method, q.path, strings.NewReader(q.body))
	hr.Header.Set("Content-Type", "application/json")
	for k, v := range q.headers {
		hr.Header.Set(k, v)
	}
	for _, c := range q.cookies {
		hr.AddCookie(c)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, hr)
	return w
}

const creds = `{"username":"admin","password":"hunter2-hunter2"}`

// setupAndLogin creates the admin and returns the web (cookie) and desktop (bearer) credentials.
func setupAndLogin(t *testing.T, r *gin.Engine) (cookies []*http.Cookie, token string) {
	t.Helper()
	if w := authDo(r, authReq{method: "POST", path: "/api/auth/setup", body: creds}); w.Code != http.StatusNoContent {
		t.Fatalf("setup: %d %s", w.Code, w.Body)
	}
	w := authDo(r, authReq{method: "POST", path: "/api/auth/login", body: creds})
	if w.Code != http.StatusNoContent {
		t.Fatalf("web login: expected 204, got %d", w.Code)
	}
	cookies = w.Result().Cookies()

	w = authDo(r, authReq{method: "POST", path: "/api/auth/login", body: creds, headers: map[string]string{"X-Client": "desktop"}})
	if w.Code != http.StatusOK {
		t.Fatalf("desktop login: expected 200, got %d", w.Code)
	}
	if len(w.Result().Cookies()) != 0 {
		t.Fatalf("desktop login must not set cookies, got %v", w.Result().Cookies())
	}
	var body TokenResponse
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body.Token == "" {
		t.Fatalf("desktop login: no token in body %q (%v)", w.Body, err)
	}
	return cookies, body.Token
}

func cookieNamed(cookies []*http.Cookie, name string) string {
	for _, c := range cookies {
		if c.Name == name {
			return c.Value
		}
	}
	return ""
}

func TestWebCookieAuthUnchanged(t *testing.T) {
	r := newAuthTestRouter(t)
	cookies, _ := setupAndLogin(t, r)
	csrf := cookieNamed(cookies, csrfCookieName)

	if w := authDo(r, authReq{method: "GET", path: "/api/thing"}); w.Code != http.StatusUnauthorized {
		t.Fatalf("no credentials: expected 401, got %d", w.Code)
	}
	if w := authDo(r, authReq{method: "GET", path: "/api/thing", cookies: cookies}); w.Code != http.StatusNoContent {
		t.Fatalf("cookie GET: expected 204, got %d", w.Code)
	}
	// Cookie-authenticated mutations still need the CSRF header...
	if w := authDo(r, authReq{method: "POST", path: "/api/thing", cookies: cookies}); w.Code != http.StatusForbidden {
		t.Fatalf("cookie POST without CSRF header: expected 403, got %d", w.Code)
	}
	if w := authDo(r, authReq{method: "POST", path: "/api/thing", cookies: cookies, headers: map[string]string{"X-CSRF-Token": "wrong"}}); w.Code != http.StatusForbidden {
		t.Fatalf("cookie POST with wrong CSRF header: expected 403, got %d", w.Code)
	}
	if w := authDo(r, authReq{method: "POST", path: "/api/thing", cookies: cookies, headers: map[string]string{"X-CSRF-Token": csrf}}); w.Code != http.StatusNoContent {
		t.Fatalf("cookie POST with CSRF header: expected 204, got %d", w.Code)
	}
	// ...and the X-Client header alone must not weaken that.
	if w := authDo(r, authReq{method: "POST", path: "/api/thing", cookies: cookies, headers: map[string]string{"X-Client": "desktop"}}); w.Code != http.StatusForbidden {
		t.Fatalf("cookie POST claiming desktop without CSRF: expected 403, got %d", w.Code)
	}
}

func TestBearerAuth(t *testing.T) {
	r := newAuthTestRouter(t)
	_, token := setupAndLogin(t, r)
	bearer := map[string]string{"Authorization": "Bearer " + token}

	if w := authDo(r, authReq{method: "GET", path: "/api/thing", headers: bearer}); w.Code != http.StatusNoContent {
		t.Fatalf("bearer GET: expected 204, got %d", w.Code)
	}
	// No CSRF header or cookie: a bearer token isn't ambient, so none is needed.
	if w := authDo(r, authReq{method: "POST", path: "/api/thing", headers: bearer}); w.Code != http.StatusNoContent {
		t.Fatalf("bearer POST: expected 204, got %d", w.Code)
	}
	for _, bad := range []string{"Bearer nope", "Bearer ", "Basic " + token, token} {
		if w := authDo(r, authReq{method: "POST", path: "/api/thing", headers: map[string]string{"Authorization": bad}}); w.Code != http.StatusUnauthorized {
			t.Fatalf("Authorization %q: expected 401, got %d", bad, w.Code)
		}
	}
}

func TestQueryTokenIsGetOnly(t *testing.T) {
	r := newAuthTestRouter(t)
	_, token := setupAndLogin(t, r)

	if w := authDo(r, authReq{method: "GET", path: "/api/thing?token=" + token}); w.Code != http.StatusNoContent {
		t.Fatalf("query-token GET: expected 200-class, got %d", w.Code)
	}
	if w := authDo(r, authReq{method: "HEAD", path: "/api/thing?token=" + token}); w.Code == http.StatusUnauthorized {
		t.Fatalf("query-token HEAD must be accepted, got 401")
	}
	if w := authDo(r, authReq{method: "POST", path: "/api/thing?token=" + token}); w.Code != http.StatusUnauthorized {
		t.Fatalf("query-token POST: expected 401, got %d", w.Code)
	}
	if w := authDo(r, authReq{method: "GET", path: "/api/thing?token=bad"}); w.Code != http.StatusUnauthorized {
		t.Fatalf("bad query token: expected 401, got %d", w.Code)
	}
}

func TestAuthStatusAndLogoutWithBearer(t *testing.T) {
	r := newAuthTestRouter(t)
	_, token := setupAndLogin(t, r)
	bearer := map[string]string{"Authorization": "Bearer " + token}

	authenticated := func(h map[string]string) bool {
		w := authDo(r, authReq{method: "GET", path: "/api/auth/status", headers: h})
		var s AuthStatusResponse
		if err := json.Unmarshal(w.Body.Bytes(), &s); err != nil {
			t.Fatalf("status body %q: %v", w.Body, err)
		}
		return s.Authenticated
	}
	if authenticated(nil) {
		t.Fatal("status without credentials must be unauthenticated")
	}
	if !authenticated(bearer) {
		t.Fatal("status with bearer token must be authenticated")
	}
	if w := authDo(r, authReq{method: "POST", path: "/api/auth/logout", headers: bearer}); w.Code != http.StatusNoContent {
		t.Fatalf("logout: expected 204, got %d", w.Code)
	}
	if authenticated(bearer) {
		t.Fatal("token must stop working after logout")
	}
	if w := authDo(r, authReq{method: "GET", path: "/api/thing", headers: bearer}); w.Code != http.StatusUnauthorized {
		t.Fatalf("revoked token: expected 401, got %d", w.Code)
	}
}

func TestDesktopSetupReturnsToken(t *testing.T) {
	r := newAuthTestRouter(t)
	w := authDo(r, authReq{method: "POST", path: "/api/auth/setup", body: creds, headers: map[string]string{"X-Client": "desktop"}})
	if w.Code != http.StatusOK {
		t.Fatalf("desktop setup: expected 200, got %d %s", w.Code, w.Body)
	}
	var body TokenResponse
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body.Token == "" {
		t.Fatalf("desktop setup: no token in %q", w.Body)
	}
	if w := authDo(r, authReq{method: "GET", path: "/api/thing", headers: map[string]string{"Authorization": "Bearer " + body.Token}}); w.Code != http.StatusNoContent {
		t.Fatalf("token from setup must authenticate, got %d", w.Code)
	}
}

func TestCORS(t *testing.T) {
	r := newAuthTestRouter(t)

	pre := func(origin string) *httptest.ResponseRecorder {
		return authDo(r, authReq{method: "OPTIONS", path: "/api/thing", headers: map[string]string{
			"Origin":                         origin,
			"Access-Control-Request-Method":  "POST",
			"Access-Control-Request-Headers": "authorization",
		}})
	}
	w := pre(tauriOrigin)
	if w.Code != http.StatusNoContent || w.Header().Get("Access-Control-Allow-Origin") != tauriOrigin {
		t.Fatalf("allowed preflight: code %d, headers %v", w.Code, w.Header())
	}
	if !strings.Contains(w.Header().Get("Access-Control-Allow-Headers"), "Authorization") {
		t.Fatalf("preflight must allow Authorization, got %q", w.Header().Get("Access-Control-Allow-Headers"))
	}
	if w.Header().Get("Access-Control-Allow-Credentials") != "" {
		t.Fatal("credentials must never be allowed")
	}

	w = pre("https://evil.example")
	if w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("unlisted origin must get no CORS headers, got %v", w.Header())
	}

	// Actual request from an allowed origin is tagged; one from another origin is not.
	_, token := setupAndLogin(t, r)
	h := map[string]string{"Authorization": "Bearer " + token, "Origin": tauriOrigin}
	if w := authDo(r, authReq{method: "GET", path: "/api/thing", headers: h}); w.Header().Get("Access-Control-Allow-Origin") != tauriOrigin {
		t.Fatalf("allowed origin response missing ACAO: %v", w.Header())
	}
	h["Origin"] = "https://evil.example"
	if w := authDo(r, authReq{method: "GET", path: "/api/thing", headers: h}); w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("unlisted origin response must not carry ACAO: %v", w.Header())
	}
	// No Origin header (same-origin web UI, curl): untouched.
	if w := authDo(r, authReq{method: "GET", path: "/api/auth/status"}); w.Header().Get("Access-Control-Allow-Origin") != "" || w.Header().Get("Vary") != "" {
		t.Fatalf("request without Origin must be untouched: %v", w.Header())
	}
}

func TestCORSDisabledWithEmptyList(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(CORS(nil))
	r.GET("/x", func(c *gin.Context) { c.Status(http.StatusNoContent) })
	w := authDo(r, authReq{method: "GET", path: "/x", headers: map[string]string{"Origin": tauriOrigin}})
	if w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("empty allowlist must add no CORS headers: %v", w.Header())
	}
}

func TestRedactToken(t *testing.T) {
	for in, want := range map[string]string{
		"/media-files/a.mp4?token=abc123":       "/media-files/a.mp4?token=REDACTED",
		"/api/image?root=media&token=abc&w=320": "/api/image?root=media&token=REDACTED&w=320",
		"/api/library?tokens=keep&q=x":          "/api/library?tokens=keep&q=x",
		"/api/library":                          "/api/library",
	} {
		if got := redactToken(in); got != want {
			t.Errorf("redactToken(%q) = %q, want %q", in, got, want)
		}
	}
}

func loginFrom(env *authTestEnv, addr, password string, headers map[string]string) *httptest.ResponseRecorder {
	hr := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"username":"admin","password":"`+password+`"}`))
	hr.Header.Set("Content-Type", "application/json")
	hr.RemoteAddr = addr
	for k, v := range headers {
		hr.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	env.r.ServeHTTP(w, hr)
	return w
}

func TestLoginRateLimitPerIP(t *testing.T) {
	env := newAuthTestEnv(t)
	setupAndLogin(t, env.r)

	for i := 0; i < ratelimit.PerIPMaxFailures; i++ {
		if w := loginFrom(env, "10.0.0.1:1234", "wrong-password", nil); w.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: expected 401, got %d", i+1, w.Code)
		}
	}
	// Blocked now - even the correct password - with Retry-After and a JSON body.
	w := loginFrom(env, "10.0.0.1:1234", "hunter2-hunter2", nil)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", w.Code)
	}
	if got := w.Header().Get("Retry-After"); got != "900" {
		t.Fatalf("Retry-After: want 900, got %q", got)
	}
	var body struct {
		Error             string `json:"error"`
		RetryAfterSeconds int    `json:"retryAfterSeconds"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body.Error == "" || body.RetryAfterSeconds != 900 {
		t.Fatalf("bad 429 body %q (%v)", w.Body, err)
	}
	// A different address is unaffected, and a correct login resets its counters.
	if w := loginFrom(env, "10.0.0.2:1", "hunter2-hunter2", nil); w.Code != http.StatusNoContent {
		t.Fatalf("other IP: expected 204, got %d", w.Code)
	}
	// Once the window clears, the original address works again.
	env.clock.advance(ratelimit.PerIPWindow)
	if w := loginFrom(env, "10.0.0.1:1234", "hunter2-hunter2", nil); w.Code != http.StatusNoContent {
		t.Fatalf("after window: expected 204, got %d", w.Code)
	}
}

func TestForgedForwardedForDoesNotChangeTheKey(t *testing.T) {
	env := newAuthTestEnv(t)
	setupAndLogin(t, env.r)

	for i := 0; i < ratelimit.PerIPMaxFailures; i++ {
		// A different forged address each time must not buy a fresh budget.
		spoof := map[string]string{"X-Forwarded-For": "203.0.113." + strconv.Itoa(i+1), "X-Real-IP": "198.51.100.7"}
		loginFrom(env, "10.0.0.1:1234", "wrong-password", spoof)
	}
	spoof := map[string]string{"X-Forwarded-For": "192.0.2.99"}
	if w := loginFrom(env, "10.0.0.1:1234", "hunter2-hunter2", spoof); w.Code != http.StatusTooManyRequests {
		t.Fatalf("forged XFF must not dodge the block: got %d", w.Code)
	}
}

func TestTrustedProxyHonoursForwardedFor(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	if err := setTrustedProxies(r, []string{"10.0.0.0/8"}); err != nil {
		t.Fatal(err)
	}
	r.GET("/ip", func(c *gin.Context) { c.String(200, c.ClientIP()) })
	for _, tc := range []struct{ remote, want string }{
		{"10.1.2.3:5", "203.0.113.9"}, // from the trusted proxy: believe the header
		{"192.0.2.1:5", "192.0.2.1"},  // from anyone else: ignore it
	} {
		hr := httptest.NewRequest("GET", "/ip", nil)
		hr.RemoteAddr = tc.remote
		hr.Header.Set("X-Forwarded-For", "203.0.113.9")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, hr)
		if w.Body.String() != tc.want {
			t.Fatalf("remote %s: want %s, got %s", tc.remote, tc.want, w.Body)
		}
	}
}

func TestChangePasswordIsRateLimited(t *testing.T) {
	env := newAuthTestEnv(t)
	cookies, token := setupAndLogin(t, env.r)
	_ = cookies
	hdr := map[string]string{"Authorization": "Bearer " + token}
	patch := func(cur string) *httptest.ResponseRecorder {
		return authDo(env.r, authReq{method: "PATCH", path: "/api/auth/password", headers: hdr,
			body: `{"currentPassword":"` + cur + `","newPassword":"another-long-pass"}`})
	}
	for i := 0; i < ratelimit.PerIPMaxFailures; i++ {
		if w := patch("nope-nope-nope"); w.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: expected 401, got %d", i+1, w.Code)
		}
	}
	if w := patch("hunter2-hunter2"); w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", w.Code)
	}
	// Normal authenticated traffic is never limited.
	if w := authDo(env.r, authReq{method: "GET", path: "/api/thing", headers: hdr}); w.Code != http.StatusNoContent {
		t.Fatalf("GET after block: expected 204, got %d", w.Code)
	}
}

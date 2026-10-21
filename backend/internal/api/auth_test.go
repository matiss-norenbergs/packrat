package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/config"
	"packrat/backend/internal/db"
	"packrat/backend/internal/repository"
)

const tauriOrigin = "tauri://localhost"

// newAuthTestRouter mounts the real auth handlers and middleware (same wiring as SetupRouter) over
// a throwaway DB, with a protected GET and POST route to probe RequireAuth/RequireCSRF.
func newAuthTestRouter(t *testing.T) *gin.Engine {
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

	r := gin.New()
	r.Use(CORS(config.DefaultCORSAllowedOrigins))
	public := r.Group("/api")
	public.GET("/auth/status", AuthStatus(users))
	public.POST("/auth/setup", AuthSetup(users))
	public.POST("/auth/login", AuthLogin(users))
	public.POST("/auth/logout", AuthLogout(users))
	protected := r.Group("/api")
	protected.Use(RequireAuth(users), RequireCSRF())
	ok := func(c *gin.Context) { c.Status(http.StatusNoContent) }
	protected.GET("/thing", ok)
	protected.POST("/thing", ok)
	return r
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

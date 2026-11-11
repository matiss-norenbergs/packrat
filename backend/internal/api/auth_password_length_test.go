package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// bcrypt reads at most 72 BYTES; a longer new password is refused with a clear
// 400 instead of a 500 carrying bcrypt's error text.
var tooLongPasswords = map[string]string{
	"73 ascii bytes":             strings.Repeat("a", 73),
	"40 chars but 80 bytes":      strings.Repeat("é", 40),
	"24 chars but 96 bytes (4B)": strings.Repeat("😀", 24),
}

func passwordBody(user, pw string) string {
	return `{"username":"` + user + `","password":"` + pw + `"}`
}

func TestSetupRejectsPasswordOver72Bytes(t *testing.T) {
	env := newAuthTestEnv(t)
	for name, pw := range tooLongPasswords {
		w := authDo(env.r, authReq{method: "POST", path: "/api/auth/setup", body: passwordBody("admin", pw)})
		if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "Password must be at most 72 bytes.") {
			t.Errorf("%s: status %d body %s", name, w.Code, w.Body)
		}
	}
	// Nothing was created, and exactly 72 bytes is still fine.
	if n, _ := env.users.Count(t.Context()); n != 0 {
		t.Fatalf("a rejected setup created %d users", n)
	}
	w := authDo(env.r, authReq{method: "POST", path: "/api/auth/setup", body: passwordBody("admin", strings.Repeat("a", 72))})
	if w.Code != http.StatusNoContent {
		t.Fatalf("72 bytes: status %d %s", w.Code, w.Body)
	}
}

func TestChangePasswordRejectsPasswordOver72Bytes(t *testing.T) {
	env := newAuthTestEnv(t)
	_, token := setupAndLogin(t, env.r)
	hdr := map[string]string{"Authorization": "Bearer " + token}
	patch := func(newPw string) *httptest.ResponseRecorder {
		return authDo(env.r, authReq{method: "PATCH", path: "/api/auth/password", headers: hdr,
			body: `{"currentPassword":"hunter2-hunter2","newPassword":"` + newPw + `"}`})
	}
	for name, pw := range tooLongPasswords {
		w := patch(pw)
		if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "Password must be at most 72 bytes.") {
			t.Errorf("%s: status %d body %s", name, w.Code, w.Body)
		}
	}
	// The old password still works (nothing was changed) ...
	if w := authDo(env.r, authReq{method: "POST", path: "/api/auth/login", body: creds}); w.Code != http.StatusNoContent {
		t.Fatalf("old password after rejected change: %d", w.Code)
	}
	// ... and exactly 72 bytes is accepted.
	if w := patch(strings.Repeat("b", 72)); w.Code != http.StatusNoContent {
		t.Fatalf("72 bytes: status %d %s", w.Code, w.Body)
	}
}

// Logging in (or confirming a password) with an over-long password is the
// normal 401, never a 500.
func TestLoginWithPasswordOver72BytesIs401(t *testing.T) {
	env := newAuthTestEnv(t)
	_, token := setupAndLogin(t, env.r)
	for name, pw := range tooLongPasswords {
		w := authDo(env.r, authReq{method: "POST", path: "/api/auth/login", body: passwordBody("admin", pw)})
		if w.Code != http.StatusUnauthorized {
			t.Errorf("login %s: status %d %s", name, w.Code, w.Body)
		}
		w = authDo(env.r, authReq{method: "POST", path: "/api/auth/login", body: passwordBody("nobody", pw)})
		if w.Code != http.StatusUnauthorized {
			t.Errorf("login unknown user %s: status %d %s", name, w.Code, w.Body)
		}
		// The current-password check of change-password.
		w = authDo(env.r, authReq{method: "PATCH", path: "/api/auth/password",
			headers: map[string]string{"Authorization": "Bearer " + token},
			body:    `{"currentPassword":"` + pw + `","newPassword":"another-long-pass"}`})
		if w.Code != http.StatusUnauthorized {
			t.Errorf("change-password current %s: status %d %s", name, w.Code, w.Body)
		}
	}
}

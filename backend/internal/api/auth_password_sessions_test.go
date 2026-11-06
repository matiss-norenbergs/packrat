package api

import (
	"net/http"
	"testing"
)

func TestChangePasswordSignsOutOtherSessions(t *testing.T) {
	e := newAuthTestEnv(t)
	_, token := setupAndLogin(t, e.r) // desktop bearer token
	cookies := e.webLogin(t, "10.0.0.2:1", webUA)

	w := authDo(e.r, authReq{method: "PATCH", path: "/api/auth/password", cookies: cookies,
		headers: csrfHeaders(cookies),
		body:    `{"currentPassword":"hunter2-hunter2","newPassword":"another-long-pass"}`})
	if w.Code != http.StatusNoContent {
		t.Fatalf("change password: %d %s", w.Code, w.Body)
	}
	if w := authDo(e.r, authReq{method: "GET", path: "/api/thing", cookies: cookies}); w.Code != http.StatusNoContent {
		t.Fatalf("current session: expected 204, got %d", w.Code)
	}
	bearer := map[string]string{"Authorization": "Bearer " + token}
	if w := authDo(e.r, authReq{method: "GET", path: "/api/thing", headers: bearer}); w.Code != http.StatusUnauthorized {
		t.Fatalf("other session: expected 401, got %d", w.Code)
	}
}

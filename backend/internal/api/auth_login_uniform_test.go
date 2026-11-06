package api

import (
	"net/http"
	"testing"
)

func TestLoginUnknownUserAndWrongPasswordLookAlike(t *testing.T) {
	e := newAuthTestEnv(t)
	setupAndLogin(t, e.r)
	post := func(body string) (int, string) {
		w := authDo(e.r, authReq{method: "POST", path: "/api/auth/login", body: body})
		return w.Code, w.Body.String()
	}
	c1, b1 := post(`{"username":"nobody","password":"wrong-password-1"}`)
	c2, b2 := post(`{"username":"admin","password":"wrong-password-1"}`)
	if c1 != http.StatusUnauthorized || c1 != c2 || b1 != b2 {
		t.Fatalf("unknown user %d %q vs wrong password %d %q", c1, b1, c2, b2)
	}
}

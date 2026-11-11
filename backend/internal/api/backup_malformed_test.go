package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"packrat/backend/internal/backup"
)

// importEndpoints is every route that opens an uploaded backup envelope, with
// the kind of envelope it expects.
var importEndpoints = []struct{ path, kind string }{
	{"/backup/import/settings", "settings"},
	{"/backup/preview/library", "library"},
	{"/backup/import/library", "library"},
	{"/backup/preview/full", "full"},
	{"/backup/import/full", "full"},
}

func envelopeBody(t *testing.T, env backup.Envelope, password string) string {
	t.Helper()
	raw, err := json.Marshal(env)
	if err != nil {
		t.Fatal(err)
	}
	body := map[string]any{"data": string(raw)}
	if password != "" {
		body["password"] = password
	}
	return bkJSON(t, body)
}

// Malformed base64 in an uploaded envelope (data or salt) is a client error:
// 400 with a fixed message that does not echo the decoder's error.
func TestMalformedBackupEnvelopeIs400(t *testing.T) {
	e := newBkEnv(t)
	for _, ep := range importEndpoints {
		t.Run(ep.path, func(t *testing.T) {
			// Plain envelope, data is not base64.
			bad := backup.Envelope{Packrat: true, Version: 1, Kind: ep.kind, Data: "!!!not base64"}
			w := e.post(ep.path, envelopeBody(t, bad, ""))
			e.want(w, http.StatusBadRequest)
			if !strings.Contains(w.Body.String(), "The backup file is not valid.") {
				t.Errorf("bad data: body = %s", w.Body)
			}
			if strings.Contains(w.Body.String(), "illegal base64") {
				t.Errorf("bad data: decoder error leaked: %s", w.Body)
			}

			// Encrypted envelope with a valid data blob and a bad salt.
			sealed, err := backup.Seal(ep.kind, []byte(`{}`), "pw-for-test")
			if err != nil {
				t.Fatal(err)
			}
			sealed.Salt = "***bad salt***"
			w = e.post(ep.path, envelopeBody(t, sealed, "pw-for-test"))
			e.want(w, http.StatusBadRequest)
			if !strings.Contains(w.Body.String(), "The backup file is not valid.") {
				t.Errorf("bad salt: body = %s", w.Body)
			}
		})
	}
}

// A wrong password and a corrupted ciphertext keep their existing 400 and
// message (they are not "malformed").
func TestWrongPasswordAndCorruptCiphertextStatusUnchanged(t *testing.T) {
	e := newBkEnv(t)
	sealed, err := backup.Seal("full", []byte(`{}`), "right-password")
	if err != nil {
		t.Fatal(err)
	}
	w := e.post("/backup/import/full", envelopeBody(t, sealed, "wrong-password"))
	e.want(w, http.StatusBadRequest)
	if !strings.Contains(w.Body.String(), backup.ErrIncorrectPassword.Error()) {
		t.Errorf("wrong password: body = %s", w.Body)
	}

	// Valid base64, too short to hold a nonce.
	sealed.Data = "AAAA"
	w = e.post("/backup/import/full", envelopeBody(t, sealed, "right-password"))
	e.want(w, http.StatusBadRequest)
	if !strings.Contains(w.Body.String(), backup.ErrIncorrectPassword.Error()) {
		t.Errorf("corrupt ciphertext: body = %s", w.Body)
	}
}

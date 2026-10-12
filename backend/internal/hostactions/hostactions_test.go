package hostactions

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseOrdersByNumberAndAppliesDefaults(t *testing.T) {
	actions, err := Parse([]string{
		"PATH=/usr/bin",
		"PACKRAT_ACTION_10_LABEL=Stop SD",
		"PACKRAT_ACTION_10_URL=http://host.docker.internal:7870/stop",
		"PACKRAT_ACTION_10_CONFIRM=true",
		"PACKRAT_ACTION_2_LABEL=Start SD",
		"PACKRAT_ACTION_2_URL=http://host.docker.internal:7870/start",
		"PACKRAT_ACTION_2_TOKEN=secret",
		"PACKRAT_ACTION_2_METHOD=post",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(actions) != 2 {
		t.Fatalf("got %d actions, want 2", len(actions))
	}
	if actions[0].ID != "2" || actions[0].Label != "Start SD" || actions[0].Method != "POST" || actions[0].Token != "secret" || actions[0].Confirm {
		t.Errorf("unexpected first action: %+v", actions[0])
	}
	if actions[1].ID != "10" || actions[1].Method != "POST" || !actions[1].Confirm {
		t.Errorf("unexpected second action: %+v", actions[1])
	}
}

func TestParseNone(t *testing.T) {
	actions, err := Parse([]string{"HOME=/root"})
	if err != nil || len(actions) != 0 {
		t.Fatalf("got %v, %v; want no actions", actions, err)
	}
}

func TestParseErrors(t *testing.T) {
	cases := map[string][]string{
		"missing label":  {"PACKRAT_ACTION_1_URL=http://x/start"},
		"missing url":    {"PACKRAT_ACTION_1_LABEL=Go"},
		"bad scheme":     {"PACKRAT_ACTION_1_LABEL=Go", "PACKRAT_ACTION_1_URL=file:///etc/passwd"},
		"bad method":     {"PACKRAT_ACTION_1_LABEL=Go", "PACKRAT_ACTION_1_URL=http://x/", "PACKRAT_ACTION_1_METHOD=DELETE"},
		"bad confirm":    {"PACKRAT_ACTION_1_LABEL=Go", "PACKRAT_ACTION_1_URL=http://x/", "PACKRAT_ACTION_1_CONFIRM=maybe"},
		"unknown field":  {"PACKRAT_ACTION_1_LABLE=Go"},
		"non-numeric id": {"PACKRAT_ACTION_SD_LABEL=Go"},
		"zero id":        {"PACKRAT_ACTION_0_LABEL=Go"},
		"no field":       {"PACKRAT_ACTION_1=Go"},
	}
	for name, env := range cases {
		if _, err := Parse(env); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestRunSendsTokenAndReadsMessage(t *testing.T) {
	var gotAuth, gotMethod string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth, gotMethod = r.Header.Get("Authorization"), r.Method
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"ok":true,"message":"Starting Stable Diffusion"}`))
	}))
	defer srv.Close()

	res, err := Run(context.Background(), Action{URL: srv.URL + "/start", Method: "POST", Token: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	if gotAuth != "Bearer secret" || gotMethod != "POST" {
		t.Errorf("auth=%q method=%q", gotAuth, gotMethod)
	}
	if !res.OK || res.Status != http.StatusAccepted || res.Message != "Starting Stable Diffusion" {
		t.Errorf("unexpected result: %+v", res)
	}
}

func TestRunNonJSONAndFailureStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("no token configured, but an Authorization header was sent")
		}
		http.Error(w, "nope", http.StatusUnauthorized)
	}))
	defer srv.Close()

	res, err := Run(context.Background(), Action{URL: srv.URL, Method: "GET"})
	if err != nil {
		t.Fatal(err)
	}
	if res.OK || res.Status != http.StatusUnauthorized || res.Message != "nope" {
		t.Errorf("unexpected result: %+v", res)
	}
}

func TestRunUnreachableRedactsURL(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL + "/start?key=hunter2"
	srv.Close()

	_, err := Run(context.Background(), Action{URL: url, Method: "POST"})
	if err == nil {
		t.Fatal("expected an error for a closed server")
	}
	if strings.Contains(err.Error(), "hunter2") {
		t.Errorf("error leaks the query string: %v", err)
	}
}

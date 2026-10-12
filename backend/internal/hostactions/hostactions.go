// Package hostactions backs the sidebar's "Actions" menu: a fixed list of
// HTTP requests (e.g. "start Stable Diffusion" via tools/sd-launcher) that
// the admin defines in PACKRAT_ACTION_<N>_* environment variables. They are
// deliberately env-only, never editable through the UI or the settings
// table, so anyone with a web session can press the buttons but can't
// point them somewhere new. URLs and tokens never leave the backend.
package hostactions

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	envPrefix      = "PACKRAT_ACTION_"
	requestTimeout = 15 * time.Second
	maxMessageLen  = 300
)

// Action is one configured menu entry. ID is the <N> from its env vars.
type Action struct {
	ID      string
	Label   string
	URL     string
	Method  string // GET or POST
	Token   string // sent as "Authorization: Bearer <token>" when set
	Confirm bool   // ask in the UI before running
}

// Parse reads PACKRAT_ACTION_<N>_{LABEL,URL,METHOD,TOKEN,CONFIRM} out of an
// os.Environ()-style list, ordered by N. Any malformed entry is an error so
// a typo fails startup loudly instead of silently dropping a button.
func Parse(environ []string) ([]Action, error) {
	byID := map[int]map[string]string{}
	for _, kv := range environ {
		key, value, ok := strings.Cut(kv, "=")
		if !ok || !strings.HasPrefix(key, envPrefix) {
			continue
		}
		rest := strings.TrimPrefix(key, envPrefix)
		idPart, field, ok := strings.Cut(rest, "_")
		if !ok {
			return nil, fmt.Errorf("%s: expected %s<N>_<FIELD>", key, envPrefix)
		}
		n, err := strconv.Atoi(idPart)
		if err != nil || n < 1 {
			return nil, fmt.Errorf("%s: <N> must be a positive integer", key)
		}
		switch field {
		case "LABEL", "URL", "METHOD", "TOKEN", "CONFIRM":
		default:
			return nil, fmt.Errorf("%s: unknown field %q (want LABEL, URL, METHOD, TOKEN or CONFIRM)", key, field)
		}
		if byID[n] == nil {
			byID[n] = map[string]string{}
		}
		byID[n][field] = strings.TrimSpace(value)
	}

	ids := make([]int, 0, len(byID))
	for n := range byID {
		ids = append(ids, n)
	}
	sort.Ints(ids)

	actions := make([]Action, 0, len(ids))
	for _, n := range ids {
		f := byID[n]
		name := fmt.Sprintf("%s%d", envPrefix, n)
		a := Action{ID: strconv.Itoa(n), Label: f["LABEL"], URL: f["URL"], Method: strings.ToUpper(f["METHOD"]), Token: f["TOKEN"]}
		if a.Label == "" {
			return nil, fmt.Errorf("%s_LABEL is required", name)
		}
		u, err := url.Parse(a.URL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return nil, fmt.Errorf("%s_URL must be an http(s) URL, got %q", name, a.URL)
		}
		if a.Method == "" {
			a.Method = http.MethodPost
		}
		if a.Method != http.MethodGet && a.Method != http.MethodPost {
			return nil, fmt.Errorf("%s_METHOD must be GET or POST, got %q", name, a.Method)
		}
		if raw := f["CONFIRM"]; raw != "" {
			a.Confirm, err = strconv.ParseBool(raw)
			if err != nil {
				return nil, fmt.Errorf("%s_CONFIRM must be true or false, got %q", name, raw)
			}
		}
		actions = append(actions, a)
	}
	return actions, nil
}

// Result is what the target answered. OK is a 2xx status.
type Result struct {
	OK      bool
	Status  int
	Message string
}

var httpClient = &http.Client{Timeout: requestTimeout}

// Run sends the action's request. An error means no HTTP response arrived
// at all (unreachable, timeout); a non-2xx answer is a Result with OK false.
// Message is the response's JSON "message" field when there is one (the
// SD launcher's convention), otherwise the start of the body as text.
func Run(ctx context.Context, a Action) (Result, error) {
	req, err := http.NewRequestWithContext(ctx, a.Method, a.URL, nil)
	if err != nil {
		return Result{}, fmt.Errorf("building request: %w", err)
	}
	if a.Token != "" {
		req.Header.Set("Authorization", "Bearer "+a.Token)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		// *url.Error repeats the full URL (query included); keep only the cause.
		var uerr *url.Error
		if errors.As(err, &uerr) {
			err = uerr.Err
		}
		return Result{}, fmt.Errorf("calling %s: %w", redact(a.URL), err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	return Result{
		OK:      resp.StatusCode >= 200 && resp.StatusCode < 300,
		Status:  resp.StatusCode,
		Message: messageFrom(body, resp.Status),
	}, nil
}

func messageFrom(body []byte, status string) string {
	var parsed struct {
		Message string `json:"message"`
	}
	msg := ""
	if json.Unmarshal(body, &parsed) == nil {
		msg = parsed.Message
	} else {
		msg = string(body)
	}
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return status
	}
	if r := []rune(msg); len(r) > maxMessageLen {
		msg = string(r[:maxMessageLen]) + "…"
	}
	return msg
}

// redact drops any userinfo/query from a URL before it goes into an error
// message the UI might show.
func redact(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "action URL"
	}
	u.User = nil
	u.RawQuery = ""
	return u.String()
}

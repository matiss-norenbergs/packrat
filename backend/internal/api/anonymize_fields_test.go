package api

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"packrat/backend/internal/models"
)

func strp(s string) *string { return &s }

func TestToLogEntryResponse_RedactsCredentials(t *testing.T) {
	d := models.Download{
		URL:          "https://example.com/watch?v=abcdefghijk",
		YtDlpCommand: strp("yt-dlp --cookies /data/c.txt --proxy http://bob:hunter2@p:3128 https://example.com/watch?v=abcdefghijk"),
		StderrTail:   strp("proxy http://bob:hunter2@p:3128 refused"),
		ErrorMessage: strp("failed via http://bob:hunter2@p:3128"),
		CreatedAt:    time.Now(),
	}
	b, _ := json.Marshal(toLogEntryResponse(d, false))
	for _, leak := range []string{"hunter2", "bob", "/data/c.txt"} {
		if strings.Contains(string(b), leak) {
			t.Errorf("response leaks %q: %s", leak, b)
		}
	}
	if !strings.Contains(string(b), "example.com/watch") {
		t.Errorf("without anonymization the URL stays visible: %s", b)
	}
}

func TestToLogEntryResponse_AnonymizeCoversOtherFields(t *testing.T) {
	url := "https://example.com/watch?v=abcdefghijk"
	d := models.Download{
		URL:          url,
		VideoID:      strp("abcdefghijk"),
		Title:        strp("Secret title"),
		YtDlpCommand: strp("yt-dlp " + url),
		StdoutTail:   strp("[youtube] abcdefghijk: Downloading"),
		StderrTail:   strp("ERROR: " + url),
		ErrorMessage: strp("download of " + url + " failed (id abcdefghijk)"),
		CreatedAt:    time.Now(),
	}
	resp := toLogEntryResponse(d, true)
	b, _ := json.Marshal(resp)
	for _, leak := range []string{"example.com", "abcdefghijk", "Secret title"} {
		if strings.Contains(string(b), leak) {
			t.Errorf("anonymized response leaks %q: %s", leak, b)
		}
	}
	if resp.YtDlpCommand != nil || resp.StdoutTail != nil || resp.StderrTail != nil {
		t.Errorf("command/tails must be blank: %s", b)
	}
	hash := anonymizeURL(url)
	if resp.URL != hash || resp.ErrorMessage == nil || !strings.Contains(*resp.ErrorMessage, hash) {
		t.Errorf("errorMessage should carry the same hash as url: %s", b)
	}
}

func TestToHistoryResponse_AnonymizeErrorMessage(t *testing.T) {
	url := "https://user:pw@example.com/watch?v=abcdefghijk"
	h := models.History{
		URL:          url,
		VideoID:      strp("abcdefghijk"),
		ErrorMessage: strp("ERROR: [youtube] abcdefghijk: Video unavailable; " + url),
		CreatedAt:    time.Now(),
	}
	b, _ := json.Marshal(toHistoryResponse(h, true))
	for _, leak := range []string{"example.com", "abcdefghijk", "pw@"} {
		if strings.Contains(string(b), leak) {
			t.Errorf("anonymized history leaks %q: %s", leak, b)
		}
	}
	if !strings.Contains(string(b), anonymizeURL(url)) {
		t.Errorf("hash missing: %s", b)
	}
	// Without anonymization credentials are still masked.
	if resp := toHistoryResponse(h, false); resp.ErrorMessage == nil || strings.Contains(*resp.ErrorMessage, "pw@") {
		t.Errorf("credentials leaked in errorMessage with anonymization off: %v", resp.ErrorMessage)
	}
}

func TestAnonymizedPtr(t *testing.T) {
	const id = "dQw4w9WgXcQ"
	const pl = "PLabcdef123456"
	watch := "https://www.youtube.com/watch?v=" + id
	listURL := "https://www.youtube.com/watch?v=" + id + "&list=" + pl
	hashW := anonymizeURL(watch)
	hashL := anonymizeURL(listURL)

	tests := []struct {
		name    string
		msg     string
		url     string
		videoID *string
		want    string
	}{
		{
			name: "bare id with nil stored id",
			msg:  "ERROR: [youtube] " + id + ": Unable to download API page: proxy refused",
			url:  watch,
			want: "ERROR: [youtube] " + hashW + ": Unable to download API page: proxy refused",
		},
		{
			name: "id repeated and inside a longer path",
			msg:  id + " failed; see /tmp/" + id + "/part and " + id,
			url:  watch,
			want: hashW + " failed; see /tmp/" + hashW + "/part and " + hashW,
		},
		{
			name: "id only via extractor prefix",
			msg:  "ERROR: [youtube] zzzzzzzzzzz: Video unavailable",
			url:  "https://youtu.be/redirected",
			want: "ERROR: [youtube] " + anonymizeURL("https://youtu.be/redirected") + ": Video unavailable",
		},
		{
			name: "ordinary words and host stay",
			msg:  "watch: Unable to download API page; HTTP Error 403 from www.youtube.com",
			url:  watch,
			want: "watch: Unable to download API page; HTTP Error 403 from www.youtube.com",
		},
		{
			name: "query values masked",
			msg:  "no video " + id + " in list " + pl,
			url:  listURL,
			want: "no video " + hashL + " in list " + hashL,
		},
		{
			name: "short tokens untouched",
			msg:  "item abc12 (v=ab) failed",
			url:  "https://example.com/abc12?v=ab",
			want: "item abc12 (v=ab) failed",
		},
		{
			name: "longer token first",
			msg:  "x " + id + "-extra y " + id,
			url:  "https://example.com/" + id + "-extra?v=" + id,
			want: "x " + anonymizeURL("https://example.com/"+id+"-extra?v="+id) + " y " + anonymizeURL("https://example.com/"+id+"-extra?v="+id),
		},
		{
			name: "progress and destination lines kept",
			msg:  "[download] 50% of 10MiB\n[download] Destination: out.mp4\nERROR: [youtube:tab] no tabs",
			url:  watch,
			want: "[download] 50% of 10MiB\n[download] Destination: out.mp4\nERROR: [youtube:tab] no tabs",
		},
		{
			name:    "stored id still masked",
			msg:     "id abcd here",
			url:     "https://example.com/",
			videoID: strp("abcd"),
			want:    "id " + anonymizeURL("https://example.com/") + " here",
		},
		{name: "no identifiers unchanged", msg: "connection reset", url: watch, want: "connection reset"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := anonymizedPtr(strp(tc.msg), tc.url, tc.videoID)
			if got == nil || *got != tc.want {
				t.Errorf("got %v, want %q", got, tc.want)
			}
		})
	}
	if anonymizedPtr(nil, watch, nil) != nil {
		t.Error("nil message must stay nil")
	}
}

func TestResponses_AnonymizeBareIDInErrorMessage(t *testing.T) {
	const id = "dQw4w9WgXcQ"
	url := "https://www.youtube.com/watch?v=" + id
	msg := "ERROR: [youtube] " + id + ": Unable to download API page"

	h := models.History{URL: url, ErrorMessage: strp(msg), CreatedAt: time.Now()}
	if r := toHistoryResponse(h, true); r.ErrorMessage == nil || strings.Contains(*r.ErrorMessage, id) {
		t.Errorf("history errorMessage leaks the id: %v", r.ErrorMessage)
	}
	d := models.Download{URL: url, ErrorMessage: strp(msg), CreatedAt: time.Now()}
	if r := toLogEntryResponse(d, true); r.ErrorMessage == nil || strings.Contains(*r.ErrorMessage, id) {
		t.Errorf("log errorMessage leaks the id: %v", r.ErrorMessage)
	}
}

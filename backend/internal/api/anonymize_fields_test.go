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

package downloader

import (
	"strings"
	"testing"
)

func TestRedactArgs(t *testing.T) {
	args := buildGlobalArgs("", "", "/data/cookies.txt", "http://bob:hunter2@proxy.local:3128", "", "")
	args = append(args, "https://alice:pw@example.com/watch?v=abc", "-o", "/media/x.%(ext)s")
	got := strings.Join(RedactArgs(args), " ")
	for _, leak := range []string{"hunter2", "bob", "alice", "pw@", "/data/cookies.txt"} {
		if strings.Contains(got, leak) {
			t.Errorf("redacted args still contain %q: %s", leak, got)
		}
	}
	for _, keep := range []string{"--proxy http://REDACTED@proxy.local:3128", "--cookies REDACTED", "https://REDACTED@example.com/watch?v=abc", "/media/x.%(ext)s"} {
		if !strings.Contains(got, keep) {
			t.Errorf("redacted args lost %q: %s", keep, got)
		}
	}
	// The input slice is untouched.
	if args[1] != "/data/cookies.txt" {
		t.Errorf("RedactArgs mutated its input: %v", args)
	}
}

func TestRedactArgs_SchemelessProxyAndEqualsForm(t *testing.T) {
	got := strings.Join(RedactArgs([]string{"--proxy", "bob:hunter2@10.0.0.1:8080", "--proxy=u:p@h:1", "--cookies=/x/c.txt"}), " ")
	if strings.Contains(got, "hunter2") || strings.Contains(got, "u:p") || strings.Contains(got, "/x/c.txt") {
		t.Errorf("leak: %s", got)
	}
	if !strings.Contains(got, "10.0.0.1:8080") {
		t.Errorf("host should stay visible: %s", got)
	}
}

func TestRedactArgs_NoProxyUnchanged(t *testing.T) {
	in := []string{"-f", "best", "--proxy", "http://proxy.local:3128", "https://example.com/v"}
	got := RedactArgs(in)
	for i := range in {
		if got[i] != in[i] {
			t.Errorf("arg %d changed: %q -> %q", i, in[i], got[i])
		}
	}
}

func TestRedactCommand(t *testing.T) {
	stored := "yt-dlp --cookies /data/cookies.txt --proxy socks5://bob:hunter2@p:1080 --retries 3 https://u:p@example.com/v"
	got := RedactCommand(stored)
	for _, leak := range []string{"hunter2", "bob", "u:p@", "/data/cookies.txt"} {
		if strings.Contains(got, leak) {
			t.Errorf("stored command still leaks %q: %s", leak, got)
		}
	}
	if !strings.Contains(got, "--retries 3") {
		t.Errorf("unrelated flags must survive: %s", got)
	}
	if RedactCommand("yt-dlp -f best https://example.com/v") != "yt-dlp -f best https://example.com/v" {
		t.Error("a clean command must be unchanged")
	}
}

func TestRedactText(t *testing.T) {
	got := RedactText("ERROR: unable to connect to proxy http://bob:hunter2@p:3128 (timeout)")
	if strings.Contains(got, "hunter2") || !strings.Contains(got, "timeout") {
		t.Errorf("got %q", got)
	}
}

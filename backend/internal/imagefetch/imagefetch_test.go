package imagefetch

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"strings"
	"sync/atomic"
	"testing"
)

var (
	policyOn  = Policy{BlockPrivate: true, MaxBytes: 1024}
	policyOff = Policy{MaxBytes: 1024}
)

func imageServer(body string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		io.WriteString(w, body)
	}))
}

func TestBlockedAddrTable(t *testing.T) {
	blocked := []string{
		"127.0.0.1", "127.255.0.3", "::1", "0.0.0.0", "::", "0.1.2.3",
		"169.254.169.254", "169.254.0.1", "fe80::1",
		"10.0.0.1", "172.16.5.5", "172.31.255.255", "192.168.1.1", "fc00::1", "fd12::1",
		"100.64.0.1", "100.127.255.255",
		"224.0.0.1", "ff02::1", "255.255.255.255", "240.0.0.1",
		"::ffff:127.0.0.1", "::ffff:169.254.169.254", "::ffff:10.0.0.1", "64:ff9b::7f00:1",
	}
	for _, s := range blocked {
		if !blockedAddr(netip.MustParseAddr(s)) {
			t.Errorf("%s should be blocked", s)
		}
	}
	public := []string{"8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"}
	for _, s := range public {
		if blockedAddr(netip.MustParseAddr(s)) {
			t.Errorf("%s should be allowed", s)
		}
	}
}

func TestPolicyOnRefusesBlockedLiterals(t *testing.T) {
	for _, host := range []string{"127.0.0.1", "[::1]", "0.0.0.0", "169.254.169.254", "10.1.2.3", "192.168.0.9", "100.64.1.1", "[::ffff:127.0.0.1]"} {
		_, _, err := Fetch(context.Background(), "http://"+host+":9/x.png", t.TempDir(), "t", true, "", policyOn)
		if !errors.Is(err, ErrBlockedAddress) {
			t.Errorf("%s: err = %v, want ErrBlockedAddress", host, err)
		}
		_, _, _, cancel, err := Open(context.Background(), "http://"+host+":9/x.png", "", policyOn)
		cancel()
		if !errors.Is(err, ErrBlockedAddress) {
			t.Errorf("Open %s: err = %v, want ErrBlockedAddress", host, err)
		}
	}
}

func TestPolicyOnRefusesRunningLoopbackServer(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1) }))
	defer srv.Close()
	_, _, err := Fetch(context.Background(), srv.URL, t.TempDir(), "t", true, "", policyOn)
	if !errors.Is(err, ErrBlockedAddress) {
		t.Fatalf("err = %v", err)
	}
	if hits.Load() != 0 {
		t.Fatal("server was contacted")
	}
}

func TestPolicyOnRefusesHostnameResolvingToLoopback(t *testing.T) {
	srv := imageServer("x")
	defer srv.Close()
	u := strings.Replace(srv.URL, "127.0.0.1", "localhost", 1)
	_, _, err := Fetch(context.Background(), u, t.TempDir(), "t", true, "", policyOn)
	if !errors.Is(err, ErrBlockedAddress) {
		t.Fatalf("err = %v", err)
	}
}

func TestPolicyOnRefusesRedirectHop(t *testing.T) {
	// The first server (127.0.0.1) is treated as public; 127.0.0.2 is not.
	old := isBlockedAddr
	isBlockedAddr = func(ip netip.Addr) bool { return ip == netip.MustParseAddr("127.0.0.2") }
	defer func() { isBlockedAddr = old }()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://127.0.0.2:9/internal.png", http.StatusFound)
	}))
	defer srv.Close()
	_, _, err := Fetch(context.Background(), srv.URL, t.TempDir(), "t", true, "", policyOn)
	if !errors.Is(err, ErrBlockedAddress) {
		t.Fatalf("err = %v, want ErrBlockedAddress", err)
	}

	// And a public-looking server serving an image directly still works.
	ok := imageServer("data")
	defer ok.Close()
	if _, _, err := Fetch(context.Background(), ok.URL, t.TempDir(), "t", true, "", policyOn); err != nil {
		t.Fatalf("allowed server failed: %v", err)
	}
}

func TestRedirectLimitAndScheme(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, r.URL.Path+"x", http.StatusFound)
	}))
	defer srv.Close()
	if _, _, err := Fetch(context.Background(), srv.URL+"/a", t.TempDir(), "t", true, "", policyOff); err == nil || !strings.Contains(err.Error(), "redirects") {
		t.Fatalf("err = %v, want redirect limit", err)
	}
	ftp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "ftp://example.com/a.png", http.StatusFound)
	}))
	defer ftp.Close()
	if _, _, err := Fetch(context.Background(), ftp.URL, t.TempDir(), "t", true, "", policyOff); err == nil || !strings.Contains(err.Error(), "scheme") {
		t.Fatalf("err = %v, want scheme error", err)
	}
	if _, _, err := Fetch(context.Background(), "file:///etc/passwd", t.TempDir(), "t", true, "", policyOff); err == nil {
		t.Fatal("file scheme accepted")
	}
}

func TestProxyMode(t *testing.T) {
	var gotHost atomic.Value
	// The proxy lives on 127.0.0.1 — it must not be blocked.
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHost.Store(r.Host)
		if strings.Contains(r.URL.Path, "redir") {
			http.Redirect(w, r, "http://127.0.0.1:9/x.png", http.StatusFound)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		io.WriteString(w, "data")
	}))
	defer proxy.Close()

	if _, _, err := Fetch(context.Background(), "http://cdn.example.test/a.png", t.TempDir(), "t", true, proxy.URL, policyOn); err != nil {
		t.Fatalf("fetch via LAN proxy failed: %v", err)
	}
	if gotHost.Load() != "cdn.example.test" {
		t.Fatalf("proxy saw host %v", gotHost.Load())
	}
	for _, u := range []string{"http://10.0.0.1/a.png", "http://127.0.0.1/a.png", "http://[::1]/a.png", "http://localhost/a.png", "http://foo.localhost/a.png", "http://LOCALHOST./a.png"} {
		_, _, err := Fetch(context.Background(), u, t.TempDir(), "t", true, proxy.URL, policyOn)
		if !errors.Is(err, ErrBlockedAddress) {
			t.Errorf("%s via proxy: err = %v, want ErrBlockedAddress", u, err)
		}
	}
	if _, _, err := Fetch(context.Background(), "http://cdn.example.test/redir.png", t.TempDir(), "t", true, proxy.URL, policyOn); !errors.Is(err, ErrBlockedAddress) {
		t.Errorf("redirect to literal loopback via proxy: err = %v", err)
	}
	// Policy off: literal private targets are the admin's call.
	if _, _, err := Fetch(context.Background(), "http://10.0.0.1/a.png", t.TempDir(), "t", true, proxy.URL, policyOff); err != nil {
		t.Errorf("policy off via proxy: %v", err)
	}
}

func TestPolicyOffAllowsLoopback(t *testing.T) {
	srv := imageServer("data")
	defer srv.Close()
	dir := t.TempDir()
	p, n, err := Fetch(context.Background(), srv.URL, dir, "t", true, "", policyOff)
	if err != nil || n != 4 {
		t.Fatalf("p=%q n=%d err=%v", p, n, err)
	}
	body, _, _, cancel, err := Open(context.Background(), srv.URL, "", policyOff)
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	defer body.Close()
	if b, err := io.ReadAll(body); err != nil || string(b) != "data" {
		t.Fatalf("b=%q err=%v", b, err)
	}
}

func dirEmpty(t *testing.T, dir string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("directory not empty: %v", entries)
	}
}

func TestSizeCapMidStreamLeavesNoFile(t *testing.T) {
	// Flushing mid-body forces chunked encoding, so no Content-Length is sent.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Write([]byte(strings.Repeat("a", 600)))
		w.(http.Flusher).Flush()
		w.Write([]byte(strings.Repeat("a", 600)))
	}))
	defer srv.Close()
	dir := t.TempDir()
	_, _, err := Fetch(context.Background(), srv.URL, dir, "t", true, "", policyOff)
	if err == nil || !strings.Contains(err.Error(), "larger than the") {
		t.Fatalf("err = %v", err)
	}
	dirEmpty(t, dir)
}

func TestSizeCapContentLengthRejectedBeforeReading(t *testing.T) {
	var wrote atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Content-Length", "5000")
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		<-r.Context().Done() // never send the body
		wrote.Store(true)
	}))
	defer srv.Close()
	dir := t.TempDir()
	_, _, err := Fetch(context.Background(), srv.URL, dir, "t", true, "", policyOff)
	if err == nil || !strings.Contains(err.Error(), "larger than the") {
		t.Fatalf("err = %v", err)
	}
	dirEmpty(t, dir)
	_, _, _, cancel, err := Open(context.Background(), srv.URL, "", policyOff)
	cancel()
	if err == nil || !strings.Contains(err.Error(), "larger than the") {
		t.Fatalf("Open err = %v", err)
	}
}

func TestSizeCapExactlyAtLimitSucceeds(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Write([]byte(strings.Repeat("a", 512)))
		w.(http.Flusher).Flush() // chunked: the limit is enforced by counting
		w.Write([]byte(strings.Repeat("a", 512)))
	}))
	defer srv.Close()
	_, n, err := Fetch(context.Background(), srv.URL, t.TempDir(), "t", true, "", policyOff)
	if err != nil || n != 1024 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	body, _, _, cancel, err := Open(context.Background(), srv.URL, "", policyOff)
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	defer body.Close()
	if b, err := io.ReadAll(body); err != nil || len(b) != 1024 {
		t.Fatalf("len=%d err=%v", len(b), err)
	}
}

func TestOpenStopsAtLimit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		for i := 0; i < 100; i++ {
			if _, err := w.Write([]byte(strings.Repeat("a", 100))); err != nil {
				return
			}
			w.(http.Flusher).Flush()
		}
	}))
	defer srv.Close()
	body, _, _, cancel, err := Open(context.Background(), srv.URL, "", policyOff)
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	defer body.Close()
	b, err := io.ReadAll(body)
	if err == nil || !strings.Contains(err.Error(), "larger than the") {
		t.Fatalf("err = %v", err)
	}
	if len(b) != 1024 {
		t.Fatalf("read %d bytes, want exactly the 1024 limit", len(b))
	}
}

func TestDefaultsKeepContentTypeAllowlist(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		io.WriteString(w, "<html>")
	}))
	defer srv.Close()
	_, _, err := Fetch(context.Background(), srv.URL, t.TempDir(), "t", true, "", Policy{})
	if err == nil || !strings.Contains(err.Error(), "unsupported Content-Type") {
		t.Fatalf("err = %v", err)
	}
}

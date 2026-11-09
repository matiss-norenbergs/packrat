package imagefetch

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// countingProxy is a plain-HTTP "proxy" that answers every request and counts
// the TCP connections it accepted and the ones that were closed.
type countingProxy struct {
	*httptest.Server
	accepted, closed atomic.Int32
	requests         atomic.Int32
}

func newCountingProxy(t *testing.T) *countingProxy {
	t.Helper()
	p := &countingProxy{}
	p.Server = httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p.requests.Add(1)
		w.Header().Set("Content-Type", "image/png")
		if r.Method != http.MethodHead {
			io.WriteString(w, "data")
		}
	}))
	p.Server.Config.ConnState = func(_ net.Conn, s http.ConnState) {
		switch s {
		case http.StateNew:
			p.accepted.Add(1)
		case http.StateClosed:
			p.closed.Add(1)
		}
	}
	p.Server.Start()
	t.Cleanup(p.Server.Close)
	return p
}

func TestProxyTransportCachesPerURL(t *testing.T) {
	a, err := ProxyTransport("http://proxy-a.example.test:3128")
	if err != nil {
		t.Fatal(err)
	}
	again, _ := ProxyTransport("http://proxy-a.example.test:3128")
	if a != again {
		t.Fatal("same URL must return the same transport")
	}
	b, _ := ProxyTransport("socks5://user:secret@proxy-b.example.test:1080")
	if a == b {
		t.Fatal("a different URL must return a different transport")
	}
	// The proxy is applied.
	req, _ := http.NewRequest(http.MethodGet, "http://target.example.test/", nil)
	got, err := b.Proxy(req)
	if err != nil || got == nil || got.Host != "proxy-b.example.test:1080" {
		t.Fatalf("Proxy() = %v, %v", got, err)
	}
}

// The clone keeps http.DefaultTransport's timeouts and limits (the old
// &http.Transport{Proxy: ...} dropped them).
func TestProxyTransportKeepsDefaults(t *testing.T) {
	tr, err := ProxyTransport("http://proxy-defaults.example.test:3128")
	if err != nil {
		t.Fatal(err)
	}
	def := http.DefaultTransport.(*http.Transport)
	if tr == def {
		t.Fatal("must be a clone, not the shared default")
	}
	if tr.IdleConnTimeout != 90*time.Second || tr.IdleConnTimeout != def.IdleConnTimeout {
		t.Errorf("IdleConnTimeout = %v", tr.IdleConnTimeout)
	}
	if tr.TLSHandshakeTimeout != def.TLSHandshakeTimeout || tr.TLSHandshakeTimeout == 0 {
		t.Errorf("TLSHandshakeTimeout = %v", tr.TLSHandshakeTimeout)
	}
	if tr.ExpectContinueTimeout != def.ExpectContinueTimeout || tr.MaxIdleConns != def.MaxIdleConns || tr.MaxIdleConns == 0 {
		t.Errorf("ExpectContinueTimeout/MaxIdleConns = %v/%v", tr.ExpectContinueTimeout, tr.MaxIdleConns)
	}
	if tr.DialContext == nil || tr.ForceAttemptHTTP2 != def.ForceAttemptHTTP2 {
		t.Errorf("DialContext nil=%v ForceAttemptHTTP2=%v", tr.DialContext == nil, tr.ForceAttemptHTTP2)
	}
}

func TestProxyTransportRaceFree(t *testing.T) {
	urls := []string{"http://race-a.example.test:1", "http://race-b.example.test:2", "socks5://race-c.example.test:3"}
	var wg sync.WaitGroup
	for g := 0; g < 32; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < 200; i++ {
				tr, err := ProxyTransport(urls[(g+i)%len(urls)])
				if err != nil || tr == nil {
					t.Errorf("ProxyTransport: %v, %v", tr, err)
					return
				}
			}
		}(g)
	}
	wg.Wait()
}

func TestProxyTransportErrorLeavesCredentialsOut(t *testing.T) {
	_, err := ProxyTransport("http://user:s3cr3t@host:notaport")
	if err == nil {
		t.Fatal("malformed proxy URL accepted")
	}
	for _, leak := range []string{"s3cr3t", "user:", "host:notaport"} {
		if strings.Contains(err.Error(), leak) {
			t.Errorf("error leaks %q: %v", leak, err)
		}
	}
}

// Replacing the cached transport (the proxy setting changed) closes the old
// one's idle connections.
func TestProxyTransportClosesIdleConnectionsOfReplaced(t *testing.T) {
	p := newCountingProxy(t)
	tr, err := ProxyTransport(p.URL)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := (&http.Client{Transport: tr}).Get("http://cdn.example.test/a.png")
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	if p.accepted.Load() != 1 || p.closed.Load() != 0 {
		t.Fatalf("accepted %d closed %d before replacement", p.accepted.Load(), p.closed.Load())
	}

	if _, err := ProxyTransport("http://replacement.example.test:3128"); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for p.closed.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if p.closed.Load() != 1 {
		t.Fatalf("the replaced transport's idle connection was not closed (closed=%d)", p.closed.Load())
	}
}

// Two sequential fetches through a proxy share one TCP connection to it.
func TestFetchViaProxyReusesConnection(t *testing.T) {
	p := newCountingProxy(t)
	for i := 0; i < 3; i++ {
		if _, _, err := Fetch(context.Background(), "http://cdn.example.test/a.png", t.TempDir(), "t", true, p.URL, policyOff); err != nil {
			t.Fatalf("fetch %d: %v", i, err)
		}
	}
	if p.requests.Load() != 3 {
		t.Fatalf("proxy saw %d requests, want 3", p.requests.Load())
	}
	if n := p.accepted.Load(); n != 1 {
		t.Fatalf("proxy accepted %d connections for 3 fetches, want 1 (a new transport per request leaks one each)", n)
	}
}

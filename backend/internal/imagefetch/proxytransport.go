package imagefetch

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sync"
)

// proxyCache holds the transport for the configured proxy. There is one proxy
// setting (ytdlp_proxy), so one entry is all the app ever needs: asking for a
// different proxy URL replaces it and closes the old one's idle connections.
var proxyCache struct {
	mu  sync.Mutex
	url string
	t   *http.Transport
}

// ProxyTransport returns the shared *http.Transport that routes through
// proxyURL (the ytdlp_proxy value: http, https or socks5), creating it on first
// use. The same URL always gets the same transport, so keep-alive connections
// to the proxy are reused across image fetches, previews and the proxy-status
// probe, instead of each request leaving a new transport (and its parked
// connections and goroutines) behind.
//
// It is a clone of http.DefaultTransport with only Proxy set, so the default
// dial, TLS-handshake and idle timeouts (IdleConnTimeout 90 s, ...) are kept.
// When a different proxy URL is requested — the setting changed — the previous
// transport's idle connections are closed and it is dropped. Safe for
// concurrent use.
//
// The proxy URL may contain credentials: it is never logged, and the error for
// a malformed one deliberately leaves the URL out.
func ProxyTransport(proxyURL string) (*http.Transport, error) {
	parsed, err := url.Parse(proxyURL)
	if err != nil {
		// url.Error's text repeats the whole URL, credentials included.
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return nil, fmt.Errorf("invalid proxy URL: %v", err)
	}

	proxyCache.mu.Lock()
	defer proxyCache.mu.Unlock()
	if proxyCache.t != nil && proxyCache.url == proxyURL {
		return proxyCache.t, nil
	}

	var t *http.Transport
	if def, ok := http.DefaultTransport.(*http.Transport); ok {
		t = def.Clone()
	} else {
		t = &http.Transport{}
	}
	t.Proxy = http.ProxyURL(parsed)

	if old := proxyCache.t; old != nil {
		old.CloseIdleConnections()
	}
	proxyCache.url, proxyCache.t = proxyURL, t
	return t, nil
}

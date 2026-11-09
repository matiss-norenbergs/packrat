package api

import (
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
)

// The sidebar polls GET /api/proxy-status every 30 s; each poll must reuse the
// connection to the proxy instead of leaving a new transport (and a parked
// connection) behind.
func TestProxyStatusReusesProxyConnection(t *testing.T) {
	f := newPrivacyFixture(t)
	var accepted, requests atomic.Int32
	proxy := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1) // a plain-HTTP "proxy": answers the absolute-URI HEAD itself
	}))
	proxy.Config.ConnState = func(_ net.Conn, s http.ConnState) {
		if s == http.StateNew {
			accepted.Add(1)
		}
	}
	proxy.Start()
	defer proxy.Close()

	orig := proxyProbeURL
	proxyProbeURL = "http://probe.example.test/"
	defer func() { proxyProbeURL = orig }()
	if err := f.settings.Set(f.ctx, models.SettingYtdlpProxy, proxy.URL); err != nil {
		t.Fatal(err)
	}

	mount := func(r *gin.Engine) { r.GET("/api/proxy-status", GetProxyStatus(f.settings)) }
	for i := 0; i < 4; i++ {
		var got ProxyStatusResponse
		w := serve(t, mount, http.MethodGet, "/api/proxy-status", &got)
		if w.Code != http.StatusOK || !got.Configured || !got.Reachable {
			t.Fatalf("poll %d: %d %+v", i, w.Code, got)
		}
	}
	if requests.Load() != 4 {
		t.Fatalf("proxy saw %d probes, want 4", requests.Load())
	}
	if n := accepted.Load(); n != 1 {
		t.Fatalf("proxy accepted %d connections for 4 polls, want 1", n)
	}
}

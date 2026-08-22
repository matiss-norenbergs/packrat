package api

import (
	"context"
	"net/http"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/repository"
)

// proxyProbeTimeout bounds the sidebar status dot's reachability probe —
// short enough that a dead/unreachable proxy doesn't stall the request.
const proxyProbeTimeout = 5 * time.Second

// proxyProbeURL is a tiny, well-known endpoint hit only to confirm the
// configured proxy can actually reach the internet — not to fetch any real
// content. A bare IP avoids depending on the proxy's own DNS resolution.
const proxyProbeURL = "https://1.1.1.1/"

// ProxyStatusResponse backs the sidebar's proxy status dot. Configured is
// false whenever no ytdlp_proxy is saved, in which case Reachable is
// meaningless (left false) — there's nothing to probe.
type ProxyStatusResponse struct {
	Configured bool `json:"configured"`
	Reachable  bool `json:"reachable"`
}

// GetProxyStatus probes the saved ytdlp_proxy setting — the same proxy used
// for yt-dlp itself and for the image download/preview paths — so the
// sidebar can show at a glance whether traffic is actually routing through
// it right now.
func GetProxyStatus(settingsRepo *repository.SettingsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		proxy, err := YtdlpProxy(ctx, settingsRepo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if proxy == "" {
			c.JSON(http.StatusOK, ProxyStatusResponse{Configured: false})
			return
		}

		parsed, err := url.Parse(proxy)
		if err != nil {
			c.JSON(http.StatusOK, ProxyStatusResponse{Configured: true, Reachable: false})
			return
		}

		probeCtx, cancel := context.WithTimeout(ctx, proxyProbeTimeout)
		defer cancel()
		req, err := http.NewRequestWithContext(probeCtx, http.MethodHead, proxyProbeURL, nil)
		if err != nil {
			c.JSON(http.StatusOK, ProxyStatusResponse{Configured: true, Reachable: false})
			return
		}

		client := &http.Client{
			Timeout:   proxyProbeTimeout,
			Transport: &http.Transport{Proxy: http.ProxyURL(parsed)},
		}
		resp, err := client.Do(req)
		if err != nil {
			c.JSON(http.StatusOK, ProxyStatusResponse{Configured: true, Reachable: false})
			return
		}
		resp.Body.Close()
		c.JSON(http.StatusOK, ProxyStatusResponse{Configured: true, Reachable: true})
	}
}

// Package jellyfin triggers a Jellyfin library rescan after a download or
// import completes, so newly-added media shows up without waiting for
// Jellyfin's own periodic scan. It only ever calls Jellyfin's refresh
// endpoints — Packrat never reads library data back from Jellyfin.
package jellyfin

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"
)

const requestTimeout = 10 * time.Second

type Client struct {
	httpClient *http.Client
}

func NewClient() *Client {
	return &Client{httpClient: &http.Client{Timeout: requestTimeout}}
}

// RefreshFull triggers a scan of every library on the Jellyfin server.
func (c *Client) RefreshFull(ctx context.Context, baseURL, apiKey string) error {
	return c.post(ctx, baseURL, apiKey, "/Library/Refresh")
}

// RefreshItem triggers a recursive rescan of a single item (a library,
// identified by its Jellyfin item ID — found in Jellyfin under Dashboard >
// Libraries > the library > its URL, or via the Jellyfin API).
func (c *Client) RefreshItem(ctx context.Context, baseURL, apiKey, itemID string) error {
	path := fmt.Sprintf("/Items/%s/Refresh?Recursive=true&ImageRefreshMode=Default&MetadataRefreshMode=Default", itemID)
	return c.post(ctx, baseURL, apiKey, path)
}

func (c *Client) post(ctx context.Context, baseURL, apiKey, path string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(baseURL, "/")+path, nil)
	if err != nil {
		return fmt.Errorf("building jellyfin request: %w", err)
	}
	req.Header.Set("X-Emby-Token", apiKey)

	res, err := c.httpClient.Do(req)
	if err != nil {
		var dnsErr *net.DNSError
		if errors.As(err, &dnsErr) {
			return fmt.Errorf("could not resolve Jellyfin hostname %q from inside the container — "+
				"try the LAN IP instead, or add the host via docker-compose's extra_hosts: %w", dnsErr.Name, err)
		}
		return fmt.Errorf("calling jellyfin: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode >= 300 {
		return fmt.Errorf("jellyfin returned status %d", res.StatusCode)
	}
	return nil
}

// Package thumbnailenhance upscales library item thumbnails via a
// user-supplied local Stable Diffusion WebUI (AUTOMATIC1111-compatible)
// instance's /sdapi/v1/extra-single-image endpoint — opt-in, off by
// default. Mirrors internal/subscriptions' shape: package api will import
// this package for the manual-trigger/history-list handlers, so this
// package cannot import back — the thumbnail write-and-tier sequence is
// therefore duplicated from thumbnail_handler.go's writeThumbnailAndRespond
// rather than shared across that boundary.
package thumbnailenhance

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Client talks to one AUTOMATIC1111 WebUI instance's upscale-only API.
// Username/Password are only meaningful if that instance was launched with
// --api-auth; both empty means no auth header is sent.
type Client struct {
	BaseURL  string
	Username string
	Password string

	httpClient *http.Client
}

func NewClient(baseURL, username, password string) *Client {
	return &Client{
		BaseURL:    strings.TrimRight(baseURL, "/"),
		Username:   username,
		Password:   password,
		httpClient: &http.Client{Timeout: 5 * time.Minute},
	}
}

type extraSingleImageRequest struct {
	Image                string  `json:"image"`
	UpscalingResize      float64 `json:"upscaling_resize"`
	Upscaler1            string  `json:"upscaler_1"`
	GFPGANVisibility     float64 `json:"gfpgan_visibility"`
	CodeformerVisibility float64 `json:"codeformer_visibility"`
}

type extraSingleImageResponse struct {
	Image string `json:"image"`
}

// Upscale sends imageBytes to /sdapi/v1/extra-single-image and returns the
// upscaled result — a pure image-in/image-out call, no prompt/generation
// involved. factor is a multiplier, not necessarily an integer — A1111
// runs the upscaler model at its own native scale and then resizes the
// result to match whatever multiplier was requested, so a fractional value
// (e.g. computed to land a thumbnail at an exact target resolution) works
// the same as a whole one.
func (c *Client) Upscale(ctx context.Context, imageBytes []byte, upscaler string, factor float64) ([]byte, error) {
	reqBody := extraSingleImageRequest{
		Image:                base64.StdEncoding.EncodeToString(imageBytes),
		UpscalingResize:      factor,
		Upscaler1:            upscaler,
		GFPGANVisibility:     0,
		CodeformerVisibility: 0,
	}
	payload, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("encoding upscale request: %w", err)
	}

	url := c.BaseURL + "/sdapi/v1/extra-single-image"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("building upscale request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if c.Username != "" || c.Password != "" {
		req.SetBasicAuth(c.Username, c.Password)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("calling %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("upscale request failed: %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}

	var result extraSingleImageResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding upscale response: %w", err)
	}
	if result.Image == "" {
		return nil, fmt.Errorf("upscale response had no image data")
	}

	out, err := base64.StdEncoding.DecodeString(result.Image)
	if err != nil {
		return nil, fmt.Errorf("decoding upscaled image data: %w", err)
	}
	return out, nil
}

type upscalerInfo struct {
	Name string `json:"name"`
}

// ListUpscalers returns the names of every upscaler model the instance
// currently has available (its built-ins plus anything dropped into
// models/ESRGAN) — also doubles as a reachability probe: a caller that
// only cares "is it up" can ignore the returned names and just check the
// error.
func (c *Client) ListUpscalers(ctx context.Context) ([]string, error) {
	url := c.BaseURL + "/sdapi/v1/upscalers"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("building upscalers request: %w", err)
	}
	if c.Username != "" || c.Password != "" {
		req.SetBasicAuth(c.Username, c.Password)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("calling %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("upscalers request failed: %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}

	var infos []upscalerInfo
	if err := json.NewDecoder(resp.Body).Decode(&infos); err != nil {
		return nil, fmt.Errorf("decoding upscalers response: %w", err)
	}
	names := make([]string, 0, len(infos))
	for _, info := range infos {
		if info.Name != "" {
			names = append(names, info.Name)
		}
	}
	return names, nil
}

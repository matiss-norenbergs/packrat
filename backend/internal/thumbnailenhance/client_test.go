package thumbnailenhance

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func fakeUpscaler(t *testing.T, imageB64 string) *Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"image":"` + imageB64 + `"}`))
	}))
	t.Cleanup(srv.Close)
	return NewClient(srv.URL, "", "")
}

func TestUpscaleReadsNormalResponse(t *testing.T) {
	c := fakeUpscaler(t, base64.StdEncoding.EncodeToString([]byte("img")))
	out, err := c.Upscale(context.Background(), []byte("in"), "u", 2)
	if err != nil || string(out) != "img" {
		t.Fatalf("got %q, %v", out, err)
	}
}

func TestUpscaleRejectsOversizedResponse(t *testing.T) {
	old := maxUpscaleResponseBytes
	maxUpscaleResponseBytes = 1024
	t.Cleanup(func() { maxUpscaleResponseBytes = old })

	c := fakeUpscaler(t, strings.Repeat("A", 4096))
	_, err := c.Upscale(context.Background(), []byte("in"), "u", 2)
	if !errors.Is(err, ErrResponseTooLarge) {
		t.Fatalf("err = %v, want ErrResponseTooLarge", err)
	}
}

package api

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"packrat/backend/internal/models"
)

func TestNFOEndpointsRejectItemsWithoutFile(t *testing.T) {
	e := newCleanupEnv(t)
	base := t.TempDir()
	root := filepath.Join(base, "media")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	stray := root + ".nfo"
	if err := os.WriteFile(stray, []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	id, err := e.library.Create(context.Background(), &models.LibraryItem{Title: "g", Status: "ghost", GenerateNFO: true})
	if err != nil {
		t.Fatal(err)
	}
	path := fmt.Sprintf("/library/%d/nfo", id)

	for name, tc := range map[string]struct{ method string }{
		"get": {http.MethodGet}, "delete": {http.MethodDelete}, "generate": {http.MethodPost},
	} {
		t.Run(name, func(t *testing.T) {
			h := GetLibraryItemNFO(root, e.library)
			switch tc.method {
			case http.MethodDelete:
				h = DeleteLibraryItemNFO(root, e.library)
			case http.MethodPost:
				h = GenerateLibraryItemNFO(root, e.library, nil)
			}
			w := e.do(t, h, tc.method, path, "/library/:id/nfo", "")
			if w.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400: %s", w.Code, w.Body)
			}
		})
	}
	if b, err := os.ReadFile(stray); err != nil || string(b) != "keep" {
		t.Fatalf("file outside the media root was touched: %q %v", b, err)
	}
	if nfoSidecarExists(root, "") {
		t.Fatal("nfoSidecarExists must be false for an empty path")
	}
}

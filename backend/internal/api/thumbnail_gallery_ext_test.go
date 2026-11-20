package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"net/http"
	"os"
	"path"
	"strings"
	"testing"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

// Saving the current thumbnail to the gallery must label the copy with the
// image's real format, not always ".jpg".
func TestSaveThumbnailToGalleryUsesRealExtension(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 4, 3))
	var pngBytes, jpgBytes bytes.Buffer
	if err := png.Encode(&pngBytes, img); err != nil {
		t.Fatal(err)
	}
	if err := jpeg.Encode(&jpgBytes, img, nil); err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		name string
		data []byte
		want string
	}{
		{"png sidecar", pngBytes.Bytes(), ".png"},
		{"jpeg sidecar", jpgBytes.Bytes(), ".jpg"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newCleanupEnv(t)
			// The sidecar's own name says ".jpg" in both cases (that is what
			// the app writes); only the bytes differ.
			thumb := "vid.jpg"
			writeFile(t, e.mediaRoot+"/vid.mp4")
			if err := os.WriteFile(e.mediaRoot+"/"+thumb, tc.data, 0o644); err != nil {
				t.Fatal(err)
			}
			id, err := e.library.Create(context.Background(), &models.LibraryItem{Title: "v", Filename: "vid.mp4", Path: "vid.mp4", Status: "completed", Thumbnail: &thumb})
			if err != nil {
				t.Fatal(err)
			}
			h := SaveLibraryThumbnailToGallery(e.mediaRoot, e.imagesRoot, e.library, repository.NewThumbnailGalleryRepo(e.conn))
			w := e.do(t, h, http.MethodPost, fmt.Sprintf("/library/%d/thumbnail/gallery", id), "/library/:id/thumbnail/gallery", "")
			if w.Code != http.StatusCreated {
				t.Fatalf("status = %d: %s", w.Code, w.Body)
			}
			var resp struct {
				ImagePath string `json:"imagePath"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
				t.Fatal(err)
			}
			if got := path.Ext(resp.ImagePath); got != tc.want {
				t.Fatalf("gallery image %q has extension %q, want %q", resp.ImagePath, got, tc.want)
			}
			if !strings.HasPrefix(resp.ImagePath, "thumbnail-gallery/") || !exists(e.imagesRoot+"/"+resp.ImagePath) {
				t.Fatalf("gallery file %q missing under the images root", resp.ImagePath)
			}
		})
	}
}

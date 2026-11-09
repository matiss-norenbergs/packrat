package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// artistImage adds a gallery image row (and its file) for artistID.
func (e *bkEnv) artistImage(artistID int64, name string) (imageID int64, rel string) {
	e.t.Helper()
	rel = fmt.Sprintf("artists/%d/%s.webp", artistID, name)
	writeFile(e.t, filepath.Join(e.imagesRoot, filepath.FromSlash(rel)))
	img, err := e.artists.AddImage(context.Background(), artistID, rel)
	if err != nil {
		e.t.Fatal(err)
	}
	return img.ID, rel
}

func (e *bkEnv) deleteArtistImage(artistID, imageID int64) *httptest.ResponseRecorder {
	e.t.Helper()
	return e.send(http.MethodDelete, fmt.Sprintf("/api/artists/%d/images/%d", artistID, imageID), "", true)
}

func (e *bkEnv) selectedImage(artistID int64) string {
	e.t.Helper()
	a, err := e.artists.Get(context.Background(), artistID)
	if err != nil {
		e.t.Fatal(err)
	}
	if a.SelectedImagePath == nil {
		return ""
	}
	return *a.SelectedImagePath
}

func (e *bkEnv) imageExists(imageID int64, rel string) (row, file bool) {
	_, err := e.artists.GetImage(context.Background(), imageID)
	_, ferr := os.Stat(filepath.Join(e.imagesRoot, filepath.FromSlash(rel)))
	return err == nil, ferr == nil
}

func TestDeleteArtistImage_ForeignImageIs400AndDeletesNothing(t *testing.T) {
	e := newBkEnv(t)
	ctx := context.Background()
	a1, _ := e.artists.Create(ctx, "One", nil)
	a2, _ := e.artists.Create(ctx, "Two", nil)
	img2, rel2 := e.artistImage(a2.ID, "pic")
	if err := e.artists.SetSelectedImage(ctx, a2.ID, &rel2); err != nil {
		t.Fatal(err)
	}

	w := e.deleteArtistImage(a1.ID, img2)
	e.want(w, http.StatusBadRequest)
	if row, file := e.imageExists(img2, rel2); !row || !file {
		t.Fatalf("foreign image deleted: row=%v file=%v", row, file)
	}
	if got := e.selectedImage(a2.ID); got != rel2 {
		t.Fatalf("other artist's selection = %q, want %q", got, rel2)
	}
}

func TestDeleteArtistImage_OwnSelectedImageClearsSelection(t *testing.T) {
	e := newBkEnv(t)
	ctx := context.Background()
	a, _ := e.artists.Create(ctx, "One", nil)
	img, rel := e.artistImage(a.ID, "pic")
	if err := e.artists.SetSelectedImage(ctx, a.ID, &rel); err != nil {
		t.Fatal(err)
	}
	e.want(e.deleteArtistImage(a.ID, img), http.StatusNoContent)
	if row, file := e.imageExists(img, rel); row || file {
		t.Fatalf("image not removed: row=%v file=%v", row, file)
	}
	if got := e.selectedImage(a.ID); got != "" {
		t.Fatalf("selection = %q, want cleared", got)
	}
}

func TestDeleteArtistImage_OwnOtherImageKeepsSelection(t *testing.T) {
	e := newBkEnv(t)
	ctx := context.Background()
	a, _ := e.artists.Create(ctx, "One", nil)
	keep, keepRel := e.artistImage(a.ID, "keep")
	gone, goneRel := e.artistImage(a.ID, "gone")
	if err := e.artists.SetSelectedImage(ctx, a.ID, &keepRel); err != nil {
		t.Fatal(err)
	}
	e.want(e.deleteArtistImage(a.ID, gone), http.StatusNoContent)
	if row, file := e.imageExists(gone, goneRel); row || file {
		t.Fatalf("image not removed: row=%v file=%v", row, file)
	}
	if row, file := e.imageExists(keep, keepRel); !row || !file {
		t.Fatalf("selected image affected: row=%v file=%v", row, file)
	}
	if got := e.selectedImage(a.ID); got != keepRel {
		t.Fatalf("selection = %q, want %q", got, keepRel)
	}
}

func TestDeleteArtistImage_UnknownIDs(t *testing.T) {
	e := newBkEnv(t)
	a, _ := e.artists.Create(context.Background(), "One", nil)
	e.want(e.deleteArtistImage(a.ID, 9999), http.StatusNotFound)
	img, _ := e.artistImage(a.ID, "pic")
	e.want(e.deleteArtistImage(9999, img), http.StatusNotFound)
	if row, _ := e.imageExists(img, ""); !row {
		t.Fatal("image deleted through an unknown artist")
	}
}

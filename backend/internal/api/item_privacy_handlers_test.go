package api

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
)

// Handler-level checks that every endpoint returning library items applies
// the same blur rule, with privacy off and on.

func TestLibraryEndpointsBlur(t *testing.T) {
	f := newPrivacyFixture(t)
	s := f.scenario()
	f.compare.Add(f.ctx, []int64{s.inPrivateParent, s.privateTagged, s.plain})
	responder := f.responder()
	mount := func(r *gin.Engine) {
		r.GET("/api/library", ListLibrary(f.library, responder))
		r.GET("/api/library/:id", GetLibraryItem(f.library, responder))
		r.GET("/api/compare-list", ListCompareList(f.compare, responder))
	}

	for _, on := range []bool{false, true} {
		f.setPrivacy(on)
		want := map[int64]bool{s.inPrivateParent: on, s.privateTagged: on, s.plain: false}

		t.Run(fmt.Sprintf("privacy=%v/list", on), func(t *testing.T) {
			var list LibraryListResponse
			serve(t, mount, http.MethodGet, "/api/library", &list)
			assertBlurred(t, blurredByID(list.Items), want)
		})
		t.Run(fmt.Sprintf("privacy=%v/get", on), func(t *testing.T) {
			for id, w := range want {
				var item LibraryItemResponse
				serve(t, mount, http.MethodGet, fmt.Sprintf("/api/library/%d", id), &item)
				if item.Blurred != w {
					t.Fatalf("item %d blurred = %v, want %v", id, item.Blurred, w)
				}
			}
		})
		t.Run(fmt.Sprintf("privacy=%v/compare-list", on), func(t *testing.T) {
			var items []LibraryItemResponse
			serve(t, mount, http.MethodGet, "/api/compare-list", &items)
			assertBlurred(t, blurredByID(items), want)
		})
	}
}

func assertBlurred(t *testing.T, got, want map[int64]bool) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %d items, want %d (%v)", len(got), len(want), got)
	}
	for id, w := range want {
		if got[id] != w {
			t.Errorf("item %d blurred = %v, want %v", id, got[id], w)
		}
	}
}

// The downloads list blurs by collection only (queue rows carry no tags yet).
func TestListDownloadsBlursByCollectionOnly(t *testing.T) {
	f := newPrivacyFixture(t)
	s := f.scenario()
	conn := repository.NewDownloadsRepo(f.conn)
	for _, coll := range []*int64{s.child, nil} {
		if _, err := conn.Create(f.ctx, &models.Download{URL: "https://example.com/v", CollectionID: coll, DownloadType: "video", Quality: "best", Status: models.StatusQueued}); err != nil {
			t.Fatal(err)
		}
	}
	mgr := queue.NewDownloadManager("", "", "", nil, conn, f.library, f.collections, nil, nil, f.tags, f.settings, nil, nil, nil, queue.NewProgressStore(), nil)
	mount := func(r *gin.Engine) {
		r.GET("/api/downloads", ListDownloads(mgr, conn, f.collections, f.tags, f.settings))
	}

	for _, on := range []bool{false, true} {
		f.setPrivacy(on)
		var rows []DownloadResponse
		serve(t, mount, http.MethodGet, "/api/downloads", &rows)
		if len(rows) != 2 {
			t.Fatalf("got %d downloads", len(rows))
		}
		for _, d := range rows {
			inChild := d.CollectionID != nil
			if d.Blurred != (on && inChild) {
				t.Errorf("privacy=%v download %d (inChild=%v) blurred = %v", on, d.ID, inChild, d.Blurred)
			}
		}
	}
}

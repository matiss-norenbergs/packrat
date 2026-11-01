package api

import (
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/thumbnailenhance"
)

func TestListThumbnailEnhancementHistoryBlurred(t *testing.T) {
	f := newPrivacyFixture(t)
	s := f.scenario()
	privateCol := f.collection("vault", nil, true)
	inPrivate := f.item("in-private", privateCol)
	privArtist, err := f.artists.CreateWithPrivacy(f.ctx, "Hidden", nil, true)
	if err != nil {
		t.Fatal(err)
	}
	byArtist := f.itemByArtist("by-artist", privArtist.ID)

	history := repository.NewThumbnailEnhancementHistoryRepo(f.conn)
	deps := thumbnailenhance.Deps{
		SettingsRepo:  f.settings,
		LibraryRepo:   f.library,
		HistoryRepo:   history,
		OriginalsRepo: repository.NewThumbnailEnhancementOriginalsRepo(f.conn),
	}
	titles := map[int64]string{}
	add := func(title string, itemID *int64) {
		t.Helper()
		id, err := history.Create(f.ctx, &models.ThumbnailEnhancementHistoryEntry{
			LibraryItemID: itemID, ItemTitle: title, Status: "success", TriggerType: "manual", Mode: "upscale",
		})
		if err != nil {
			t.Fatal(err)
		}
		titles[id] = title
	}
	add("in-private", &inPrivate)
	add("in-parent", &s.inPrivateParent)
	add("tagged", &s.privateTagged)
	add("by-artist", &byArtist)
	add("plain", &s.plain)
	add("deleted", nil)

	mount := func(r *gin.Engine) {
		r.GET("/api/thumbnail-enhancement/history", ListThumbnailEnhancementHistory(deps, f.collections, f.tags, f.artists))
	}
	list := func() map[string]bool {
		t.Helper()
		var got ThumbnailEnhancementHistoryListResponse
		w := serve(t, mount, http.MethodGet, "/api/thumbnail-enhancement/history", &got)
		if w.Code != http.StatusOK {
			t.Fatalf("status %d: %s", w.Code, w.Body.String())
		}
		m := map[string]bool{}
		for _, e := range got.Entries {
			m[e.ItemTitle] = e.Blurred
		}
		return m
	}

	f.setPrivacy(false)
	for title, blurred := range list() {
		if blurred {
			t.Errorf("privacy off: %q blurred", title)
		}
	}

	f.setPrivacy(true)
	want := map[string]bool{"in-private": true, "in-parent": true, "tagged": true, "by-artist": true, "plain": false, "deleted": false}
	got := list()
	for title, w := range want {
		if got[title] != w {
			t.Errorf("privacy on: %q blurred = %v, want %v", title, got[title], w)
		}
	}
}

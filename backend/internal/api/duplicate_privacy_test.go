package api

import (
	"context"
	"encoding/json"
	"testing"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

func (f *privacyFixture) withURL(id int64, url string) models.LibraryItem {
	f.t.Helper()
	if _, err := f.conn.Exec(`UPDATE library SET original_url = ? WHERE id = ?`, url, id); err != nil {
		f.t.Fatal(err)
	}
	return f.get(id)
}

func TestDuplicateInfoBlurredFollowsTheItemPrivacyRule(t *testing.T) {
	f := newPrivacyFixture(t)
	sc := f.scenario() // in-parent (inherits private collection), tagged (private tag), plain
	priv, err := f.artists.CreateWithPrivacy(f.ctx, "Hidden", nil, true)
	if err != nil {
		t.Fatal(err)
	}
	byPrivateArtist := f.itemByArtist("by-artist", priv.ID)
	ownCollection := f.item("own-private", f.collection("vault", nil, true))

	want := map[int64]bool{
		sc.inPrivateParent: true,
		sc.privateTagged:   true,
		byPrivateArtist:    true,
		ownCollection:      true,
		sc.plain:           false,
	}

	f.setPrivacy(true)
	r := f.responder()
	for id, blurred := range want {
		info, err := r.duplicateInfo(f.ctx, ptr(f.get(id)))
		if err != nil {
			t.Fatal(err)
		}
		if info.Blurred != blurred || info.LibraryItemID != id {
			t.Errorf("privacy on, item %d: blurred=%v, want %v", id, info.Blurred, blurred)
		}
	}

	// Switch off: nothing is blurred, whatever the item carries.
	f.setPrivacy(false)
	for id := range want {
		info, err := r.duplicateInfo(f.ctx, ptr(f.get(id)))
		if err != nil {
			t.Fatal(err)
		}
		if info.Blurred {
			t.Errorf("privacy off, item %d must not be blurred", id)
		}
	}
}

func TestDuplicateInfoMatchesLibraryItemBlurredFlag(t *testing.T) {
	// The duplicate warning and the library listing must never disagree.
	f := newPrivacyFixture(t)
	sc := f.scenario()
	f.setPrivacy(true)
	r := f.responder()
	items := []models.LibraryItem{f.get(sc.inPrivateParent), f.get(sc.privateTagged), f.get(sc.plain)}
	resp, err := r.Responses(f.ctx, items)
	if err != nil {
		t.Fatal(err)
	}
	m, err := r.BlurredItems(f.ctx, items)
	if err != nil {
		t.Fatal(err)
	}
	for id, b := range blurredByID(resp) {
		if m[id] != b {
			t.Errorf("item %d: BlurredItems=%v but library response says %v", id, m[id], b)
		}
	}
}

func TestToPreviewDownloadResponseCarriesTheDuplicate(t *testing.T) {
	dup := &DuplicateInfo{LibraryItemID: 4, Title: "x", Blurred: true}
	resp := toPreviewDownloadResponse(&downloader.Metadata{Title: "t"}, dup)
	b, _ := json.Marshal(resp)
	var out struct {
		Duplicate struct {
			Blurred bool `json:"blurred"`
		} `json:"duplicate"`
	}
	if err := json.Unmarshal(b, &out); err != nil || !out.Duplicate.Blurred {
		t.Fatalf("blurred flag missing from %s (%v)", b, err)
	}
	if toPreviewDownloadResponse(&downloader.Metadata{Title: "t"}, nil).Duplicate != nil {
		t.Fatal("no duplicate, no field")
	}
}

func TestBatchSkippedEntriesAreFlaggedBlurred(t *testing.T) {
	f := newPrivacyFixture(t)
	sc := f.scenario()
	f.setPrivacy(true)

	private := f.withURL(sc.inPrivateParent, "https://example.com/private")
	tagged := f.withURL(sc.privateTagged, "https://example.com/tagged")
	plain := f.withURL(sc.plain, "https://example.com/plain")

	var entries []batchEntry
	for _, it := range []models.LibraryItem{private, tagged, plain} {
		entries = append(entries, batchEntry{req: CreateDownloadRequest{URL: *it.OriginalURL}})
	}
	// Every entry is a duplicate, so nothing reaches the download manager.
	res, err := enqueueBatch(context.Background(), nil, f.collections, f.settings, f.library, repository.NewHistoryRepo(f.conn), f.responder(), entries, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Skipped) != 3 || len(res.Queued) != 0 {
		t.Fatalf("skipped=%d queued=%d", len(res.Skipped), len(res.Queued))
	}
	got := map[int64]bool{}
	for _, s := range res.Skipped {
		got[s.LibraryItemID] = s.Blurred
	}
	if !got[sc.inPrivateParent] || !got[sc.privateTagged] || got[sc.plain] {
		t.Fatalf("blurred flags wrong: %v", got)
	}

	// Privacy off: nothing flagged.
	f.setPrivacy(false)
	res, err = enqueueBatch(context.Background(), nil, f.collections, f.settings, f.library, repository.NewHistoryRepo(f.conn), f.responder(), entries, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range res.Skipped {
		if s.Blurred {
			t.Errorf("privacy off but item %d flagged", s.LibraryItemID)
		}
	}
}

func ptr[T any](v T) *T { return &v }

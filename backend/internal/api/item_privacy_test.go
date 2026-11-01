package api

import (
	"testing"

	"packrat/backend/internal/models"
)

func TestItemPrivacyBlurred(t *testing.T) {
	root, child, plain := int64(1), int64(2), int64(3)
	cols := []models.Collection{
		{ID: root, IsPrivate: true},
		{ID: child, ParentID: &root}, // not private itself, inherits from root
		{ID: plain},
	}
	privateTags := map[string]bool{"secret": true}
	privArtist, pubArtist := int64(10), int64(11)
	privateArtists := map[int64]bool{privArtist: true}

	cases := []struct {
		name   string
		coll   *int64
		tags   []string
		artist *int64
		want   bool // with privacy on
	}{
		{"directly private collection", &root, nil, nil, true},
		{"inherited private ancestor", &child, nil, nil, true},
		{"private tag only", &plain, []string{"x", "secret"}, nil, true},
		{"private collection and private tag", &root, []string{"secret"}, nil, true},
		{"neither", &plain, []string{"x"}, nil, false},
		{"nil collection, no tags", nil, nil, nil, false},
		{"nil collection, private tag", nil, []string{"secret"}, nil, true},
		{"nil collection, public tag", nil, []string{"x"}, nil, false},
		{"private artist only", nil, nil, &privArtist, true},
		{"private artist in public collection", &plain, []string{"x"}, &privArtist, true},
		{"public artist", &plain, nil, &pubArtist, false},
		{"public artist and private tag", &plain, []string{"secret"}, &pubArtist, true},
		{"nil artist", &plain, nil, nil, false},
	}
	for _, tc := range cases {
		t.Run("on/"+tc.name, func(t *testing.T) {
			if got := newItemPrivacy(true, cols, privateTags, privateArtists).Blurred(tc.coll, tc.artist, tc.tags); got != tc.want {
				t.Fatalf("Blurred = %v, want %v", got, tc.want)
			}
		})
		t.Run("off/"+tc.name, func(t *testing.T) {
			if newItemPrivacy(false, cols, privateTags, privateArtists).Blurred(tc.coll, tc.artist, tc.tags) {
				t.Fatal("privacy off must never blur")
			}
		})
	}
}

func TestItemResponderBlurred(t *testing.T) {
	f := newPrivacyFixture(t)
	parent := f.collection("parent", nil, true)
	child := f.collection("child", parent, false)
	f.tag("secret", true)
	inChild := f.item("in-child", child)
	tagged := f.item("tagged", nil, "secret")
	plain := f.item("plain", nil)

	blurredByID := func() map[int64]bool {
		items := []models.LibraryItem{f.get(inChild), f.get(tagged), f.get(plain)}
		out, err := f.responder().Responses(f.ctx, items)
		if err != nil {
			t.Fatal(err)
		}
		m := map[int64]bool{}
		for _, r := range out {
			m[r.ID] = r.Blurred
		}
		return m
	}

	f.setPrivacy(true)
	if got := blurredByID(); !got[inChild] || !got[tagged] || got[plain] {
		t.Fatalf("privacy on: %v", got)
	}
	f.setPrivacy(false)
	if got := blurredByID(); got[inChild] || got[tagged] || got[plain] {
		t.Fatalf("privacy off: %v", got)
	}

	// Single-item wrapper reads tags from the DB.
	f.setPrivacy(true)
	one, err := f.responder().Response(f.ctx, f.get(tagged))
	if err != nil || !one.Blurred || len(one.Tags) != 1 || one.Tags[0] != "secret" {
		t.Fatalf("Response: %+v err=%v", one, err)
	}
}

func TestItemResponderBlursPrivateArtist(t *testing.T) {
	f := newPrivacyFixture(t)
	priv, err := f.artists.CreateWithPrivacy(f.ctx, "Hidden", nil, true)
	if err != nil {
		t.Fatal(err)
	}
	pub, err := f.artists.Create(f.ctx, "Open", nil)
	if err != nil {
		t.Fatal(err)
	}
	byPriv := f.itemByArtist("by-private", priv.ID)
	byPub := f.itemByArtist("by-public", pub.ID)
	plain := f.item("plain", nil)

	check := func(wantPriv bool) {
		t.Helper()
		items := []models.LibraryItem{f.get(byPriv), f.get(byPub), f.get(plain)}
		out, err := f.responder().Responses(f.ctx, items)
		if err != nil {
			t.Fatal(err)
		}
		assertBlurred(t, blurredByID(out), map[int64]bool{byPriv: wantPriv, byPub: false, plain: false})
	}
	f.setPrivacy(true)
	check(true)
	f.setPrivacy(false)
	check(false)
}

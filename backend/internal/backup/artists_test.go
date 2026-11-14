package backup

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func strPtr(s string) *string { return &s }

func findArtist(t *testing.T, repos testRepos, name string) (private bool, birthday *string) {
	t.Helper()
	rows, err := repos.artists.List(context.Background())
	if err != nil {
		t.Fatalf("listing artists: %v", err)
	}
	for _, a := range rows {
		if a.Name == name {
			return a.IsPrivate, a.Birthday
		}
	}
	t.Fatalf("artist %q not found", name)
	return false, nil
}

func applyArtists(t *testing.T, repos testRepos, entries []ArtistEntry) ApplyResult {
	t.Helper()
	_, result, err := ApplyLibraryBundle(context.Background(), repos.db, repos.collections, repos.tags, repos.artists, repos.library, LibraryBundle{Artists: entries}, false)
	if err != nil {
		t.Fatalf("ApplyLibraryBundle: %v", err)
	}
	return result
}

func TestArtistBackup_RoundTrip(t *testing.T) {
	ctx := context.Background()
	src := openTestRepos(t)
	if _, err := src.artists.CreateWithPrivacy(ctx, "Some Private Artist", strPtr("1987-03-14"), true); err != nil {
		t.Fatal(err)
	}
	if _, err := src.artists.Create(ctx, "Rick Astley", nil); err != nil {
		t.Fatal(err)
	}

	bundle, err := BuildLibraryBundle(ctx, src.collections, src.tags, src.artists, src.library, src.downloads)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(bundle)
	if err != nil {
		t.Fatal(err)
	}
	var decoded LibraryBundle
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}

	dst := openTestRepos(t)
	result := applyArtists(t, dst, decoded.Artists)
	if result.ArtistsCreated != 2 {
		t.Fatalf("ArtistsCreated = %d, want 2", result.ArtistsCreated)
	}
	private, bd := findArtist(t, dst, "Some Private Artist")
	if !private || bd == nil || *bd != "1987-03-14" {
		t.Fatalf("private artist restored as private=%v birthday=%v", private, bd)
	}
	private, bd = findArtist(t, dst, "Rick Astley")
	if private || bd != nil {
		t.Fatalf("public artist restored as private=%v birthday=%v", private, bd)
	}
}

func TestArtistBackup_ExportOmitsDefaults(t *testing.T) {
	raw, err := json.Marshal(LibraryBundle{Artists: []ArtistEntry{
		{Name: "Rick Astley"},
		{Name: "Some Private Artist", IsPrivate: true, Birthday: "1987-03-14"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	s := string(raw)
	if !strings.Contains(s, `{"name":"Rick Astley"}`) {
		t.Fatalf("public artist should export as just a name: %s", s)
	}
	if !strings.Contains(s, `{"name":"Some Private Artist","isPrivate":true,"birthday":"1987-03-14"}`) {
		t.Fatalf("private artist export wrong: %s", s)
	}
}

func TestArtistBackup_OldStringFormat(t *testing.T) {
	repos := openTestRepos(t)

	var bundle LibraryBundle
	if err := json.Unmarshal([]byte(`{"artists":["Rick Astley"]}`), &bundle); err != nil {
		t.Fatalf("old format must parse: %v", err)
	}
	result := applyArtists(t, repos, bundle.Artists)
	if result.ArtistsCreated != 1 {
		t.Fatalf("ArtistsCreated = %d, want 1", result.ArtistsCreated)
	}
	if private, bd := findArtist(t, repos, "Rick Astley"); private || bd != nil {
		t.Fatalf("old-format artist should be public with no birthday, got %v %v", private, bd)
	}
}

func TestArtistBackup_OldStringFormatInFullEnvelope(t *testing.T) {
	repos := openTestRepos(t)

	plain := []byte(`{"settings":{},"library":{"collections":[],"tags":[],"artists":["Rick Astley"],"libraryItems":[]}}`)
	env, err := Seal("full", plain, "")
	if err != nil {
		t.Fatal(err)
	}
	opened, err := Open(env, "full", "")
	if err != nil {
		t.Fatal(err)
	}
	var full FullBundle
	if err := json.Unmarshal(opened, &full); err != nil {
		t.Fatalf("old full backup must parse: %v", err)
	}
	applyArtists(t, repos, full.Library.Artists)
	findArtist(t, repos, "Rick Astley")
}

func TestArtistBackup_MixedList(t *testing.T) {
	var bundle LibraryBundle
	in := `{"artists":["Old Style", {"name":"New Style","isPrivate":true,"birthday":"2000-01-02"}, {"name":"Bare Object"}]}`
	if err := json.Unmarshal([]byte(in), &bundle); err != nil {
		t.Fatalf("mixed list must parse: %v", err)
	}
	want := []ArtistEntry{
		{Name: "Old Style"},
		{Name: "New Style", IsPrivate: true, Birthday: "2000-01-02"},
		{Name: "Bare Object"},
	}
	if len(bundle.Artists) != len(want) {
		t.Fatalf("got %d artists, want %d", len(bundle.Artists), len(want))
	}
	for i := range want {
		if bundle.Artists[i] != want[i] {
			t.Fatalf("artist %d = %+v, want %+v", i, bundle.Artists[i], want[i])
		}
	}
}

func TestArtistBackup_ExistingArtistOnlyUpgrades(t *testing.T) {
	ctx := context.Background()
	repos := openTestRepos(t)
	if _, err := repos.artists.Create(ctx, "Becomes Private", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := repos.artists.CreateWithPrivacy(ctx, "Stays Private", strPtr("1990-05-05"), true); err != nil {
		t.Fatal(err)
	}
	if _, err := repos.artists.Create(ctx, "Keeps Birthday", strPtr("1970-01-01")); err != nil {
		t.Fatal(err)
	}

	result := applyArtists(t, repos, []ArtistEntry{
		{Name: "Becomes Private", IsPrivate: true, Birthday: "1985-06-07"},
		{Name: "Stays Private", IsPrivate: false}, // false/absent must never un-private
		{Name: "Keeps Birthday", Birthday: "2001-02-03"},
	})
	if result.ArtistsCreated != 0 {
		t.Fatalf("ArtistsCreated = %d, want 0", result.ArtistsCreated)
	}

	private, bd := findArtist(t, repos, "Becomes Private")
	if !private {
		t.Fatal("existing public artist should have been made private")
	}
	if bd == nil || *bd != "1985-06-07" {
		t.Fatalf("blank birthday should have been filled, got %v", bd)
	}
	private, bd = findArtist(t, repos, "Stays Private")
	if !private || bd == nil || *bd != "1990-05-05" {
		t.Fatalf("private artist changed: private=%v birthday=%v", private, bd)
	}
	private, bd = findArtist(t, repos, "Keeps Birthday")
	if private || bd == nil || *bd != "1970-01-01" {
		t.Fatalf("existing birthday overwritten: private=%v birthday=%v", private, bd)
	}
}

func TestArtistBackup_InvalidBirthdaySkipped(t *testing.T) {
	ctx := context.Background()
	repos := openTestRepos(t)
	if _, err := repos.artists.Create(ctx, "Existing", nil); err != nil {
		t.Fatal(err)
	}

	for _, bad := range []string{"14-03-1987", "1987-3-14", "1987-02-30", "not a date"} {
		applyArtists(t, repos, []ArtistEntry{
			{Name: "Fresh " + bad, IsPrivate: true, Birthday: bad},
			{Name: "Existing", Birthday: bad},
		})
		private, bd := findArtist(t, repos, "Fresh "+bad)
		if !private || bd != nil {
			t.Fatalf("%q: created artist should keep its flag but skip the birthday, got %v %v", bad, private, bd)
		}
		if _, bd := findArtist(t, repos, "Existing"); bd != nil {
			t.Fatalf("%q: invalid birthday must not be stored, got %v", bad, *bd)
		}
	}
}

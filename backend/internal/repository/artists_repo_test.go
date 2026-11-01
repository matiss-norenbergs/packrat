package repository

import (
	"context"
	"testing"
)

func TestArtistsRepo_IsPrivate(t *testing.T) {
	ctx := context.Background()
	repo := NewArtistsRepo(openTestDB(t).db)

	pub, err := repo.Create(ctx, "Public", nil)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if pub.IsPrivate {
		t.Fatalf("Create should default to public")
	}
	priv, err := repo.CreateWithPrivacy(ctx, "Private", nil, true)
	if err != nil {
		t.Fatalf("CreateWithPrivacy: %v", err)
	}
	if !priv.IsPrivate {
		t.Fatalf("CreateWithPrivacy(true) did not persist the flag")
	}

	list, err := repo.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	got := map[string]bool{}
	for _, a := range list {
		got[a.Name] = a.IsPrivate
	}
	if got["Public"] || !got["Private"] {
		t.Fatalf("List flags wrong: %v", got)
	}

	yes, no := true, false
	if err := repo.Update(ctx, pub.ID, "Public", nil, &yes); err != nil {
		t.Fatalf("Update set: %v", err)
	}
	if a, _ := repo.Get(ctx, pub.ID); !a.IsPrivate {
		t.Fatalf("Update(&true) did not set the flag")
	}
	// nil leaves the flag untouched (renaming still works).
	if err := repo.Update(ctx, pub.ID, "Renamed", nil, nil); err != nil {
		t.Fatalf("Update nil: %v", err)
	}
	if a, _ := repo.Get(ctx, pub.ID); !a.IsPrivate || a.Name != "Renamed" {
		t.Fatalf("Update(nil) changed the flag or skipped the rename: %+v", a)
	}
	if err := repo.Update(ctx, pub.ID, "Renamed", nil, &no); err != nil {
		t.Fatalf("Update clear: %v", err)
	}
	if a, _ := repo.Get(ctx, pub.ID); a.IsPrivate {
		t.Fatalf("Update(&false) did not clear the flag")
	}
}

func TestArtistsRepo_PrivateArtistIDs(t *testing.T) {
	ctx := context.Background()
	repo := NewArtistsRepo(openTestDB(t).db)

	none, err := repo.PrivateArtistIDs(ctx)
	if err != nil || len(none) != 0 {
		t.Fatalf("empty db: %v err=%v", none, err)
	}
	pub, _ := repo.Create(ctx, "Public", nil)
	priv, err := repo.CreateWithPrivacy(ctx, "Private", nil, true)
	if err != nil {
		t.Fatal(err)
	}
	got, err := repo.PrivateArtistIDs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || !got[priv.ID] || got[pub.ID] {
		t.Fatalf("PrivateArtistIDs = %v", got)
	}
}

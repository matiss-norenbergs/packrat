package backup

import (
	"context"
	"reflect"
	"sort"
	"strings"
	"testing"

	"packrat/backend/internal/models"
)

// A bundle is untrusted input: collection path segments such as "..", "a/b"
// or "" must be cleaned the way a normal collection create cleans them, the
// same way in the collection entries and in the items that reference them,
// without ever failing the restore.
func TestApplyLibraryBundle_CleansCollectionPaths(t *testing.T) {
	ctx := context.Background()
	repos := openTestRepos(t)

	// A valid-but-unusual local collection (as a folder scan creates them) must
	// keep matching exactly, not be "cleaned" into a duplicate.
	existingID, err := repos.collections.Create(ctx, &models.Collection{
		Name: "Alt", RootPath: "Alt:Name", DefaultQuality: "best", DefaultDownloadType: "video", FilenameTemplate: "{title}",
	})
	if err != nil {
		t.Fatal(err)
	}

	col := func(name string, path ...string) CollectionEntry {
		return CollectionEntry{Path: path, Name: name, DefaultQuality: "best", DefaultDownloadType: "video"}
	}
	item := func(title string, path ...string) LibraryItemEntry {
		return LibraryItemEntry{Title: title, CollectionPath: path, MediaType: "video"}
	}
	bundle := LibraryBundle{
		Collections: []CollectionEntry{
			col("Music", "Music"),
			col("Evil", "..", "Evil"),         // ".." is dropped -> Evil
			col("AB", "a/b"),                  // separator stripped -> ab
			col("Rock", "", "Rock"),           // empty segment dropped -> Rock
			col("Alt", "Alt:Name"),            // already valid: matches the existing one
			col("Nothing", ".."),              // cleans to nothing -> skipped
			col("Deep", "Music", "x\\y", "z"), // backslash stripped -> Music/xy/z
		},
		LibraryItems: []LibraryItemEntry{
			item("in music", "Music"),
			item("in evil", "..", "Evil"),
			item("in ab", "a/b"),
			item("in rock", "", "Rock"),
			item("in alt", "Alt:Name"),
			item("nowhere", ".."),
			item("none"),
			item("deep", "Music", "x\\y", "z"),
		},
	}

	_, result, err := ApplyLibraryBundle(ctx, repos.db, repos.collections, repos.tags, repos.artists, repos.library, bundle, true)
	if err != nil {
		t.Fatalf("restore failed: %v", err)
	}
	if result.GhostsCreated != len(bundle.LibraryItems) {
		t.Fatalf("GhostsCreated = %d, want %d", result.GhostsCreated, len(bundle.LibraryItems))
	}

	cols, err := repos.collections.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[int64]models.Collection{}
	var paths []string
	for _, c := range cols {
		byID[c.ID] = c
		if strings.ContainsAny(c.RootPath, "/\\") || c.RootPath == "" || c.RootPath == ".." || c.RootPath == "." {
			t.Errorf("unsafe collection root path %q was created", c.RootPath)
		}
	}
	fullPath := func(c models.Collection) string {
		p := c.RootPath
		for c.ParentID != nil {
			c = byID[*c.ParentID]
			p = c.RootPath + "/" + p
		}
		return p
	}
	for _, c := range cols {
		paths = append(paths, fullPath(c))
	}
	sort.Strings(paths)
	wantPaths := []string{"Alt:Name", "Evil", "Music", "Music/xy", "Music/xy/z", "Rock", "ab"}
	if !reflect.DeepEqual(paths, wantPaths) {
		t.Fatalf("collections = %v, want %v", paths, wantPaths)
	}
	// The pre-existing collection was matched, not duplicated.
	if c, ok := byID[existingID]; !ok || c.RootPath != "Alt:Name" {
		t.Fatalf("existing collection %d changed or was replaced", existingID)
	}

	items, err := repos.library.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{} // title -> collection path ("" = uncategorized)
	for _, it := range items {
		if it.CollectionID == nil {
			got[it.Title] = ""
		} else {
			got[it.Title] = fullPath(byID[*it.CollectionID])
		}
	}
	want := map[string]string{
		"in music": "Music", "in evil": "Evil", "in ab": "ab", "in rock": "Rock",
		"in alt": "Alt:Name", "nowhere": "", "none": "", "deep": "Music/xy/z",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("item collections = %v, want %v", got, want)
	}
}

func TestCleanBundlePaths(t *testing.T) {
	in := LibraryBundle{
		Collections:  []CollectionEntry{{Path: []string{"..", "a/b", "ok"}}},
		LibraryItems: []LibraryItemEntry{{CollectionPath: []string{"..", "a/b", "ok"}, Folder: "../x/./y//z"}, {Folder: "fine/sub"}},
	}
	out := cleanBundlePaths(in)
	if want := []string{"ab", "ok"}; !reflect.DeepEqual(out.Collections[0].Path, want) || !reflect.DeepEqual(out.LibraryItems[0].CollectionPath, want) {
		t.Errorf("cleaned paths = %v / %v, want %v", out.Collections[0].Path, out.LibraryItems[0].CollectionPath, want)
	}
	if out.LibraryItems[0].Folder != "x/y/z" || out.LibraryItems[1].Folder != "fine/sub" {
		t.Errorf("folders = %q, %q", out.LibraryItems[0].Folder, out.LibraryItems[1].Folder)
	}
	if in.Collections[0].Path[0] != ".." || in.LibraryItems[0].Folder != "../x/./y//z" {
		t.Error("the caller's bundle was modified")
	}
}

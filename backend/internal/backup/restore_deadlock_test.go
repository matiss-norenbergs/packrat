package backup

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"packrat/backend/internal/db"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

// The restore used to hold the only DB connection (open tx, SetMaxOpenConns(1))
// while waiting on a repo mutex held by a goroutine that was itself waiting
// for that connection — an app-wide hang. With the connection pool the same
// lock-order mistake would instead make the mutex holder fail with "database
// is locked" after db.BusyTimeout, so the deadline below is kept well under that
// timeout: a regression must not be able to hide behind the busy timeout
// breaking the cycle. These tests run the restore against
// goroutines hammering the same mutex-taking repo methods, under a timeout so
// a regression fails fast instead of hanging the suite.

const restoreDeadline = db.BusyTimeout * 2 / 3

// runRestoreAgainstHammers starts `workers` goroutines running hammer in a
// loop, then runs ApplyLibraryBundle and fails if it doesn't finish in time.
func runRestoreAgainstHammers(t *testing.T, repos testRepos, bundle LibraryBundle, workers int, hammer func(ctx context.Context, worker int)) {
	t.Helper()

	hctx, stop := context.WithCancel(context.Background())
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for hctx.Err() == nil {
				hammer(hctx, w)
			}
		}(w)
	}
	time.Sleep(20 * time.Millisecond) // let the hammers get mid-flight

	done := make(chan error, 1)
	go func() {
		_, _, err := ApplyLibraryBundle(context.Background(), repos.db, repos.collections, repos.tags, repos.artists, repos.library, bundle, false)
		done <- err
	}()

	select {
	case err := <-done:
		stop()
		wg.Wait()
		if err != nil {
			t.Fatalf("ApplyLibraryBundle: %v", err)
		}
	case <-time.After(restoreDeadline):
		t.Fatalf("ApplyLibraryBundle did not finish within %s: deadlock between the repo mutex and the DB connection", restoreDeadline)
	}
}

func TestApplyLibraryBundle_NoDeadlockWithConcurrentTagWriters(t *testing.T) {
	repos := openTestRepos(t)

	names := make([]string, 60)
	bundle := LibraryBundle{}
	for i := range names {
		names[i] = fmt.Sprintf("tag-%02d", i)
		bundle.Tags = append(bundle.Tags, TagEntry{Name: names[i]})
	}

	runRestoreAgainstHammers(t, repos, bundle, 4, func(ctx context.Context, _ int) {
		_, _ = repos.tags.GetOrCreateByNames(ctx, names)
	})

	list, err := repos.tags.List(context.Background())
	if err != nil {
		t.Fatalf("listing tags: %v", err)
	}
	if len(list) != len(names) {
		t.Fatalf("got %d tags, want exactly %d (no duplicates, none missing)", len(list), len(names))
	}
}

func TestApplyLibraryBundle_NoDeadlockWithConcurrentArtistWriters(t *testing.T) {
	repos := openTestRepos(t)

	names := make([]string, 60)
	bundle := LibraryBundle{}
	for i := range names {
		names[i] = fmt.Sprintf("artist-%02d", i)
	}
	bundle.Artists = names

	runRestoreAgainstHammers(t, repos, bundle, 4, func(ctx context.Context, _ int) {
		for _, n := range names {
			if _, err := repos.artists.Create(ctx, n, nil); err != nil && !errors.Is(err, repository.ErrArtistNameInUse) && ctx.Err() == nil {
				t.Errorf("creating artist %q: %v", n, err)
				return
			}
		}
	})

	list, err := repos.artists.List(context.Background())
	if err != nil {
		t.Fatalf("listing artists: %v", err)
	}
	if len(list) != len(names) {
		t.Fatalf("got %d artists, want exactly %d", len(list), len(names))
	}
}

func TestApplyLibraryBundle_NoDeadlockWithConcurrentCollectionWriters(t *testing.T) {
	repos := openTestRepos(t)

	var chains [][]string
	bundle := LibraryBundle{}
	for i := 0; i < 30; i++ {
		chain := []string{"root", fmt.Sprintf("branch-%02d", i), "leaf"}
		chains = append(chains, chain)
		bundle.Collections = append(bundle.Collections, CollectionEntry{
			Path: chain, Name: "leaf", DefaultQuality: "best", DefaultDownloadType: "video",
		})
	}

	runRestoreAgainstHammers(t, repos, bundle, 4, func(ctx context.Context, _ int) {
		for _, c := range chains {
			if _, err := repos.collections.EnsureChain(ctx, c); err != nil && ctx.Err() == nil {
				t.Errorf("EnsureChain %v: %v", c, err)
				return
			}
		}
	})

	cols, err := repos.collections.List(context.Background())
	if err != nil {
		t.Fatalf("listing collections: %v", err)
	}
	type key struct {
		parent int64
		name   string
	}
	seen := map[key]bool{}
	for _, c := range cols {
		var p int64
		if c.ParentID != nil {
			p = *c.ParentID
		}
		k := key{p, c.Name}
		if seen[k] {
			t.Fatalf("duplicate collection %q under parent %d", c.Name, p)
		}
		seen[k] = true
	}
	// root + 30 branches + 30 leaves
	if want := 1 + 30 + 30; len(cols) != want {
		t.Fatalf("got %d collections, want %d", len(cols), want)
	}
}

// All three mutex-taking repos at once, plus ghost items (which resolve tags
// from inside the tx a second time).
func TestApplyLibraryBundle_NoDeadlockMixedWriters(t *testing.T) {
	repos := openTestRepos(t)

	bundle := LibraryBundle{
		Tags:        []TagEntry{{Name: "mix-a"}, {Name: "mix-b"}},
		Artists:     []string{"Mixed Artist"},
		Collections: []CollectionEntry{{Path: []string{"Mixed", "Sub"}, Name: "Sub", DefaultQuality: "best", DefaultDownloadType: "video"}},
	}
	for i := 0; i < 20; i++ {
		bundle.LibraryItems = append(bundle.LibraryItems, LibraryItemEntry{
			Title: fmt.Sprintf("ghost %d", i), CollectionPath: []string{"Mixed", "Sub"},
			ArtistName: "Mixed Artist", Tags: []string{"mix-a", "mix-c"},
		})
	}

	runRestoreAgainstHammers(t, repos, bundle, 3, func(ctx context.Context, w int) {
		switch w % 3 {
		case 0:
			_, _ = repos.tags.GetOrCreateByNames(ctx, []string{"mix-a", "mix-b", "mix-c"})
		case 1:
			_, _ = repos.artists.Create(ctx, "Mixed Artist", nil)
		default:
			_, _ = repos.collections.EnsureChain(ctx, []string{"Mixed", "Sub"})
		}
	})

	tags, _ := repos.tags.List(context.Background())
	if len(tags) != 3 {
		t.Fatalf("got %d tags, want 3", len(tags))
	}
	arts, _ := repos.artists.List(context.Background())
	if len(arts) != 1 {
		t.Fatalf("got %d artists, want 1", len(arts))
	}
	cols, _ := repos.collections.List(context.Background())
	if len(cols) != 2 {
		t.Fatalf("got %d collections, want 2", len(cols))
	}
	_ = models.Collection{}
}

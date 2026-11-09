package repository

import (
	"context"
	"math"
	"math/rand"
	"reflect"
	"slices"
	"sort"
	"testing"
	"time"

	"packrat/backend/internal/models"
)

// oldSequenceGaps is the previous implementation (walk every integer in
// [min, max]), kept as the reference. Only safe for small ranges.
func oldSequenceGaps(sorted []int, min, max int) (int, []int) {
	present := make(map[int]bool, len(sorted))
	for _, s := range sorted {
		present[s] = true
	}
	count := 0
	var missing []int
	for n := min; n <= max; n++ {
		if present[n] {
			continue
		}
		count++
		if len(missing) < sequenceGapSampleCap {
			missing = append(missing, n)
		}
	}
	return count, missing
}

func TestSequenceGaps_MatchesOldLoop(t *testing.T) {
	rng := rand.New(rand.NewSource(1))
	for i := 0; i < 20000; i++ {
		span := 1 + rng.Intn(150)
		lo := rng.Intn(60) - 20
		hi := lo + 1 + rng.Intn(span)
		n := rng.Intn(80)
		vals := make([]int, n)
		for j := range vals {
			// Values inside, around and outside [lo, hi], with plenty of duplicates.
			vals[j] = lo - 10 + rng.Intn(hi-lo+21)
		}
		sort.Ints(vals)
		wantC, wantM := oldSequenceGaps(vals, lo, hi)
		gotC, gotM := sequenceGaps(vals, lo, hi)
		if gotC != wantC || !slices.Equal(gotM, wantM) {
			t.Fatalf("sequenceGaps(%v, %d, %d) = %d %v, old loop gave %d %v", vals, lo, hi, gotC, gotM, wantC, wantM)
		}
	}
}

func TestSequenceGaps_ExtremeRangesFinishInstantly(t *testing.T) {
	cases := []struct {
		name       string
		vals       []int
		min, max   int
		wantCount  int
		wantFirst  []int
		wantMissCt int
	}{
		{"billion", []int{1, 2, 3, 1_000_000_000}, 1, 1_000_000_000, 1_000_000_000 - 4, []int{4, 5, 6}, sequenceGapSampleCap},
		{"to MaxInt from 0", []int{0, 5}, 0, math.MaxInt, math.MaxInt - 1, []int{1, 2, 3, 4, 6}, sequenceGapSampleCap},
		{"MinInt..MaxInt empty", nil, math.MinInt, math.MaxInt, math.MaxInt, []int{math.MinInt, math.MinInt + 1}, sequenceGapSampleCap},
		{"MinInt..MaxInt with ends present", []int{math.MinInt, math.MaxInt}, math.MinInt, math.MaxInt, math.MaxInt, []int{math.MinInt + 1, math.MinInt + 2}, sequenceGapSampleCap},
		{"max is MaxInt and present", []int{math.MaxInt - 1, math.MaxInt}, math.MaxInt - 3, math.MaxInt, 2, []int{math.MaxInt - 3, math.MaxInt - 2}, 2},
		{"duplicates and outside values", []int{-5, 1, 1, 1, 3, 3, 900, 5_000_000_000}, 1, 10, 8, []int{2, 4, 5, 6, 7, 8, 9, 10}, 8},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			done := make(chan struct{})
			var count int
			var missing []int
			go func() {
				defer close(done)
				count, missing = sequenceGaps(tc.vals, tc.min, tc.max)
			}()
			select {
			case <-done:
			case <-time.After(2 * time.Second):
				t.Fatal("did not finish: still walking the range")
			}
			if count != tc.wantCount {
				t.Errorf("count = %d, want %d", count, tc.wantCount)
			}
			if len(missing) != tc.wantMissCt || len(missing) > sequenceGapSampleCap {
				t.Errorf("sample has %d entries, want %d (cap %d)", len(missing), tc.wantMissCt, sequenceGapSampleCap)
			}
			if !slices.IsSorted(missing) {
				t.Errorf("sample not ascending: %v", missing)
			}
			if len(missing) >= len(tc.wantFirst) && !reflect.DeepEqual(missing[:len(tc.wantFirst)], tc.wantFirst) {
				t.Errorf("sample starts %v, want %v", missing[:len(tc.wantFirst)], tc.wantFirst)
			}
			for _, m := range missing {
				if m < tc.min || m > tc.max || slices.Contains(tc.vals, m) {
					t.Errorf("%d is not a missing number in range", m)
				}
			}
		})
	}
}

// End to end through SequenceGapsByCollection: a collection whose configured
// bounds are absurd (or stored far beyond the API limit) answers at once.
func TestSequenceGapsByCollection_AbsurdStoredBounds(t *testing.T) {
	ctx := context.Background()
	downloadsRepo := openTestDB(t)
	repo := NewLibraryRepo(downloadsRepo.db)
	collections := NewCollectionsRepo(downloadsRepo.db)
	id, err := collections.Create(ctx, &models.Collection{Name: "Wild", RootPath: "wild", DefaultQuality: "best", DefaultDownloadType: "video"})
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range []int{1, 2, 4} {
		n := n
		if _, err := repo.Create(ctx, &models.LibraryItem{Title: "i", Filename: "i.mp4", Path: "i.mp4", CollectionID: &id, SequenceNumber: &n, Status: "completed"}); err != nil {
			t.Fatal(err)
		}
	}
	for _, rng := range []SequenceRange{
		{Max: ptr(1_000_000_000)},
		{Min: ptr(0), Max: ptr(math.MaxInt)},
		{Min: ptr(math.MinInt), Max: ptr(math.MaxInt)},
	} {
		done := make(chan map[int64]SequenceGap, 1)
		go func() {
			g, err := repo.SequenceGapsByCollection(ctx, map[int64]SequenceRange{id: rng})
			if err != nil {
				t.Error(err)
			}
			done <- g
		}()
		select {
		case g := <-done:
			if got, ok := g[id]; !ok || got.Count <= 0 || len(got.Missing) != sequenceGapSampleCap {
				t.Errorf("range %+v: %+v", rng, got)
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("range %v %v did not finish", rng.Min, rng.Max)
		}
	}
}

func ptr(n int) *int { return &n }

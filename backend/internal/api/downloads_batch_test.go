package api

import (
	"testing"

	"packrat/backend/internal/downloader"
)

func makeEntries(n int) []downloader.PlaylistEntry {
	entries := make([]downloader.PlaylistEntry, n)
	for i := range entries {
		entries[i] = downloader.PlaylistEntry{ID: string(rune('a' + i))}
	}
	return entries
}

func intPtr(v int) *int { return &v }

func TestFilterPlaylistEntries(t *testing.T) {
	entries := makeEntries(5) // ids: a b c d e

	t.Run("entire returns all entries unchanged", func(t *testing.T) {
		got, err := filterPlaylistEntries(entries, "entire", nil, nil, nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(got) != 5 {
			t.Fatalf("expected 5 entries, got %d", len(got))
		}
	})

	t.Run("range slices inclusive 1-based bounds", func(t *testing.T) {
		got, err := filterPlaylistEntries(entries, "range", intPtr(2), intPtr(4), nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(got) != 3 || got[0].ID != "b" || got[2].ID != "d" {
			t.Fatalf("expected entries b,c,d, got %+v", got)
		}
	})

	t.Run("range beyond entry count is an error", func(t *testing.T) {
		if _, err := filterPlaylistEntries(entries, "range", intPtr(3), intPtr(10), nil); err == nil {
			t.Fatal("expected an error for an out-of-bounds range")
		}
	})

	t.Run("range missing start/end is an error", func(t *testing.T) {
		if _, err := filterPlaylistEntries(entries, "range", nil, intPtr(3), nil); err == nil {
			t.Fatal("expected an error when start is nil")
		}
		if _, err := filterPlaylistEntries(entries, "range", intPtr(1), nil, nil); err == nil {
			t.Fatal("expected an error when end is nil")
		}
	})

	t.Run("range with end before start is an error", func(t *testing.T) {
		if _, err := filterPlaylistEntries(entries, "range", intPtr(4), intPtr(2), nil); err == nil {
			t.Fatal("expected an error when end < start")
		}
	})

	t.Run("first_n takes the leading N entries", func(t *testing.T) {
		got, err := filterPlaylistEntries(entries, "first_n", nil, nil, intPtr(2))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(got) != 2 || got[0].ID != "a" || got[1].ID != "b" {
			t.Fatalf("expected entries a,b, got %+v", got)
		}
	})

	t.Run("first_n larger than entry count is clamped, not an error", func(t *testing.T) {
		got, err := filterPlaylistEntries(entries, "first_n", nil, nil, intPtr(100))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(got) != 5 {
			t.Fatalf("expected all 5 entries, got %d", len(got))
		}
	})

	t.Run("first_n missing limit is an error", func(t *testing.T) {
		if _, err := filterPlaylistEntries(entries, "first_n", nil, nil, nil); err == nil {
			t.Fatal("expected an error when limit is nil")
		}
	})

	t.Run("first_n with zero or negative limit is an error", func(t *testing.T) {
		if _, err := filterPlaylistEntries(entries, "first_n", nil, nil, intPtr(0)); err == nil {
			t.Fatal("expected an error for a zero limit")
		}
	})

	t.Run("unknown mode is an error", func(t *testing.T) {
		if _, err := filterPlaylistEntries(entries, "bogus", nil, nil, nil); err == nil {
			t.Fatal("expected an error for an unrecognized mode")
		}
	})
}

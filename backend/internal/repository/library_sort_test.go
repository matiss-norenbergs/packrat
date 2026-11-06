package repository

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"testing"
)

// The default sort must be able to walk idx_library_downloaded_at instead of
// scanning the table and sorting it in a temp b-tree.
func TestLibraryDefaultSortUsesIndex(t *testing.T) {
	conn := openMigratedConn(t)
	query := librarySelectPrefix + libraryFromClause + libraryOrderBy("", "") + " LIMIT ? OFFSET ?"
	rows, err := conn.Query("EXPLAIN QUERY PLAN "+query, 50, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var plan []string
	for rows.Next() {
		var id, parent, notused int
		var detail string
		if err := rows.Scan(&id, &parent, &notused, &detail); err != nil {
			t.Fatal(err)
		}
		plan = append(plan, detail)
	}
	joined := strings.Join(plan, "\n")
	if !strings.Contains(joined, "idx_library_downloaded_at") {
		t.Errorf("default sort does not use idx_library_downloaded_at:\n%s", joined)
	}
	if strings.Contains(joined, "USE TEMP B-TREE FOR ORDER BY") {
		t.Errorf("default sort still sorts in a temp b-tree:\n%s", joined)
	}
}

// sortRow is one library row inserted by TestLibraryQuerySortOrder.
type sortRow struct {
	title, filename, downloadedAt string
	year, duration, seq, season   *int
	lastWatched                   *string
}

// Every sort key and direction orders like a straightforward Go sort with
// NULLs always last, for a mix of values, ties and NULLs.
func TestLibraryQuerySortOrder(t *testing.T) {
	ctx := context.Background()
	dl := openTestDB(t)
	repo := NewLibraryRepo(dl.db)

	type row = sortRow
	ip := func(v int) *int { return &v }
	sp := func(v string) *string { return &v }
	data := []row{
		{"b", "3.mp4", "2024-01-02 00:00:00", ip(2020), ip(30), ip(2), ip(1), sp("2024-05-01 00:00:00")},
		{"a", "1.mp4", "2024-01-03 00:00:00", nil, nil, nil, nil, nil},
		{"c", "2.mp4", "2024-01-01 00:00:00", ip(2019), ip(10), ip(1), ip(2), sp("2024-06-01 00:00:00")},
		{"d", "5.mp4", "2024-01-05 00:00:00", ip(2021), nil, ip(3), nil, nil},
		{"e", "4.mp4", "2024-01-04 00:00:00", nil, ip(20), nil, ip(1), sp("2024-04-01 00:00:00")},
	}
	rowByTitle := map[string]sortRow{}
	for _, d := range data {
		res, err := dl.db.ExecContext(ctx, `
			INSERT INTO library (title, filename, path, downloaded_at, release_year, duration, sequence_number, season_number, last_watched_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			d.title, d.filename, d.filename, d.downloadedAt, d.year, d.duration, d.seq, d.season, d.lastWatched)
		if err != nil {
			t.Fatal(err)
		}
		_ = res
		rowByTitle[d.title] = d
	}

	// less reports whether a sorts before b ascending; nulls are handled by the caller.
	intLess := func(a, b *int) (less, tie bool) {
		return *a < *b, *a == *b
	}
	cases := []struct {
		key string
		// cmp returns -1/0/1 for ascending order of x vs y (both non-nil
		// handled inside); nullRank says whether x is null.
		cmp func(x, y row) int
		// isNull reports whether the key is NULL for the row.
		isNull func(x row) bool
	}{
		{"downloadedAt", func(x, y row) int { return strings.Compare(x.downloadedAt, y.downloadedAt) }, func(row) bool { return false }},
		{"title", func(x, y row) int { return strings.Compare(x.title, y.title) }, func(row) bool { return false }},
		{"filename", func(x, y row) int { return strings.Compare(x.filename, y.filename) }, func(row) bool { return false }},
		{"year", func(x, y row) int { return cmpInt(x.year, y.year, intLess) }, func(x row) bool { return x.year == nil }},
		{"duration", func(x, y row) int { return cmpInt(x.duration, y.duration, intLess) }, func(x row) bool { return x.duration == nil }},
		{"sequenceNumber", func(x, y row) int { return cmpInt(x.seq, y.seq, intLess) }, func(x row) bool { return x.seq == nil }},
		{"lastWatchedAt", func(x, y row) int { return strings.Compare(*x.lastWatched, *y.lastWatched) }, func(x row) bool { return x.lastWatched == nil }},
	}

	for _, tc := range cases {
		for _, dir := range []string{"asc", "desc"} {
			t.Run(fmt.Sprintf("%s/%s", tc.key, dir), func(t *testing.T) {
				want := append([]row(nil), data...)
				sort.SliceStable(want, func(i, j int) bool {
					ni, nj := tc.isNull(want[i]), tc.isNull(want[j])
					if ni || nj {
						return !ni && nj // nulls last in both directions
					}
					c := tc.cmp(want[i], want[j])
					if dir == "desc" {
						return c > 0
					}
					return c < 0
				})
				items, _, err := repo.Query(ctx, LibraryQuery{SortKey: tc.key, SortDir: dir})
				if err != nil {
					t.Fatal(err)
				}
				if len(items) != len(want) {
					t.Fatalf("got %d items, want %d", len(items), len(want))
				}
				// Rows tied on the key (e.g. several NULLs) may come back in any
				// order, so compare only the non-null prefix strictly.
				for i, w := range want {
					if tc.isNull(w) {
						if !tc.isNull(rowByTitle[items[i].Title]) {
							t.Errorf("position %d: got %q, want a NULL-keyed row", i, items[i].Title)
						}
						continue
					}
					if items[i].Title != w.title {
						t.Errorf("position %d: got %q, want %q", i, items[i].Title, w.title)
					}
				}
			})
		}
	}

	t.Run("seasonNumber", func(t *testing.T) {
		items, _, err := repo.Query(ctx, LibraryQuery{SortKey: "seasonNumber", SortDir: "asc"})
		if err != nil {
			t.Fatal(err)
		}
		// season asc (nulls last), then sequence asc (nulls last) within a season.
		var got []string
		for _, it := range items {
			got = append(got, it.Title)
		}
		// season 1: b(seq 2), e(seq NULL); season 2: c; NULL season: a, d(seq 3).
		want := []string{"b", "e", "c", "d", "a"}
		if fmt.Sprint(got) != fmt.Sprint(want) {
			t.Errorf("seasonNumber asc = %v, want %v", got, want)
		}
	})
}

func cmpInt(a, b *int, less func(a, b *int) (bool, bool)) int {
	l, tie := less(a, b)
	switch {
	case tie:
		return 0
	case l:
		return -1
	}
	return 1
}

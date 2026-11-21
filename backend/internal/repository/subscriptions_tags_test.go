package repository

import (
	"context"
	"path/filepath"
	"reflect"
	"testing"

	"packrat/backend/internal/db"
	"packrat/backend/internal/models"
)

func TestDecodeSubscriptionTags(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want []string
	}{
		{"empty", "", []string{}},
		{"whitespace only", "  ", []string{}},
		{"json", `["a","b"]`, []string{"a", "b"}},
		{"json with comma tag", `["a","b,c"]`, []string{"a", "b,c"}},
		{"json with quote and unicode", `["say \"hi\"","日本語","ünï"]`, []string{`say "hi"`, "日本語", "ünï"}},
		{"json empty array", `[]`, []string{}},
		{"json null elements array literal null", `null`, []string{"null"}},
		{"json with surrounding whitespace", "  [\"a\"] \n", []string{"a"}},
		{"legacy", "a,b,c", []string{"a", "b", "c"}},
		{"legacy single", "music", []string{"music"}},
		{"malformed bracket falls back to legacy split", `["a","b`, []string{`["a"`, `"b`}},
		{"bracket but wrong json type falls back", `[1,2]`, []string{"[1", "2]"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := decodeSubscriptionTags(tt.raw); !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("decode(%q) = %#v, want %#v", tt.raw, got, tt.want)
			}
		})
	}
}

func TestSubscriptionTagsRoundTrip(t *testing.T) {
	for _, tags := range [][]string{
		{"a", "b,c"},
		{`say "hi"`, "日本語", `back\slash`, "[bracket]"},
		{"plain"},
		{},
		nil,
	} {
		got := decodeSubscriptionTags(encodeSubscriptionTags(tags))
		want := tags
		if len(want) == 0 {
			want = []string{}
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("round trip of %#v = %#v", tags, got)
		}
	}
	if enc := encodeSubscriptionTags(nil); enc != "" {
		t.Errorf("empty list should store an empty column, got %q", enc)
	}
}

// Through the real table: a new row is stored as JSON, a legacy comma-joined row
// still reads, and saving that row rewrites it in the new format.
func TestSubscriptionTagsStoredFormat(t *testing.T) {
	ctx := context.Background()
	conn, err := db.Open(filepath.Join(t.TempDir(), "packrat_test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	migrationsDir, _ := filepath.Abs("../../../database/migrations")
	if err := db.Migrate(conn, migrationsDir); err != nil {
		t.Fatal(err)
	}
	subs := NewSubscriptionsRepo(conn)
	raw := func(id int64) string {
		var s string
		if err := conn.QueryRow("SELECT tags FROM subscriptions WHERE id = ?", id).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}

	id, err := subs.Create(ctx, &models.Subscription{URL: "https://example.test/a", Title: "a", MediaType: "video", CheckIntervalHours: 6, Enabled: true, Tags: []string{"x,y", "z"}})
	if err != nil {
		t.Fatal(err)
	}
	if got := raw(id); got != `["x,y","z"]` {
		t.Fatalf("stored = %q", got)
	}
	got, err := subs.Get(ctx, id)
	if err != nil || !reflect.DeepEqual(got.Tags, []string{"x,y", "z"}) {
		t.Fatalf("Get = %+v, %v", got, err)
	}

	// A row written by the old format.
	if _, err := conn.Exec("UPDATE subscriptions SET tags = ? WHERE id = ?", "old1,old2", id); err != nil {
		t.Fatal(err)
	}
	got, err = subs.Get(ctx, id)
	if err != nil || !reflect.DeepEqual(got.Tags, []string{"old1", "old2"}) {
		t.Fatalf("legacy Get = %+v, %v", got, err)
	}
	// Saving rewrites it in the new format; no migration needed.
	if err := subs.Update(ctx, got); err != nil {
		t.Fatal(err)
	}
	if s := raw(id); s != `["old1","old2"]` {
		t.Fatalf("after save stored = %q", s)
	}
}

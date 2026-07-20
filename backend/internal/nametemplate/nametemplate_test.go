package nametemplate

import (
	"reflect"
	"testing"
)

func TestResolve_TokenSubstitution(t *testing.T) {
	vars := Vars{
		Title:      "My Video",
		Uploader:   "Some Channel",
		Date:       "20240102",
		Artist:     "Some Artist",
		Year:       "2024",
		Season:     "1",
		Sequence:   "3",
		Collection: "Shows",
	}

	got := Resolve("{artist} - {title} ({year}) [{collection}] {uploader} {channel} {date} S{season}E{sequence}", vars)
	want := []string{"Some Artist - My Video (2024) [Shows] Some Channel Some Channel 20240102 S1E3"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func TestResolve_NestedSegments(t *testing.T) {
	got := Resolve("{artist}/{title}", Vars{Artist: "Artist Name", Title: "Track Title"})
	want := []string{"Artist Name", "Track Title"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func TestResolve_EmptyVariableDropsSegment(t *testing.T) {
	// No Artist set — the leading segment should disappear entirely rather
	// than producing an empty path component.
	got := Resolve("{artist}/{title}", Vars{Title: "Track Title"})
	want := []string{"Track Title"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func TestResolve_TraversalSegmentSanitizesAway(t *testing.T) {
	cases := []struct {
		tmpl string
		want []string
	}{
		{"../{title}", []string{"Title"}},
		{"..{title}", []string{"Title"}}, // sanitized as one segment: leading ".." trimmed
		{"{title}/../etc", []string{"Title", "etc"}},
	}
	for _, c := range cases {
		got := Resolve(c.tmpl, Vars{Title: "Title"})
		if !reflect.DeepEqual(got, c.want) {
			t.Fatalf("Resolve(%q): got %#v, want %#v", c.tmpl, got, c.want)
		}
	}
}

func TestResolve_BlankTemplateReturnsNil(t *testing.T) {
	if got := Resolve("", Vars{Title: "x"}); got != nil {
		t.Fatalf("expected nil for blank template, got %#v", got)
	}
	if got := Resolve("   ", Vars{Title: "x"}); got != nil {
		t.Fatalf("expected nil for whitespace-only template, got %#v", got)
	}
}

func TestResolve_ZeroPadModifier(t *testing.T) {
	cases := []struct {
		tmpl string
		want []string
	}{
		{"S{season:02}E{sequence:02}", []string{"S01E03"}},
		{"S{season:02}E{sequence:02}", []string{"S01E03"}},
	}
	vars := Vars{Season: "1", Sequence: "3"}
	for _, c := range cases {
		got := Resolve(c.tmpl, vars)
		if !reflect.DeepEqual(got, c.want) {
			t.Fatalf("Resolve(%q): got %#v, want %#v", c.tmpl, got, c.want)
		}
	}

	// Already wide enough — padding is a minimum width, not truncation.
	got := Resolve("S{season:02}", Vars{Season: "12"})
	want := []string{"S12"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func TestResolve_ZeroPadModifierIgnoredOnNonNumericValue(t *testing.T) {
	// A digit modifier used on a field whose value isn't a plain integer
	// (e.g. {artist:02}) falls back to the raw value instead of erroring.
	got := Resolve("{artist:02}", Vars{Artist: "Rick Astley"})
	want := []string{"Rick Astley"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func TestResolve_JoinModifier(t *testing.T) {
	got := Resolve("{artist:.}", Vars{Artist: "Rick Astley"})
	want := []string{"Rick.Astley"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}

	got = Resolve("{artist:_}/{title}", Vars{Artist: "Rick  Astley", Title: "Song Name"})
	want = []string{"Rick_Astley", "Song Name"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func TestResolve_PlainTokenBackwardCompatible(t *testing.T) {
	// Existing templates with no modifiers must resolve exactly as before.
	got := Resolve("{artist}/{title}", Vars{Artist: "Artist Name", Title: "Track Title"})
	want := []string{"Artist Name", "Track Title"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

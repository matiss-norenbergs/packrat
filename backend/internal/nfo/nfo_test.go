package nfo

import (
	"strings"
	"testing"

	"packrat/backend/internal/models"
)

func TestBuildAllFieldsSet(t *testing.T) {
	desc := "A great video"
	uploader := "Some Channel"
	year := 2024
	seq := 3
	item := models.LibraryItem{
		Title:          "My Video",
		Description:    &desc,
		Uploader:       &uploader,
		ReleaseYear:    &year,
		SequenceNumber: &seq,
	}

	out := string(Build(item, []string{"funny", "how-to"}))

	for _, want := range []string{
		"<title>My Video</title>",
		"<plot>A great video</plot>",
		"<year>2024</year>",
		"<episode>3</episode>",
		"<studio>Some Channel</studio>",
		"<tag>funny</tag>",
		"<tag>how-to</tag>",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("output missing %q, got:\n%s", want, out)
		}
	}
}

func TestBuildOptionalFieldsNil(t *testing.T) {
	item := models.LibraryItem{Title: "Bare Video"}

	out := string(Build(item, nil))

	if !strings.Contains(out, "<title>Bare Video</title>") {
		t.Errorf("output missing title, got:\n%s", out)
	}
	for _, absent := range []string{"<plot>", "<year>", "<episode>", "<studio>", "<tag>"} {
		if strings.Contains(out, absent) {
			t.Errorf("output should omit %q when unset, got:\n%s", absent, out)
		}
	}
}

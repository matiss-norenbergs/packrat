package fsutil

import "testing"

func TestSanitizeFilenameReservedNames(t *testing.T) {
	cases := map[string]string{
		"CON": "CON_", "con": "con_", "Con": "Con_", "PRN": "PRN_", "AUX": "AUX_", "NUL": "NUL_",
		"COM1": "COM1_", "com9": "com9_", "LPT1": "LPT1_", "lpt9": "lpt9_",
		"CON.mp4": "CON_.mp4", "con.mp4": "con_.mp4", "Nul.tar.gz": "Nul_.tar.gz", "aux.": "aux_",
		" CON ": "CON_", "CON .txt": "CON _.txt",
		// Not reserved.
		"Icon": "Icon", "console.log": "console.log", "CONN": "CONN", "xCON": "xCON", "CON-1": "CON-1",
		"COM0": "COM0", "COM10": "COM10", "COM": "COM", "LPT": "LPT", "LPTX": "LPTX", "a.CON": "a.CON",
		"Concert.mp4": "Concert.mp4", "Nullable": "Nullable", "Auxiliary": "Auxiliary", "Printer": "Printer",
		// Ordinary cleaning is unchanged.
		"a/b": "ab", "..": "", "  x. ": "x", "": "", "bad:name?": "badname",
	}
	for in, want := range cases {
		if got := SanitizeFilename(in); got != want {
			t.Errorf("SanitizeFilename(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSanitizeRelativePathReservedSegments(t *testing.T) {
	if got := SanitizeRelativePath("Music/CON/aux.mp3/../x"); got != "Music/CON_/aux_.mp3/x" {
		t.Errorf("got %q", got)
	}
	if got := SanitizeExistingRelativePath("Music/CON/aux.mp3/../x"); got != "Music/CON/aux.mp3/x" {
		t.Errorf("existing: got %q", got)
	}
}

func TestExistingNamesAreLeftAlone(t *testing.T) {
	if got := SanitizeExistingFilename("CON.mp4"); got != "CON.mp4" {
		t.Errorf("SanitizeExistingFilename kept %q", got)
	}
	// SanitizeRename: the unchanged name stays, a different one is cleaned as new.
	for _, tc := range []struct{ submitted, current, want string }{
		{"CON", "CON", "CON"},
		{" CON ", "CON", "CON"},
		{"con", "CON", "con_"},
		{"CON", "Movie", "CON_"},
		{"Movie", "Movie", "Movie"},
		{"New", "CON", "New"},
		{"CON", "", "CON_"},
	} {
		if got := SanitizeRename(tc.submitted, tc.current); got != tc.want {
			t.Errorf("SanitizeRename(%q, %q) = %q, want %q", tc.submitted, tc.current, got, tc.want)
		}
	}
}

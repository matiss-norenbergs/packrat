package downloader

import "testing"

func TestVersionsEqual(t *testing.T) {
	tests := []struct {
		name string
		a, b string
		want bool
	}{
		{"identical strings", "2026.7.4", "2026.7.4", true},
		{"zero-padded vs normalized (the real PyPI/--version mismatch)", "2026.07.04", "2026.7.4", true},
		{"zero-padded vs zero-padded", "2026.07.04", "2026.07.04", true},
		{"genuinely different versions", "2026.07.04", "2026.07.05", false},
		{"different segment counts", "2026.7.4", "2026.7", false},
		{"empty strings", "", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := VersionsEqual(tt.a, tt.b); got != tt.want {
				t.Errorf("VersionsEqual(%q, %q) = %v, want %v", tt.a, tt.b, got, tt.want)
			}
		})
	}
}

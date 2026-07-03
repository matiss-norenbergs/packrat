package downloader

import "testing"

func TestParseProgressLine(t *testing.T) {
	cases := []struct {
		name string
		line string
		want ProgressEvent
		ok   bool
	}{
		{
			name: "downloading with unknown total, falls back to estimate",
			line: "PACKRAT-PROGRESS:downloading|test4.mp4|102648|NA|500000|65894.76|NA|  4.1%",
			want: ProgressEvent{Status: "downloading", Filename: "test4.mp4", DownloadedBytes: 102648, TotalBytes: 500000, SpeedBytesPerSec: 65894.76, ETASeconds: -1, Percent: 4.1},
			ok:   true,
		},
		{
			name: "finished with known total",
			line: "PACKRAT-PROGRESS:finished|test4.mp4|4493576|4493576|NA|179802.46|NA|100.0%",
			want: ProgressEvent{Status: "finished", Filename: "test4.mp4", DownloadedBytes: 4493576, TotalBytes: 4493576, SpeedBytesPerSec: 179802.46, ETASeconds: -1, Percent: 100.0},
			ok:   true,
		},
		{
			name: "eta and speed present",
			line: "PACKRAT-PROGRESS:downloading|test4.mp4|4445016|NA|4500000|182484.75|1.77|97.6%",
			want: ProgressEvent{Status: "downloading", Filename: "test4.mp4", DownloadedBytes: 4445016, TotalBytes: 4500000, SpeedBytesPerSec: 182484.75, ETASeconds: 1, Percent: 97.6},
			ok:   true,
		},
		{
			name: "not a progress line",
			line: "[youtube] Extracting URL: https://example.com",
			ok:   false,
		},
		{
			name: "malformed progress line (wrong field count)",
			line: "PACKRAT-PROGRESS:downloading|only|three",
			ok:   false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := ParseProgressLine(tc.line)
			if ok != tc.ok {
				t.Fatalf("ok = %v, want %v", ok, tc.ok)
			}
			if !ok {
				return
			}
			if got != tc.want {
				t.Fatalf("got %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestParseFilepathLine(t *testing.T) {
	path, ok := ParseFilepathLine(`PACKRAT-FILEPATH:C:\media\video.mp4`)
	if !ok {
		t.Fatal("expected ok = true")
	}
	if path != `C:\media\video.mp4` {
		t.Fatalf("got %q", path)
	}

	_, ok = ParseFilepathLine("[download] Destination: video.mp4")
	if ok {
		t.Fatal("expected ok = false for non-filepath line")
	}
}

func TestBuildFormatSelector(t *testing.T) {
	if got := BuildFormatSelector("1080p"); got != "bestvideo[height<=1080]+bestaudio/best[height<=1080]" {
		t.Fatalf("unexpected selector: %s", got)
	}
	if got := BuildFormatSelector("nonsense"); got != videoFormatSelectors["best"] {
		t.Fatalf("expected fallback to best, got %s", got)
	}
}

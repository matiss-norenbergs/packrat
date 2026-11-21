package api

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/ws"
)

// fakePlaylistYtDlp answers --dump-single-json by URL substring and records every
// invocation in <dir>/calls.log: "single" is one video; "pure" is a playlist
// even under --no-playlist; "mixed" is a playlist that collapses to one video
// under --no-playlist (watch?v=X&list=Y); "npfail" is a playlist whose
// --no-playlist fetch exits 1.
const fakePlaylistYtDlp = `#!/bin/sh
dir=$(dirname "$0")
echo "$@" >> "$dir/calls.log"
url=""; np=""
for a in "$@"; do
  [ "$a" = "--no-playlist" ] && np=1
  url="$a"
done
single='{"id":"v1","title":"One","uploader":"Up","duration":5}'
playlist='{"id":"PL","title":"PL","entries":[{"id":"a","url":"https://example.test/a"},{"id":"b","url":"https://example.test/b"}]}'
case "$url" in
  *single*) echo "$single";;
  *pure*) echo "$playlist";;
  *mixed*) if [ -n "$np" ]; then echo "$single"; else echo "$playlist"; fi;;
  *npfail*) if [ -n "$np" ]; then echo "boom" >&2; exit 1; else echo "$playlist"; fi;;
  *) echo "ERROR: unsupported" >&2; exit 1;;
esac
`

type guardEnv struct {
	f     *privacyFixture
	ytdlp *downloader.YtDlpService
	calls string
}

func newGuardEnv(t *testing.T) *guardEnv {
	t.Helper()
	if _, err := exec.LookPath("sh"); err != nil || runtime.GOOS == "windows" {
		t.Skip("needs the fake yt-dlp shell script")
	}
	f := newPrivacyFixture(t)
	dir := t.TempDir()
	bin := filepath.Join(dir, "yt-dlp")
	if err := os.WriteFile(bin, []byte(fakePlaylistYtDlp), 0o755); err != nil {
		t.Fatal(err)
	}
	return &guardEnv{f: f, ytdlp: &downloader.YtDlpService{BinPath: bin, FFmpegPath: "ffmpeg", SettingsRepo: f.settings}, calls: filepath.Join(dir, "calls.log")}
}

// callCount is how many times the fake yt-dlp was started.
func (g *guardEnv) callCount(t *testing.T) int {
	t.Helper()
	b, err := os.ReadFile(g.calls)
	if os.IsNotExist(err) {
		return 0
	}
	if err != nil {
		t.Fatal(err)
	}
	return len(strings.Split(strings.TrimSpace(string(b)), "\n"))
}

func (g *guardEnv) preview(t *testing.T, url string) (int, PreviewDownloadResponse) {
	t.Helper()
	e := &cleanupEnv{}
	w := e.do(t, PreviewDownloadMetadata(g.ytdlp, g.f.library, g.f.responder()), http.MethodPost, "/downloads/preview", "/downloads/preview", `{"url":"`+url+`"}`)
	var resp PreviewDownloadResponse
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
	}
	return w.Code, resp
}

func (g *guardEnv) createPlaylist(t *testing.T, url, mode string) (int, string) {
	t.Helper()
	mgr := queue.NewDownloadManager(g.f.mediaRoot, t.TempDir(), "", g.ytdlp, g.f.downloads, g.f.library, nil, nil, nil, nil, nil, nil, nil, nil, queue.NewProgressStore(), ws.NoopBroadcaster{})
	h := CreatePlaylistDownload(mgr, g.f.collections, g.f.settings, g.f.library, repository.NewHistoryRepo(g.f.conn), g.f.responder(), g.ytdlp)
	e := &cleanupEnv{}
	body := `{"url":"` + url + `","downloadType":"video","playlistMode":"` + mode + `"}`
	w := e.do(t, h, http.MethodPost, "/downloads/playlist", "/downloads/playlist", body)
	return w.Code, w.Body.String()
}

func (g *guardEnv) downloadRows(t *testing.T) int {
	t.Helper()
	var n int
	if err := g.f.conn.QueryRow(`SELECT COUNT(*) FROM downloads`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestPreviewSingleVideoAvailable(t *testing.T) {
	cases := []struct {
		name      string
		url       string
		wantList  bool
		wantSingl bool
		wantCalls int
	}{
		{"single video: flag true, no second fetch", "https://example.test/single", false, true, 1},
		{"playlist collapsing to one video under --no-playlist", "https://example.test/mixed", true, true, 2},
		{"pure playlist", "https://example.test/pure", true, false, 2},
		{"second fetch fails: stays true", "https://example.test/npfail", true, true, 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			g := newGuardEnv(t)
			code, resp := g.preview(t, tc.url)
			if code != http.StatusOK {
				t.Fatalf("status = %d", code)
			}
			if resp.IsPlaylist != tc.wantList || resp.SingleVideoAvailable != tc.wantSingl {
				t.Fatalf("isPlaylist=%v singleVideoAvailable=%v, want %v/%v", resp.IsPlaylist, resp.SingleVideoAvailable, tc.wantList, tc.wantSingl)
			}
			if n := g.callCount(t); n != tc.wantCalls {
				t.Fatalf("yt-dlp invocations = %d, want %d", n, tc.wantCalls)
			}
		})
	}
}

func TestCreatePlaylistDownloadCurrentGuard(t *testing.T) {
	t.Run("pure playlist is refused and queues nothing", func(t *testing.T) {
		g := newGuardEnv(t)
		code, body := g.createPlaylist(t, "https://example.test/pure", "current")
		if code != http.StatusBadRequest || !strings.Contains(body, "This link is a playlist") {
			t.Fatalf("status=%d body=%s, want 400 with the playlist message", code, body)
		}
		if n := g.downloadRows(t); n != 0 {
			t.Fatalf("downloads rows = %d, want 0", n)
		}
	})
	t.Run("watch?v&list-shaped URL still queues one download", func(t *testing.T) {
		g := newGuardEnv(t)
		code, body := g.createPlaylist(t, "https://example.test/mixed", "current")
		if code != http.StatusCreated {
			t.Fatalf("status=%d body=%s, want 201", code, body)
		}
		if n := g.downloadRows(t); n != 1 {
			t.Fatalf("downloads rows = %d, want 1", n)
		}
	})
	t.Run("a failing check fails open", func(t *testing.T) {
		g := newGuardEnv(t)
		code, body := g.createPlaylist(t, "https://example.test/npfail", "current")
		if code != http.StatusCreated {
			t.Fatalf("status=%d body=%s, want 201", code, body)
		}
		if n := g.downloadRows(t); n != 1 {
			t.Fatalf("downloads rows = %d, want 1", n)
		}
	})
	t.Run("other modes never run the extra fetch", func(t *testing.T) {
		g := newGuardEnv(t)
		code, body := g.createPlaylist(t, "https://example.test/pure", "entire")
		if code != http.StatusCreated {
			t.Fatalf("status=%d body=%s, want 201", code, body)
		}
		if n := g.callCount(t); n != 1 {
			t.Fatalf("yt-dlp invocations = %d, want 1", n)
		}
		if b, _ := os.ReadFile(g.calls); strings.Contains(string(b), "--no-playlist") {
			t.Fatalf("entire mode ran a --no-playlist fetch: %s", b)
		}
	})
}

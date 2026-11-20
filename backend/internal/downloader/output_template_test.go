package downloader

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"packrat/backend/internal/db"
	"packrat/backend/internal/repository"
)

func TestOutputTemplateEscapesPercentInLiteralParts(t *testing.T) {
	cases := []struct{ dir, name, want string }{
		{"/m/v", "plain", "/m/v/plain.%(ext)s"},
		{"/m/v", "%(title)s", "/m/v/%%(title)s.%(ext)s"},
		{"/m/v", "100%", "/m/v/100%%.%(ext)s"},
		{"/m/v", "50%%", "/m/v/50%%%%.%(ext)s"},
		{"/m/v", "%", "/m/v/%%.%(ext)s"},
		{"/m/v", "a%(b", "/m/v/a%%(b.%(ext)s"},
		{"/m/100%/%(id)s", "x", "/m/100%%/%%(id)s/x.%(ext)s"},
		{"/m/v", "", "/m/v/%(title)s.%(ext)s"}, // the intentional yt-dlp title default
	}
	for _, tc := range cases {
		if got := OutputTemplate(tc.dir, tc.name); got != filepath.FromSlash(tc.want) {
			t.Errorf("OutputTemplate(%q, %q) = %q, want %q", tc.dir, tc.name, got, tc.want)
		}
	}
}

func TestBuildArgsEscapesPercentInOutputTemplate(t *testing.T) {
	conn, err := db.Open(filepath.Join(t.TempDir(), "packrat_test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	migrationsDir, _ := filepath.Abs("../../../database/migrations")
	if err := db.Migrate(conn, migrationsDir); err != nil {
		t.Fatal(err)
	}
	s := &YtDlpService{SettingsRepo: repository.NewSettingsRepo(conn)}
	args := s.BuildArgs(t.Context(), DownloadJob{URL: "https://example.test/v", DestDir: "/m/100%", Filename: "%(title)s 100%", DownloadType: "video", Quality: "best"})
	for i, a := range args {
		if a == "-o" {
			if want := filepath.FromSlash("/m/100%%/%%(title)s 100%%.%(ext)s"); args[i+1] != want {
				t.Fatalf("-o = %q, want %q", args[i+1], want)
			}
			return
		}
	}
	t.Fatal("no -o argument")
}

// With a real yt-dlp, the template must print back the literal text. A local server serving a
// video file lets the generic extractor run without the internet.
func TestOutputTemplateIsLiteralForYtDlp(t *testing.T) {
	bin, err := exec.LookPath("yt-dlp")
	if err != nil {
		if env := os.Getenv("YTDLP_BIN"); env != "" {
			bin = env
		} else {
			t.Skip("yt-dlp not installed")
		}
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "video/mp4")
		w.Write([]byte("not really a video"))
	}))
	defer srv.Close()

	for _, name := range []string{"%(title)s", "100%", "50%%", "%", "a%(b", "x%(id)s y"} {
		tmpl := OutputTemplate("/out/100%", name)
		cmd := exec.Command(bin, "--simulate", "--no-warnings", "--print", "filename", "-o", tmpl, srv.URL+"/clip.mp4")
		cmd.Env = append(os.Environ(), "NO_PROXY=127.0.0.1,localhost", "no_proxy=127.0.0.1,localhost")
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("yt-dlp failed for %q: %v\n%s", name, err, out)
		}
		want := filepath.FromSlash("/out/100%/"+name) + ".mp4"
		if got := strings.TrimSpace(string(out)); got != want {
			t.Errorf("name %q: yt-dlp printed %q, want %q", name, got, want)
		}
	}
}

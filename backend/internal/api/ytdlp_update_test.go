package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/downloader"
)

// ytdlpUpdateEnv wires UpdateYtDlp to shell fakes: pip sleeps, then installs version 2.0 and
// writes a "finished" marker; yt-dlp prints the content of the version file.
func ytdlpUpdateEnv(t *testing.T) (r *gin.Engine, dir string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fakes need a POSIX shell")
	}
	gin.SetMode(gin.TestMode)
	dir = t.TempDir()
	must := func(err error) {
		if err != nil {
			t.Fatal(err)
		}
	}
	must(os.WriteFile(filepath.Join(dir, "version"), []byte("1.0"), 0o644))
	must(os.WriteFile(filepath.Join(dir, "yt-dlp"), []byte(fmt.Sprintf("#!/bin/sh\ncat %q/version\n", dir)), 0o755))
	must(os.WriteFile(filepath.Join(dir, "pip"), []byte(fmt.Sprintf(`#!/bin/sh
touch %[1]q/started
sleep 1
echo 2.0 > %[1]q/version
touch %[1]q/finished
`, dir)), 0o755))
	r = gin.New()
	r.POST("/ytdlp/update", UpdateYtDlp(downloader.NewYtDlpService(filepath.Join(dir, "yt-dlp"), "", filepath.Join(dir, "pip"), nil, 1)))
	return r, dir
}

func waitForFile(t *testing.T, p string) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		if _, err := os.Stat(p); err == nil {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", p)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestUpdateYtDlpSecondRequestGets409AndFirstCompletes(t *testing.T) {
	r, dir := ytdlpUpdateEnv(t)
	first := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/ytdlp/update", nil))
		first <- w
	}()
	waitForFile(t, filepath.Join(dir, "started"))

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/ytdlp/update", nil))
	if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "already being updated") {
		t.Fatalf("second request: %d %s", w.Code, w.Body)
	}
	w1 := <-first
	if w1.Code != http.StatusOK || !strings.Contains(w1.Body.String(), `"version":"2.0"`) {
		t.Fatalf("first request: %d %s", w1.Code, w1.Body)
	}
}

// Closing the tab cancels the request context; pip must still finish and the new version stays.
func TestUpdateYtDlpRequestCancelledMidUpdateStillFinishes(t *testing.T) {
	r, dir := ytdlpUpdateEnv(t)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		req := httptest.NewRequest(http.MethodPost, "/ytdlp/update", nil).WithContext(ctx)
		r.ServeHTTP(httptest.NewRecorder(), req)
	}()
	waitForFile(t, filepath.Join(dir, "started"))
	cancel()
	<-done

	if _, err := os.Stat(filepath.Join(dir, "finished")); err != nil {
		t.Fatal("pip was stopped by the cancelled request")
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "version")); strings.TrimSpace(string(b)) != "2.0" {
		t.Fatalf("version file = %q", b)
	}
}

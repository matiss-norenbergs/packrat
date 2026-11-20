package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

// Two quick redownloads of one item used to both pass the "no active
// download" check before either enqueued. The check and the enqueue are now
// atomic per item: exactly one request queues, the others get 409.
func TestConcurrentRedownloadsQueueExactlyOne(t *testing.T) {
	gin.SetMode(gin.TestMode)
	e := newCleanupEnv(t)
	settings := repository.NewSettingsRepo(e.conn)
	collections := repository.NewCollectionsRepo(e.conn)

	r := gin.New()
	r.POST("/library/:id/redownload", RedownloadLibraryItem(e.library, e.downloads, e.mgr, collections, settings))
	r.POST("/library/:id/redownload/from-url", RedownloadLibraryItemFromURL(e.library, e.downloads, e.mgr, collections, settings))

	const rounds, callers = 25, 8
	for round := 0; round < rounds; round++ {
		url := fmt.Sprintf("https://example.test/v%d", round)
		id, err := e.library.Create(context.Background(), &models.LibraryItem{Title: "item", Filename: "a.mp4", Path: "a.mp4", Status: "completed", OriginalURL: &url})
		if err != nil {
			t.Fatal(err)
		}

		codes := make([]int, callers)
		var wg sync.WaitGroup
		start := make(chan struct{})
		for i := 0; i < callers; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				<-start
				path, body := fmt.Sprintf("/library/%d/redownload", id), ""
				if i%2 == 1 {
					path = fmt.Sprintf("/library/%d/redownload/from-url", id)
					body = `{"url":"https://example.test/other","overwriteFields":["title"]}`
				}
				req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
				req.Header.Set("Content-Type", "application/json")
				w := httptest.NewRecorder()
				r.ServeHTTP(w, req)
				codes[i] = w.Code
			}(i)
		}
		close(start)
		wg.Wait()

		created, conflicts := 0, 0
		for _, c := range codes {
			switch c {
			case http.StatusCreated:
				created++
			case http.StatusConflict:
				conflicts++
			default:
				t.Fatalf("round %d: unexpected status %d (all: %v)", round, c, codes)
			}
		}
		if created != 1 || conflicts != callers-1 {
			t.Fatalf("round %d: %d created, %d conflicts; want 1 and %d (%v)", round, created, conflicts, callers-1, codes)
		}
		m, err := e.downloads.ActiveDownloadIDsByLibraryItem(context.Background(), []int64{id})
		if err != nil || len(m) != 1 {
			t.Fatalf("round %d: active downloads for item = %v (err %v), want 1", round, m, err)
		}
	}
}

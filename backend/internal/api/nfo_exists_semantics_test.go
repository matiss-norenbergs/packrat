package api

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
	"packrat/backend/internal/nfo"
)

// nfoItem inserts an item with a real media path and, optionally, a .nfo beside it.
func (f *privacyFixture) nfoItem(name string, generateNFO, writeNFO bool) models.LibraryItem {
	f.t.Helper()
	rel := name + ".mp4"
	if err := os.WriteFile(filepath.Join(f.mediaRoot, rel), []byte("x"), 0o644); err != nil {
		f.t.Fatal(err)
	}
	if writeNFO {
		if err := os.WriteFile(nfo.SidecarPath(filepath.Join(f.mediaRoot, rel)), []byte("<movie/>"), 0o644); err != nil {
			f.t.Fatal(err)
		}
	}
	id, err := f.library.Create(f.ctx, &models.LibraryItem{Title: name, Filename: rel, Path: rel, Status: "completed", GenerateNFO: generateNFO})
	if err != nil {
		f.t.Fatal(err)
	}
	it, err := f.library.Get(f.ctx, id)
	if err != nil {
		f.t.Fatal(err)
	}
	return *it
}

// A list response stats only the generateNfo items (in request order, results
// matching the real files); a single-item response always stats.
func TestItemResponderNFOExistsListVsSingle(t *testing.T) {
	f := newPrivacyFixture(t)
	var items []models.LibraryItem
	wantList := map[int64]bool{}
	for i := 0; i < 40; i++ {
		flag := i%2 == 0
		file := i%3 != 0
		it := f.nfoItem(fmt.Sprintf("i%02d", i), flag, file)
		items = append(items, it)
		wantList[it.ID] = flag && file // unchecked (flag off) reads false even with a file
	}
	// A ghost-like item without a path is never stat'ed.
	ghostID, err := f.library.Create(f.ctx, &models.LibraryItem{Title: "ghost", Status: "ghost", GenerateNFO: true})
	if err != nil {
		t.Fatal(err)
	}
	g, _ := f.library.Get(f.ctx, ghostID)
	items = append(items, *g)

	r := f.responder()
	var stats atomic.Int32
	var mu sync.Mutex
	statted := map[string]int{}
	var inFlight, peak atomic.Int32
	r.nfoExists = func(root, rel string) bool {
		stats.Add(1)
		cur := inFlight.Add(1)
		for {
			p := peak.Load()
			if cur <= p || peak.CompareAndSwap(p, cur) {
				break
			}
		}
		time.Sleep(2 * time.Millisecond) // let workers overlap
		inFlight.Add(-1)
		mu.Lock()
		statted[rel]++
		mu.Unlock()
		return nfoSidecarExists(root, rel)
	}

	out, err := r.Responses(f.ctx, items)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != len(items) {
		t.Fatalf("got %d responses", len(out))
	}
	flagged := 0
	for i, it := range items {
		if out[i].ID != it.ID {
			t.Fatalf("order changed at %d: %d vs %d", i, out[i].ID, it.ID)
		}
		want := wantList[it.ID]
		if out[i].NFOExists != want {
			t.Errorf("list: item %d (flag=%v path=%q) nfoExists = %v, want %v", it.ID, it.GenerateNFO, it.Path, out[i].NFOExists, want)
		}
		if it.GenerateNFO && it.Path != "" {
			flagged++
			if statted[it.Path] != 1 {
				t.Errorf("flagged item %q stat'ed %d times", it.Path, statted[it.Path])
			}
		} else if it.Path != "" && statted[it.Path] != 0 {
			t.Errorf("unflagged item %q was stat'ed", it.Path)
		}
	}
	if int(stats.Load()) != flagged {
		t.Errorf("%d stats for %d flagged items", stats.Load(), flagged)
	}
	if peak.Load() > nfoStatWorkers {
		t.Errorf("%d concurrent stats, limit %d", peak.Load(), nfoStatWorkers)
	}
	if peak.Load() < 2 {
		t.Errorf("stats never overlapped (peak %d): the pool is not running concurrently", peak.Load())
	}

	// Single-item responses always check the disk, flag or not.
	stats.Store(0)
	for _, it := range items {
		resp, err := r.Response(f.ctx, it)
		if err != nil {
			t.Fatal(err)
		}
		real := it.Path != "" && nfoSidecarExists(f.mediaRoot, it.Path)
		if resp.NFOExists != real {
			t.Errorf("single: item %d nfoExists = %v, want %v", it.ID, resp.NFOExists, real)
		}
	}
	withPath := 0
	for _, it := range items {
		if it.Path != "" {
			withPath++
		}
	}
	if int(stats.Load()) != withPath {
		t.Errorf("single responses made %d stats for %d items with a file", stats.Load(), withPath)
	}
}

// Through the endpoints: an item with the flag off but a leftover .nfo reads
// false in the list and true from GET /api/library/:id.
func TestLibraryEndpointsNFOExistsLeftoverFile(t *testing.T) {
	f := newPrivacyFixture(t)
	leftover := f.nfoItem("leftover", false, true)
	opted := f.nfoItem("opted", true, true)
	missing := f.nfoItem("missing", true, false)
	r := f.responder()
	mount := func(e *gin.Engine) {
		e.GET("/api/library", ListLibrary(f.library, r))
		e.GET("/api/library/:id", GetLibraryItem(f.library, r))
	}
	var list LibraryListResponse
	if w := serve(t, mount, http.MethodGet, "/api/library", &list); w.Code != http.StatusOK {
		t.Fatalf("list: %d %s", w.Code, w.Body.String())
	}
	got := map[int64]bool{}
	for _, it := range list.Items {
		got[it.ID] = it.NFOExists
	}
	if got[leftover.ID] || !got[opted.ID] || got[missing.ID] {
		t.Errorf("list nfoExists = %v (leftover must be false, opted true, missing false)", got)
	}
	for id, want := range map[int64]bool{leftover.ID: true, opted.ID: true, missing.ID: false} {
		var one LibraryItemResponse
		if w := serve(t, mount, http.MethodGet, fmt.Sprintf("/api/library/%d", id), &one); w.Code != http.StatusOK {
			t.Fatalf("get %d: %d %s", id, w.Code, w.Body.String())
		}
		if one.NFOExists != want {
			t.Errorf("single %d nfoExists = %v, want %v", id, one.NFOExists, want)
		}
	}
}

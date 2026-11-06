package api

import (
	"fmt"
	"net/http"
	"sync"
	"testing"
)

func TestSetupConcurrentCreatesExactlyOneUser(t *testing.T) {
	e := newAuthTestEnv(t)
	const n = 8
	codes := make([]int, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			w := authDo(e.r, authReq{method: "POST", path: "/api/auth/setup",
				body: fmt.Sprintf(`{"username":"user%d","password":"hunter2-hunter2"}`, i)})
			codes[i] = w.Code
		}(i)
	}
	wg.Wait()

	ok, conflict := 0, 0
	for _, c := range codes {
		switch c {
		case http.StatusOK, http.StatusNoContent:
			ok++
		case http.StatusConflict:
			conflict++
		default:
			t.Fatalf("unexpected status %d in %v", c, codes)
		}
	}
	if ok != 1 || conflict != n-1 {
		t.Fatalf("want 1 success and %d conflicts, got %v", n-1, codes)
	}
	var rows int
	if err := e.conn.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("users rows = %d, err = %v", rows, err)
	}
}

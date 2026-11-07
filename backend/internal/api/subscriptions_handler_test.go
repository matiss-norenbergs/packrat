package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/db"
	"packrat/backend/internal/downloader"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/subscriptions"
)

func newSubscriptionsTestDeps(t *testing.T) (subscriptions.CheckDeps, *repository.SubscriptionsRepo) {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "packrat_test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	migrationsDir, _ := filepath.Abs("../../../database/migrations")
	if err := db.Migrate(conn, migrationsDir); err != nil {
		t.Fatal(err)
	}
	subs := repository.NewSubscriptionsRepo(conn)
	return subscriptions.CheckDeps{
		SubscriptionsRepo: subs,
		CollectionsRepo:   repository.NewCollectionsRepo(conn),
		LibraryRepo:       repository.NewLibraryRepo(conn),
		TagsRepo:          repository.NewTagsRepo(conn),
	}, subs
}

func doSubscriptionRequest(h gin.HandlerFunc, method, route, path, body string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Handle(method, route, h)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w
}

func TestCheckSubscriptionNowAnswers409WhileChecking(t *testing.T) {
	deps, subs := newSubscriptionsTestDeps(t)
	ctx := context.Background()
	id, err := subs.Create(ctx, &models.Subscription{URL: "https://example.test/c", Title: "t", MediaType: "video", CheckIntervalHours: 6, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	entered := make(chan struct{})
	release := make(chan struct{})
	deps.FetchEntries = func(ctx context.Context, url string) ([]downloader.PlaylistEntry, error) {
		close(entered)
		<-release
		return nil, nil
	}
	sub, _ := subs.Get(ctx, id)
	done := make(chan error, 1)
	go func() {
		_, err := subscriptions.CheckOne(ctx, deps, *sub)
		done <- err
	}()
	<-entered

	path := "/subscriptions/" + strconv.FormatInt(id, 10) + "/check"
	w := doSubscriptionRequest(CheckSubscriptionNow(deps), http.MethodPost, "/subscriptions/:id/check", path, "")
	if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "already being checked") {
		t.Fatalf("status = %d body = %s, want 409 'already being checked'", w.Code, w.Body)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

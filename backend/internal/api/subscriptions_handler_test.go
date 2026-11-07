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

func TestResolveCreateInterval(t *testing.T) {
	for _, tc := range []struct {
		in, want int
		wantErr  bool
	}{
		{0, subscriptions.DefaultCheckIntervalHours, false},
		{-3, subscriptions.DefaultCheckIntervalHours, false},
		{1, 1, false},
		{subscriptions.MaxCheckIntervalHours, subscriptions.MaxCheckIntervalHours, false},
		{subscriptions.MaxCheckIntervalHours + 1, 0, true},
	} {
		got, err := resolveCreateInterval(tc.in)
		if (err != nil) != tc.wantErr || got != tc.want {
			t.Errorf("resolveCreateInterval(%d) = %d, %v; want %d, err=%v", tc.in, got, err, tc.want, tc.wantErr)
		}
	}
}

func TestCreateSubscriptionRejectsIntervalAboveMax(t *testing.T) {
	deps, subs := newSubscriptionsTestDeps(t)
	body := `{"url":"https://example.test/c","mediaType":"video","checkIntervalHours":8761}`
	w := doSubscriptionRequest(CreateSubscription(deps), http.MethodPost, "/subscriptions", "/subscriptions", body)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", w.Code, w.Body)
	}
	if list, _ := subs.List(context.Background()); len(list) != 0 {
		t.Fatalf("a subscription was saved: %+v", list)
	}
}

func TestUpdateSubscriptionIntervalBounds(t *testing.T) {
	deps, subs := newSubscriptionsTestDeps(t)
	ctx := context.Background()
	id, err := subs.Create(ctx, &models.Subscription{URL: "https://example.test/c", Title: "t", MediaType: "video", CheckIntervalHours: 12, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	path := "/subscriptions/" + strconv.FormatInt(id, 10)
	patch := func(hours string) *httptest.ResponseRecorder {
		body := `{"collectionId":null,"tags":[],"autoDownload":false,"generateNfo":false,"enabled":true,"checkIntervalHours":` + hours + `}`
		return doSubscriptionRequest(UpdateSubscription(deps), http.MethodPatch, "/subscriptions/:id", path, body)
	}

	for _, bad := range []string{"0", "-1", "8761", "9223372036854775807"} {
		if w := patch(bad); w.Code != http.StatusBadRequest {
			t.Errorf("interval %s: status = %d, want 400: %s", bad, w.Code, w.Body)
		}
		got, _ := subs.Get(ctx, id)
		if got.CheckIntervalHours != 12 {
			t.Fatalf("interval %s changed the stored value to %d", bad, got.CheckIntervalHours)
		}
	}
	if w := patch("24"); w.Code != http.StatusOK {
		t.Fatalf("in-range update: status = %d: %s", w.Code, w.Body)
	}
	if got, _ := subs.Get(ctx, id); got.CheckIntervalHours != 24 {
		t.Fatalf("stored interval = %d, want 24", got.CheckIntervalHours)
	}
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

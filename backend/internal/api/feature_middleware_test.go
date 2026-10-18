package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/db"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

func TestRequireFeature(t *testing.T) {
	gin.SetMode(gin.TestMode)
	conn, err := db.Open(filepath.Join(t.TempDir(), "packrat_test.db"))
	if err != nil {
		t.Fatalf("opening test db: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	migrationsDir, err := filepath.Abs("../../../database/migrations")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(conn, migrationsDir); err != nil {
		t.Fatalf("migrating test db: %v", err)
	}
	repo := repository.NewSettingsRepo(conn)

	r := gin.New()
	r.GET("/x", RequireFeature(repo, models.SettingFeatureCompareListEnabled, "Compare list"), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})
	call := func() int {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/x", nil))
		return w.Code
	}

	if got := call(); got != http.StatusNoContent {
		t.Fatalf("default: expected 204, got %d", got)
	}
	if err := repo.Set(context.Background(), models.SettingFeatureCompareListEnabled, "false"); err != nil {
		t.Fatal(err)
	}
	if got := call(); got != http.StatusForbidden {
		t.Fatalf("disabled: expected 403, got %d", got)
	}
	if err := repo.Set(context.Background(), models.SettingFeatureCompareListEnabled, "true"); err != nil {
		t.Fatal(err)
	}
	if got := call(); got != http.StatusNoContent {
		t.Fatalf("re-enabled: expected 204, got %d", got)
	}
}

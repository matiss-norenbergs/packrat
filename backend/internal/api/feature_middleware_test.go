package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

func TestRequireFeature(t *testing.T) {
	gin.SetMode(gin.TestMode)
	conn := openMigratedTestDB(t)
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

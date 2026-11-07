package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestListThumbnailUpscalers_PostBody(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var gotUser, gotPass string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUser, gotPass, _ = r.BasicAuth()
		_, _ = w.Write([]byte(`[{"name":"R-ESRGAN 4x+"},{"name":"Lanczos"}]`))
	}))
	defer upstream.Close()

	r := gin.New()
	r.POST("/up", ListThumbnailUpscalers())
	r.GET("/up", ListThumbnailUpscalers())

	body := `{"url":"` + upstream.URL + `","username":"u","password":"s3cret"}`
	req := httptest.NewRequest("POST", "/up", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"upscalers":["R-ESRGAN 4x+","Lanczos"]`) {
		t.Fatalf("unexpected body %s", w.Body.String())
	}
	if gotUser != "u" || gotPass != "s3cret" {
		t.Fatalf("credentials not forwarded: %q/%q", gotUser, gotPass)
	}

	// A query-string call carries no body and is rejected rather than honoured.
	req = httptest.NewRequest("GET", "/up?url="+upstream.URL+"&password=s3cret", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("query form: status %d, want 400", w.Code)
	}

	req = httptest.NewRequest("POST", "/up", strings.NewReader(`{"username":"u"}`))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("missing url: status %d, want 400", w.Code)
	}
}

func TestUpscalersRouteIsPostOnly(t *testing.T) {
	// The old GET form (password in the URL) must not be routed.
	b, err := osReadRouter()
	if err != nil {
		t.Skip(err)
	}
	if strings.Contains(b, `api.GET("/thumbnail-enhancement/upscalers"`) {
		t.Fatal("upscalers lookup must not be a GET route")
	}
	if !strings.Contains(b, `api.POST("/thumbnail-enhancement/upscalers"`) {
		t.Fatal("upscalers lookup must be a POST route")
	}
}

func osReadRouter() (string, error) {
	b, err := os.ReadFile("router.go")
	return string(b), err
}

func TestRedactToken_Secrets(t *testing.T) {
	for in, want := range map[string]string{
		"/x?password=hunter2":           "/x?password=REDACTED",
		"/x?url=a&password=hunter2&b=1": "/x?url=a&password=REDACTED&b=1",
		"/x?pass=p&secret=s":            "/x?pass=REDACTED&secret=REDACTED",
		"/x?Password=p":                 "/x?Password=REDACTED",
		"/x?passport=keep":              "/x?passport=keep",
	} {
		if got := redactToken(in); got != want {
			t.Errorf("redactToken(%q) = %q, want %q", in, got, want)
		}
	}
}

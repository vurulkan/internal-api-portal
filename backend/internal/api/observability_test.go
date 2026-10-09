package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"api-portal/backend/internal/models"
)

// raw sends req as the SPA would (with the CSRF header).
func (e *testEnv) raw(req *http.Request) *httptest.ResponseRecorder {
	if req.Header.Get(csrfHeader) == "" {
		req.Header.Set(csrfHeader, "1")
	}
	rec := httptest.NewRecorder()
	e.handler.ServeHTTP(rec, req)
	return rec
}

func TestErrorsAreJSONWithRequestID(t *testing.T) {
	e := newEnv(t)
	cases := []struct {
		method, path string
		want         int
		code         string
	}{
		{http.MethodGet, "/api/catalog", http.StatusUnauthorized, "unauthorized"},
		{http.MethodGet, "/api/nope", http.StatusNotFound, "not_found"},
		{http.MethodDelete, "/api/auth/login", http.StatusMethodNotAllowed, "method_not_allowed"},
		{http.MethodPost, "/api/auth/login", http.StatusBadRequest, "bad_request"},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader("{not json"))
		rec := e.raw(req)
		if rec.Code != tc.want {
			t.Fatalf("%s %s = %d, want %d", tc.method, tc.path, rec.Code, tc.want)
		}
		var body struct{ Error, Code, RequestID string }
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("%s %s: not JSON: %q", tc.method, tc.path, rec.Body.String())
		}
		if body.Error == "" || body.Code != tc.code {
			t.Errorf("%s %s: body = %+v", tc.method, tc.path, body)
		}
		if body.RequestID == "" || body.RequestID != rec.Header().Get("X-Request-Id") {
			t.Errorf("%s %s: requestId %q vs header %q", tc.method, tc.path, body.RequestID, rec.Header().Get("X-Request-Id"))
		}
	}
}

func TestRequestIDIsPropagatedToAudit(t *testing.T) {
	e := newEnv(t)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"username":"ghost","password":"x"}`))
	req.Header.Set("X-Request-Id", "trace-abc.123")
	rec := e.raw(req)
	if got := rec.Header().Get("X-Request-Id"); got != "trace-abc.123" {
		t.Fatalf("incoming request id not echoed: %q", got)
	}
	logs, _, _ := e.store.ListAuditLogs(context.Background(), 10, 0, "login.failed", "")
	if len(logs) == 0 || logs[0].RequestID != "trace-abc.123" {
		t.Fatalf("audit entry without the request id: %+v", logs)
	}

	// Unsafe ids are replaced, not echoed.
	req = httptest.NewRequest(http.MethodGet, "/livez", nil)
	req.Header.Set("X-Request-Id", "bad id\nwith newline")
	if got := e.raw(req).Header().Get("X-Request-Id"); got == "" || strings.ContainsAny(got, " \n") {
		t.Fatalf("unsafe request id handling: %q", got)
	}
}

func TestProbesAndMetrics(t *testing.T) {
	e := newEnv(t)
	for _, path := range []string{"/livez", "/healthz", "/readyz"} {
		e.expect(http.MethodGet, path, "", nil, http.StatusOK)
	}
	e.expect(http.MethodGet, "/api/catalog", "", nil, http.StatusUnauthorized)
	out := e.expect(http.MethodGet, "/metrics", "", nil, http.StatusOK)
	for _, want := range []string{
		`portal_http_requests_total{route="/api/catalog",method="GET",code="401"} 1`,
		`portal_http_request_duration_seconds_count{route="/readyz",method="GET"} 1`,
		"# TYPE portal_login_total counter",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("metrics missing %q", want)
		}
	}
}

func TestReadyzFailsWithoutDatabase(t *testing.T) {
	e := newEnv(t)
	// Closing the connection simulates a lost database.
	e.dbConn.Close()
	e.expect(http.MethodGet, "/readyz", "", nil, http.StatusServiceUnavailable)
	e.expect(http.MethodGet, "/livez", "", nil, http.StatusOK)
}

func TestSecurityHeadersAndCSP(t *testing.T) {
	e := newEnv(t)
	rec := e.raw(httptest.NewRequest(http.MethodGet, "/livez", nil))
	csp := rec.Header().Get("Content-Security-Policy")
	for _, want := range []string{"default-src 'self'", "script-src 'self'", "frame-ancestors 'none'", "object-src 'none'"} {
		if !strings.Contains(csp, want) {
			t.Errorf("CSP %q lacks %q", csp, want)
		}
	}
	if strings.Contains(csp, "unsafe-eval") {
		t.Errorf("CSP allows unsafe-eval: %q", csp)
	}
	if rec.Header().Get("Strict-Transport-Security") != "" {
		t.Error("HSTS sent while HSTS_ENABLED is off")
	}
	e.srv.config.HSTSEnabled = true
	if e.raw(httptest.NewRequest(http.MethodGet, "/livez", nil)).Header().Get("Strict-Transport-Security") == "" {
		t.Error("HSTS missing with HSTS_ENABLED")
	}
}

func TestStaticCacheHeaders(t *testing.T) {
	e := newEnv(t)
	dir := t.TempDir()
	_ = os.MkdirAll(filepath.Join(dir, "assets"), 0o755)
	_ = os.WriteFile(filepath.Join(dir, "index.html"), []byte("<!doctype html>"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, "assets", "app-abc123.js"), []byte("1"), 0o644)
	e.srv.staticDir = dir
	e.handler = e.srv.Router()

	if got := e.raw(httptest.NewRequest(http.MethodGet, "/assets/app-abc123.js", nil)).Header().Get("Cache-Control"); !strings.Contains(got, "immutable") {
		t.Errorf("hashed asset Cache-Control = %q", got)
	}
	rec := e.raw(httptest.NewRequest(http.MethodGet, "/apis/7", nil))
	if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "no-cache" {
		t.Errorf("SPA route: %d, Cache-Control = %q", rec.Code, rec.Header().Get("Cache-Control"))
	}
}

func TestOversizedJSONBodyIs413(t *testing.T) {
	e := newEnv(t)
	body := `{"username":"` + strings.Repeat("a", maxJSONBody) + `"}`
	rec := e.raw(httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader([]byte(body))))
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", rec.Code)
	}
}

func TestLDAPImportDoesNotConvertLocalAccounts(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	token := e.login("root")
	out := e.expect(http.MethodPost, "/api/admin/ldap/import", token, []models.LDAPUser{{Username: "root"}, {Username: "new-ldap-user"}}, http.StatusOK)
	var resp struct {
		Imported int
		Skipped  []string
	}
	_ = json.Unmarshal([]byte(out), &resp)
	if resp.Imported != 1 || len(resp.Skipped) != 1 || resp.Skipped[0] != "root" {
		t.Fatalf("import result = %+v", resp)
	}
	root, _ := e.store.GetUserByUsername(context.Background(), "root")
	if root.AuthSource != "local" {
		t.Fatalf("local admin was converted to %q", root.AuthSource)
	}
	// The local admin can still sign in with the local password.
	e.login("root")
}

func TestDeletingAPIRemovesItsScopedPermissions(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.user("root", true)
	token := e.login("root")
	id, err := e.store.CreateAPIDefinition(ctx, models.APIDefinition{Name: "pay", Slug: "pay", InternalOpenAPIURL: "http://x/spec", InternalBaseURL: "http://x", IsActive: true})
	if err != nil {
		t.Fatal(err)
	}
	roleID, _ := e.store.CreateRole(ctx, "pay-users", "")
	_ = e.store.ReplaceRolePermissions(ctx, roleID, []string{"api:" + strconv.Itoa(id) + ":invoke", "api:" + strconv.Itoa(id+10) + ":view", "api.view"})
	e.expect(http.MethodDelete, "/api/admin/apis/"+strconv.Itoa(id), token, nil, http.StatusOK)
	perms, _ := e.store.ListRolePermissions(ctx, roleID)
	if len(perms) != 2 {
		t.Fatalf("permissions left = %+v, want the other API's scope and api.view", perms)
	}
}

package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"api-portal/backend/internal/models"
)

func TestAPIWorkspaceDetails(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	id, _ := e.store.CreateAPIDefinition(ctx, models.APIDefinition{Name: "Payments", Slug: "payments", InternalOpenAPIURL: "http://10.1.2.3/spec", InternalBaseURL: "http://10.1.2.3", IsActive: true, TryItEnabled: true,
		AllowedRequestHeaders: []string{"X-Tenant-Id"}, InjectHeaders: []models.HeaderValue{{Name: "X-Service-Key", Value: "inject-secret-4242"}}})
	hidden := e.api("Hidden")
	viewer := e.user("viewer", false)
	e.grant(viewer.ID, fmt.Sprintf("api:%d:invoke", id))
	manager := e.user("manager", false)
	e.grant(manager.ID, fmt.Sprintf("api:%d:manage", id))
	v, m := e.login("viewer"), e.login("manager")

	body := e.expect(http.MethodGet, "/api/apis/payments", v, nil, http.StatusOK)
	var details map[string]any
	_ = json.Unmarshal([]byte(body), &details)
	if details["id"] != float64(id) || fmt.Sprint(details["injectHeaderNames"]) != "[X-Service-Key]" || fmt.Sprint(details["allowedRequestHeaders"]) != "[X-Tenant-Id]" {
		t.Fatalf("details by slug: %s", body)
	}
	for _, secret := range []string{"inject-secret-4242", "10.1.2.3"} {
		if strings.Contains(body, secret) {
			t.Errorf("viewer details contain %q", secret)
		}
	}
	if body := e.expect(http.MethodGet, "/api/apis/payments", m, nil, http.StatusOK); !strings.Contains(body, `"internalBaseUrl":"http://10.1.2.3"`) || strings.Contains(body, "inject-secret-4242") {
		t.Errorf("manager details: %s", body)
	}
	e.expect(http.MethodGet, "/api/apis/hidden", v, nil, http.StatusForbidden)
	e.expect(http.MethodGet, fmt.Sprintf("/api/apis/%d", hidden), v, nil, http.StatusForbidden)
	e.expect(http.MethodGet, "/api/apis/no-such-api", v, nil, http.StatusNotFound)
	e.expect(http.MethodGet, "/api/apis/payments/activity", v, nil, http.StatusForbidden)
	e.expect(http.MethodGet, "/api/apis/payments/activity", m, nil, http.StatusOK)
}

func TestSpecDownloadAndHistory(t *testing.T) {
	spec := paymentsSpec
	fail := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fail {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		_, _ = w.Write([]byte(spec))
	}))
	defer upstream.Close()
	e := newEnv(t)
	ctx := context.Background()
	id, _ := e.store.CreateAPIDefinition(ctx, models.APIDefinition{Name: "Payments", Slug: "payments", InternalOpenAPIURL: upstream.URL + "/spec", InternalBaseURL: upstream.URL, IsActive: true})
	e.user("root", true)
	root := e.login("root")
	refresh := func() { e.do(http.MethodPost, fmt.Sprintf("/api/admin/apis/%d/refresh", id), root, nil) }
	history := func() []models.SpecChange {
		var out struct{ Items []models.SpecChange }
		_ = json.Unmarshal([]byte(e.expect(http.MethodGet, "/api/apis/payments/activity", root, nil, http.StatusOK)), &out)
		return out.Items
	}

	refresh()
	req := httptest.NewRequest(http.MethodGet, "/api/apis/payments/spec?format=yaml&download=1", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookiePlain, Value: root})
	rec := e.raw(req)
	if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/yaml") ||
		rec.Header().Get("Content-Disposition") != `attachment; filename="payments.yaml"` || !strings.Contains(rec.Body.String(), "operationId: createCharge") {
		t.Fatalf("yaml download: %d %v %s", rec.Code, rec.Header(), rec.Body.String()[:80])
	}

	refresh() // unchanged spec: no entry
	if h := history(); len(h) != 1 || h[0].Kind != "initial" || h[0].OperationCount != 5 {
		t.Fatalf("after first refresh: %+v", h)
	}
	// Change one operation, remove one, add one.
	spec = strings.Replace(paymentsSpec, `"summary":"List charges"`, `"summary":"List charges","parameters":[{"name":"limit","in":"query"}]`, 1)
	spec = strings.Replace(spec, `"/v1/refunds":{"post"`, `"/v1/payouts":{"post"`, 1)
	refresh()
	h := history()
	if len(h) != 2 || h[0].Kind != "changed" || fmt.Sprint(h[0].Added) != "[POST /v1/payouts]" || fmt.Sprint(h[0].Removed) != "[POST /v1/refunds]" || fmt.Sprint(h[0].Changed) != "[GET /v1/charges]" {
		t.Fatalf("change: %+v", h[0])
	}
	// Failures are recorded once, not every refresh.
	fail = true
	refresh()
	refresh()
	if h := history(); len(h) != 3 || h[0].Kind != "failed" || !strings.Contains(h[0].Error, "502") {
		t.Fatalf("failures: %+v", h)
	}
}

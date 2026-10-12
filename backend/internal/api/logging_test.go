package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"api-portal/backend/internal/logging"
	"api-portal/backend/internal/models"
)

func field(m map[string]any, path string) any {
	var node any = m
	for _, part := range strings.Split(path, ".") {
		mm, ok := node.(map[string]any)
		if !ok {
			return nil
		}
		node = mm[part]
	}
	return node
}

// The pod log must be a complete audit trail on its own (it is shipped to
// Elasticsearch): every audit entry appears as one ECS line with all of its
// fields, every request as one portal.http line, and no secret appears anywhere.
func TestLogsAreACompleteECSAuditTrail(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	defer slog.SetDefault(prev)
	logging.SetupWriter(&buf, logging.Options{Format: "json", Service: "internal-api-portal", Version: "test"})

	secrets := []string{testPassword, "Changed-Pass-77x", "q-secret-6481", "hdr-secret-7713", "inject-secret-5521"}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
	}))
	defer upstream.Close()

	e := newEnv(t)
	ctx := context.Background()
	e.user("root", true)
	token := e.login("root")
	secrets = append(secrets, token)
	id, _ := e.store.CreateAPIDefinition(ctx, models.APIDefinition{Name: "Payments", Slug: "pay", InternalOpenAPIURL: upstream.URL + "/spec", InternalBaseURL: upstream.URL, IsActive: true, TryItEnabled: true,
		AllowedRequestHeaders: []string{"X-Api-Key"}, AllowedPathPrefixes: []string{"/v1"}, InjectHeaders: []models.HeaderValue{{Name: "X-Service-Key", Value: "inject-secret-5521"}}})
	invoke := fmt.Sprintf("/api/apis/%d/invoke", id)
	e.expect(http.MethodPost, invoke, token, map[string]any{"method": "POST", "path": "/v1/charges", "query": "token=q-secret-6481", "headers": map[string]string{"X-Api-Key": "hdr-secret-7713"}}, http.StatusOK)
	e.expect(http.MethodPost, invoke, token, map[string]any{"method": "GET", "path": "/admin"}, http.StatusForbidden)
	e.expect(http.MethodPost, "/api/admin/groups", token, map[string]string{"name": "ops"}, http.StatusCreated)
	e.do(http.MethodPost, "/api/auth/login", "", map[string]string{"username": "root", "password": "wrong-password-1"})
	e.expect(http.MethodPost, "/api/auth/change-password", token, map[string]string{"currentPassword": testPassword, "newPassword": "Changed-Pass-77x"}, http.StatusOK)
	e.expect(http.MethodGet, "/api/catalog", token, nil, http.StatusOK)

	var lines []map[string]any
	for _, raw := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		var m map[string]any
		if err := json.Unmarshal([]byte(raw), &m); err != nil {
			t.Fatalf("log line is not JSON: %q", raw)
		}
		for _, path := range []string{"@timestamp", "log.level", "message", "ecs.version", "service.name", "event.dataset", "event.kind"} {
			if field(m, path) == nil {
				t.Errorf("line without %s: %s", path, raw)
			}
		}
		lines = append(lines, m)
	}
	for _, secret := range secrets {
		if strings.Contains(buf.String(), secret) {
			t.Errorf("secret %q appears in the log", secret)
		}
	}

	byRequest := map[string][]map[string]any{}
	for _, l := range lines {
		if id, _ := field(l, "http.request.id").(string); id != "" {
			byRequest[id] = append(byRequest[id], l)
		}
	}
	entries, _, _ := e.store.ListAuditLogs(ctx, models.AuditFilter{}, 500, 0)
	if len(entries) < 6 {
		t.Fatalf("only %d audit entries", len(entries))
	}
	for _, entry := range entries {
		var auditLine map[string]any
		httpLines := 0
		for _, l := range byRequest[entry.RequestID] {
			switch field(l, "event.dataset") {
			case logging.DatasetAudit:
				if auditLine != nil {
					t.Errorf("%s: two audit lines for one request", entry.Action)
				}
				auditLine = l
			case logging.DatasetHTTP:
				httpLines++
			}
		}
		if auditLine == nil {
			t.Errorf("%s: no audit line in the log", entry.Action)
			continue
		}
		if httpLines != 1 {
			t.Errorf("%s: %d portal.http lines, want 1", entry.Action, httpLines)
		}
		want := map[string]any{
			"portal.audit.action":       entry.Action,
			"portal.audit.outcome":      entry.Outcome,
			"user.name":                 entry.User,
			"source.ip":                 entry.SourceIP,
			"http.response.status_code": float64(entry.StatusCode),
		}
		if entry.ResourceName != "" {
			want["portal.target.name"] = entry.ResourceName
		}
		if entry.ErrorMessage != "" {
			want["event.reason"] = entry.ErrorMessage
		}
		if entry.ActorSource != "" {
			want["user.domain"] = entry.ActorSource
		}
		for path, value := range want {
			if got := field(auditLine, path); got != value {
				t.Errorf("%s: %s = %#v, DB has %#v", entry.Action, path, got, value)
			}
		}
		if entry.Changes != "" && field(auditLine, "portal.changes") == nil {
			t.Errorf("%s: changes missing from the log", entry.Action)
		}
	}

	// Who called what on which API, with the upstream's answer.
	var success map[string]any
	for _, l := range lines {
		if field(l, "portal.audit.action") == "api.invoke.success" {
			success = l
		}
	}
	if success == nil || field(success, "http.request.method") != "POST" || field(success, "url.path") != "/v1/charges" ||
		field(success, "http.response.status_code") != float64(http.StatusAccepted) || field(success, "portal.http.status_code") != float64(http.StatusOK) ||
		field(success, "portal.target.name") != "Payments" || fmt.Sprint(field(success, "portal.invoke.query_params")) != "[token]" || field(success, "event.category").([]any)[0] != "web" {
		t.Fatalf("invoke audit line: %v", success)
	}
}

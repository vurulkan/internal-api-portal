package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"api-portal/backend/internal/models"
)

func (e *testEnv) auditByRequestID(id string) []models.AuditLog {
	e.t.Helper()
	logs, _, err := e.store.ListAuditLogs(context.Background(), models.AuditFilter{}, 500, 0)
	if err != nil {
		e.t.Fatal(err)
	}
	var out []models.AuditLog
	for _, l := range logs {
		if l.RequestID == id {
			out = append(out, l)
		}
	}
	return out
}

func (e *testEnv) doWithID(method, path, token, requestID string, body any) int {
	e.t.Helper()
	raw, _ := json.Marshal(body)
	if body == nil {
		raw = nil
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(raw))
	req.Header.Set(csrfHeader, "1")
	req.Header.Set("X-Request-Id", requestID)
	if token != "" {
		req.AddCookie(&http.Cookie{Name: sessionCookiePlain, Value: token})
	}
	rec := httptest.NewRecorder()
	e.handler.ServeHTTP(rec, req)
	return rec.Code
}

// Every state-changing route writes exactly one audit entry, for authorized and
// refused callers alike, named <action>.<outcome>.
func TestEveryWriteIsAudited(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	plain := e.user("plain", false)
	e.grant(plain.ID, "api.view")
	n := 0
	for _, rule := range authzTable {
		if rule.method == http.MethodGet || rule.method == http.MethodHead {
			continue
		}
		path := concretePath(rule.pattern)
		callers := map[string]string{"admin": e.login("root")}
		if rule.access != public {
			callers["refused"] = e.login("plain")
		}
		for who, token := range callers {
			if rule.scope == "" && rule.access != public && who == "refused" {
				continue // any signed-in user may call it; covered by the admin call
			}
			n++
			id := fmt.Sprintf("audit-%d", n)
			code := e.doWithID(rule.method, path, token, id, map[string]any{})
			entries := e.auditByRequestID(id)
			if len(entries) != 1 {
				t.Errorf("%s %s as %s (%d): %d audit entries, want 1", rule.method, rule.pattern, who, code, len(entries))
				continue
			}
			got := entries[0]
			if got.Outcome != auditOutcome(code) || !strings.HasSuffix(got.Action, "."+got.Outcome) {
				t.Errorf("%s %s as %s: status %d, entry %s / %s", rule.method, rule.pattern, who, code, got.Action, got.Outcome)
			}
			if who == "refused" && got.Outcome != "denied" {
				t.Errorf("%s %s refused caller: outcome %s (status %d)", rule.method, rule.pattern, got.Outcome, code)
			}
		}
	}
}

func TestAPIOwnerDelegation(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.user("root", true)
	owner := e.user("owner", false)
	viewer := e.user("viewer", false)
	ownerGroup, _ := e.store.CreateGroup(ctx, "payments-team", "")
	viewerGroup, _ := e.store.CreateGroup(ctx, "readers", "")
	_ = e.store.SetUserGroups(ctx, owner.ID, []int{ownerGroup})
	_ = e.store.SetUserGroups(ctx, viewer.ID, []int{viewerGroup})

	mine, _ := e.store.CreateAPIDefinition(ctx, models.APIDefinition{Name: "Payments", Slug: "pay", InternalOpenAPIURL: "http://pay/spec", InternalBaseURL: "http://pay", IsActive: true, OwnerGroupID: &ownerGroup})
	other, _ := e.store.CreateAPIDefinition(ctx, models.APIDefinition{Name: "Ledger", Slug: "ledger", InternalOpenAPIURL: "http://l/spec", InternalBaseURL: "http://l", IsActive: true})
	ownerToken := e.login("owner")

	var listed []models.APIDefinition
	_ = json.Unmarshal([]byte(e.expect(http.MethodGet, "/api/admin/apis", ownerToken, nil, http.StatusOK)), &listed)
	if len(listed) != 1 || listed[0].ID != mine {
		t.Fatalf("owner sees %+v, want only API %d", listed, mine)
	}
	update := map[string]any{"name": "Payments v2", "slug": "pay", "internalOpenapiUrl": "http://pay/spec", "internalBaseUrl": "http://pay", "isActive": true, "ownerGroupId": ownerGroup}
	e.expect(http.MethodPut, fmt.Sprintf("/api/admin/apis/%d", mine), ownerToken, update, http.StatusOK)
	e.expect(http.MethodPut, fmt.Sprintf("/api/admin/apis/%d", other), ownerToken, update, http.StatusForbidden)
	e.expect(http.MethodDelete, fmt.Sprintf("/api/admin/apis/%d", mine), ownerToken, nil, http.StatusForbidden) // manage doesn't imply delete
	e.expect(http.MethodPost, "/api/admin/apis", ownerToken, update, http.StatusForbidden)
	update["ownerGroupId"] = viewerGroup
	e.expect(http.MethodPut, fmt.Sprintf("/api/admin/apis/%d", mine), ownerToken, update, http.StatusForbidden) // owner group is api.manage's call

	// The owner grants the readers group view on their API only.
	viewerToken := e.login("viewer")
	e.expect(http.MethodGet, fmt.Sprintf("/api/apis/%d", mine), viewerToken, nil, http.StatusForbidden)
	e.expect(http.MethodPut, fmt.Sprintf("/api/admin/apis/%d/access", mine), ownerToken, []models.APIAccess{{GroupID: viewerGroup, Level: "view"}}, http.StatusOK)
	e.expect(http.MethodPut, fmt.Sprintf("/api/admin/apis/%d/access", other), ownerToken, []models.APIAccess{{GroupID: viewerGroup, Level: "view"}}, http.StatusForbidden)
	e.expect(http.MethodGet, fmt.Sprintf("/api/apis/%d", mine), viewerToken, nil, http.StatusOK)
	e.expect(http.MethodPost, fmt.Sprintf("/api/apis/%d/invoke", mine), viewerToken, map[string]string{"method": "GET", "path": "/"}, http.StatusForbidden)

	var me struct {
		Capabilities capabilities
	}
	_ = json.Unmarshal([]byte(e.expect(http.MethodGet, "/api/auth/me", ownerToken, nil, http.StatusOK)), &me)
	if strings.Join(me.Capabilities.AdminSections, ",") != "apis" || len(me.Capabilities.ManagedAPIs) != 1 || me.Capabilities.ManagedAPIs[0] != mine || me.Capabilities.ManagesAllAPIs {
		t.Fatalf("owner capabilities: %+v", me.Capabilities)
	}
	_ = json.Unmarshal([]byte(e.expect(http.MethodGet, "/api/auth/me", viewerToken, nil, http.StatusOK)), &me)
	if len(me.Capabilities.AdminSections) != 0 {
		t.Fatalf("viewer capabilities: %+v", me.Capabilities)
	}

	// Adding someone to the owner group hands out api:<id>:manage: a manager who
	// lacks it can't do that.
	userMgr := e.user("usermgr", false)
	e.grant(userMgr.ID, "user.manage")
	e.expect(http.MethodPut, fmt.Sprintf("/api/admin/users/%d/groups", viewer.ID), e.login("usermgr"), []int{viewerGroup, ownerGroup}, http.StatusForbidden)
}

func TestCreateOnlyCannotSetOwner(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.user("root", true)
	creator := e.user("creator", false)
	e.grant(creator.ID, "api.create")
	g, _ := e.store.CreateGroup(ctx, "some-team", "")
	token := e.login("creator")
	body := map[string]any{"name": "New", "slug": "new", "internalOpenapiUrl": "https://n/spec", "internalBaseUrl": "https://n", "isActive": true}
	e.expect(http.MethodPost, "/api/admin/apis", token, body, http.StatusCreated)
	body["slug"], body["ownerGroupId"] = "new2", g
	e.expect(http.MethodPost, "/api/admin/apis", token, body, http.StatusForbidden)
	body["internalBaseUrl"] = "not a url"
	delete(body, "ownerGroupId")
	e.expect(http.MethodPost, "/api/admin/apis", token, body, http.StatusBadRequest)
}

func TestUnknownScopesAreRefused(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	token := e.login("root")
	roleID, _ := e.store.CreateRole(context.Background(), "r", "")
	path := fmt.Sprintf("/api/admin/roles/%d/permissions", roleID)
	e.expect(http.MethodPost, path, token, map[string]string{"scope": "root.everything"}, http.StatusBadRequest)
	e.expect(http.MethodPut, path, token, map[string]any{"scopes": []string{"api.view", "api:x:view"}}, http.StatusBadRequest)
	e.expect(http.MethodPut, path, token, map[string]any{"scopes": []string{"API.View", "ldap.manage", "api:3:delete"}}, http.StatusOK)
	perms, _ := e.store.ListRolePermissions(context.Background(), roleID)
	var got []string
	for _, p := range perms {
		got = append(got, p.Scope)
	}
	if strings.Join(got, ",") != "api.view,idp.manage,api:3:delete" && len(got) != 3 {
		t.Fatalf("stored scopes: %v", got)
	}
	for _, s := range got {
		if s == "ldap.manage" || s == "API.View" {
			t.Fatalf("scope not normalised: %v", got)
		}
	}
}

func TestFeatureFlags(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	e.srv.config.Features.TryIt = false
	e.srv.config.Features.AuditExport = false
	e.handler = e.srv.Router()
	token := e.login("root")
	e.expect(http.MethodPost, "/api/apis/1/invoke", token, map[string]string{"method": "GET", "path": "/"}, http.StatusForbidden)
	e.expect(http.MethodGet, "/api/admin/audit-logs/export", token, nil, http.StatusForbidden)
	if !contains(e.auditActions(), "api.invoke.denied") {
		t.Fatal("refused invoke not audited")
	}
	var f struct{ TryIt, LDAP, AuditExport bool }
	_ = json.Unmarshal([]byte(e.expect(http.MethodGet, "/api/features", "", nil, http.StatusOK)), &f)
	if f.TryIt || f.AuditExport || !f.LDAP {
		t.Fatalf("features: %+v", f)
	}
}

func TestAuditFiltersAndExport(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	token := e.login("root")
	e.do(http.MethodPost, "/api/auth/login", "", map[string]string{"username": "ghost", "password": "x"})
	e.expect(http.MethodPost, "/api/admin/groups", token, map[string]string{"name": "g1"}, http.StatusCreated)

	var page struct {
		Items []models.AuditLog
		Total int
	}
	_ = json.Unmarshal([]byte(e.expect(http.MethodGet, "/api/admin/audit-logs?outcome=denied&action=auth.", token, nil, http.StatusOK)), &page)
	if page.Total != 1 || page.Items[0].User != "ghost" {
		t.Fatalf("denied auth entries: %+v", page)
	}
	_ = json.Unmarshal([]byte(e.expect(http.MethodGet, "/api/admin/audit-logs?targetType=group", token, nil, http.StatusOK)), &page)
	if page.Total != 1 || page.Items[0].Action != "group.create.success" || page.Items[0].ResourceName != "g1" {
		t.Fatalf("group entries: %+v", page)
	}
	future := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	_ = json.Unmarshal([]byte(e.expect(http.MethodGet, "/api/admin/audit-logs?from="+future, token, nil, http.StatusOK)), &page)
	if page.Total != 0 {
		t.Fatalf("from in the future returned %d", page.Total)
	}
	e.expect(http.MethodGet, "/api/admin/audit-logs?outcome=maybe", token, nil, http.StatusBadRequest)

	// Export applies the same filters and says when it was cut short.
	e.srv.config.AuditExportMaxRows = 1
	req := httptest.NewRequest(http.MethodGet, "/api/admin/audit-logs/export?action=auth.login", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookiePlain, Value: token})
	rec := httptest.NewRecorder()
	e.handler.ServeHTTP(rec, req)
	lines := strings.Split(strings.TrimSpace(rec.Body.String()), "\n")
	if rec.Code != 200 || len(lines) != 2 || rec.Header().Get("X-Audit-Export-Truncated") != "true" {
		t.Fatalf("export: %d %q truncated=%q", rec.Code, lines, rec.Header().Get("X-Audit-Export-Truncated"))
	}
	if !strings.Contains(lines[1], "auth.login.") {
		t.Fatalf("export ignored the filter: %s", lines[1])
	}
	if !contains(e.auditActions(), "audit.export.success") {
		t.Fatal("export not audited")
	}
}

func TestChangedFieldsAreAuditedWithoutValues(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.user("root", true)
	alice := e.user("alice", false)
	token := e.login("root")
	e.expect(http.MethodPut, fmt.Sprintf("/api/admin/users/%d", alice.ID), token, map[string]any{"username": "alice", "displayName": "Alice A.", "isActive": true}, http.StatusOK)
	logs, _, _ := e.store.ListAuditLogs(ctx, models.AuditFilter{ActionPrefix: "user.update"}, 5, 0)
	if len(logs) != 1 || !strings.Contains(logs[0].Changes, "displayName") || strings.Contains(logs[0].Changes, "isAdmin") {
		t.Fatalf("user update changes: %+v", logs)
	}

	id, _ := e.store.CreateAPIDefinition(ctx, models.APIDefinition{Name: "A", Slug: "a", InternalOpenAPIURL: "http://a/spec", InternalBaseURL: "http://a", IsActive: true})
	body := map[string]any{"name": "A", "slug": "a", "internalOpenapiUrl": "http://a/spec", "internalBaseUrl": "http://a", "isActive": true,
		"injectHeaders": []map[string]string{{"name": "X-Api-Key", "value": "super-secret-value"}}}
	e.expect(http.MethodPut, fmt.Sprintf("/api/admin/apis/%d", id), token, body, http.StatusOK)
	logs, _, _ = e.store.ListAuditLogs(ctx, models.AuditFilter{ActionPrefix: "api.update"}, 5, 0)
	if len(logs) != 1 || !strings.Contains(logs[0].Changes, "injectHeaders") {
		t.Fatalf("api update changes: %+v", logs)
	}
	all, _, _ := e.store.ListAuditLogs(ctx, models.AuditFilter{}, 500, 0)
	raw, _ := json.Marshal(all)
	if strings.Contains(string(raw), "super-secret-value") {
		t.Fatal("an injected header value reached the audit log")
	}
	// The value is never returned either.
	if out := e.expect(http.MethodGet, "/api/admin/apis", token, nil, http.StatusOK); strings.Contains(out, "super-secret-value") || !strings.Contains(out, `"injectHeaderNames":["X-Api-Key"]`) {
		t.Fatalf("admin api list: %s", out)
	}
}

func TestInvokeRateLimitAndInjectedHeaders(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	var gotKey, gotTenant string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey, gotTenant = r.Header.Get("X-Api-Key"), r.Header.Get("X-Tenant")
		w.WriteHeader(http.StatusTeapot)
	}))
	defer upstream.Close()
	e.user("root", true)
	token := e.login("root")
	id, _ := e.store.CreateAPIDefinition(ctx, models.APIDefinition{Name: "T", Slug: "t", InternalOpenAPIURL: upstream.URL + "/spec", InternalBaseURL: upstream.URL, IsActive: true, TryItEnabled: true,
		AllowedRequestHeaders: []string{"X-Tenant"}, RateLimitPerMinute: 2, InjectHeaders: []models.HeaderValue{{Name: "X-Api-Key", Value: "srv-key"}}})
	path := fmt.Sprintf("/api/apis/%d/invoke", id)
	call := map[string]any{"method": "GET", "path": "/x", "headers": map[string]string{"X-Tenant": "t1", "X-Api-Key": "user-key", "X-Other": "no"}}
	out := e.expect(http.MethodPost, path, token, call, http.StatusOK)
	if gotKey != "srv-key" || gotTenant != "t1" {
		t.Fatalf("upstream headers: key=%q tenant=%q", gotKey, gotTenant)
	}
	if !strings.Contains(out, `"statusCode":418`) || !strings.Contains(out, `"limitPerMinute":2`) {
		t.Fatalf("invoke response: %s", out)
	}
	e.expect(http.MethodPost, path, token, call, http.StatusOK)
	e.expect(http.MethodPost, path, token, call, http.StatusTooManyRequests)

	logs, _, _ := e.store.ListAuditLogs(ctx, models.AuditFilter{ActionPrefix: "api.invoke"}, 10, 0)
	if len(logs) != 3 || logs[0].Action != "api.invoke.denied" || logs[2].Action != "api.invoke.success" || logs[2].StatusCode != http.StatusTeapot {
		t.Fatalf("invoke audit: %+v", logs)
	}
	if strings.Contains(logs[2].SanitizedHeader, "srv-key") {
		t.Fatal("injected key value in the audit log")
	}
}

func TestDirectoryGroupSync(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	alice := e.user("alice", false)
	mapped, _ := e.store.CreateGroupWithMapping(ctx, models.Group{Name: "devs", AzureGroupID: "AAA-111"})
	manual, _ := e.store.CreateGroup(ctx, "manual", "")
	_ = e.store.SetUserGroups(ctx, alice.ID, []int{manual})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	e.srv.syncDirectoryGroups(req, alice, "azuread", []string{"aaa-111"})
	if ids, _ := e.store.GetUserGroupIDs(ctx, alice.ID); len(ids) != 2 {
		t.Fatalf("after joining: %v", ids)
	}
	e.srv.syncDirectoryGroups(req, alice, "azuread", nil)
	ids, _ := e.store.GetUserGroupIDs(ctx, alice.ID)
	if len(ids) != 1 || ids[0] != manual {
		t.Fatalf("after leaving: %v (mapped group %d, manual %d)", ids, mapped, manual)
	}
}

func TestMappingAPrivilegedGroupIsAGrant(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	mgr := e.user("groupmgr", false)
	e.grant(mgr.ID, "group.manage")
	powerRole, _ := e.store.CreateRole(ctx, "power", "")
	_ = e.store.ReplaceRolePermissions(ctx, powerRole, []string{"user.manage"})
	powerGroup, _ := e.store.CreateGroup(ctx, "power-group", "")
	_ = e.store.SetGroupRoles(ctx, powerGroup, []int{powerRole})
	token := e.login("groupmgr")
	e.expect(http.MethodPut, fmt.Sprintf("/api/admin/groups/%d", powerGroup), token, map[string]string{"name": "power-group", "azureGroupId": "my-own-group"}, http.StatusForbidden)
	e.expect(http.MethodPut, fmt.Sprintf("/api/admin/groups/%d", powerGroup), token, map[string]string{"name": "renamed"}, http.StatusOK)
}

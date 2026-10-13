package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func decode[T any](t *testing.T, body string) T {
	t.Helper()
	var out T
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatalf("decode %s: %v", body, err)
	}
	return out
}

// The admin lists carry what the tables show: groups per user, members and roles
// per group, scope counts and users per role, and the last sign-in.
func TestAdminListsCarryCounts(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	alice := e.user("alice", false)
	e.grant(alice.ID, "audit.view", "user.view")
	root := e.login("root")
	e.login("alice")

	users := decode[[]adminUser](t, e.expect(http.MethodGet, "/api/admin/users", root, nil, http.StatusOK))
	var gotAlice *adminUser
	for i := range users {
		if users[i].Username == "alice" {
			gotAlice = &users[i]
		}
	}
	if gotAlice == nil || len(gotAlice.GroupIDs) != 1 || gotAlice.LastLoginAt == nil {
		t.Fatalf("alice in the list: %+v", gotAlice)
	}
	groups := decode[[]adminGroup](t, e.expect(http.MethodGet, "/api/admin/groups", root, nil, http.StatusOK))
	if len(groups) != 1 || fmt.Sprint(groups[0].MemberIDs) != fmt.Sprint([]int{alice.ID}) || len(groups[0].RoleIDs) != 1 {
		t.Fatalf("groups: %+v", groups)
	}
	roles := decode[[]adminRole](t, e.expect(http.MethodGet, "/api/admin/roles", root, nil, http.StatusOK))
	if len(roles) != 1 || roles[0].PermissionCount != 2 || fmt.Sprint(roles[0].GroupIDs) != fmt.Sprint([]int{groups[0].ID}) {
		t.Fatalf("roles: %+v", roles)
	}
}

func TestBulkUserStatus(t *testing.T) {
	e := newEnv(t)
	root := e.user("root", true)
	other := e.user("other-admin", true)
	bob := e.user("bob", false)
	carol := e.user("carol", false)
	manager := e.user("manager", false)
	e.grant(manager.ID, "user.view", "user.manage")
	rootToken, managerToken, bobToken := e.login("root"), e.login("manager"), e.login("bob")

	// A delegated manager can't touch administrators; a batch that includes one changes nothing.
	e.expect(http.MethodPost, "/api/admin/users/bulk-status", managerToken, map[string]any{"userIds": []int{bob.ID, other.ID}, "active": false}, http.StatusForbidden)
	e.expect(http.MethodGet, "/api/auth/me", bobToken, nil, http.StatusOK)
	// Nobody deactivates themselves.
	e.expect(http.MethodPost, "/api/admin/users/bulk-status", rootToken, map[string]any{"userIds": []int{bob.ID, root.ID}, "active": false}, http.StatusConflict)
	e.expect(http.MethodPost, "/api/admin/users/bulk-status", managerToken, map[string]any{"userIds": []int{}, "active": false}, http.StatusBadRequest)
	// An administrator may deactivate another one (root stays).
	e.expect(http.MethodPost, "/api/admin/users/bulk-status", rootToken, map[string]any{"userIds": []int{other.ID}, "active": false}, http.StatusOK)

	body := e.expect(http.MethodPost, "/api/admin/users/bulk-status", managerToken, map[string]any{"userIds": []int{bob.ID, carol.ID}, "active": false}, http.StatusOK)
	out := decode[struct {
		Changed         []int `json:"changed"`
		SessionsRevoked int   `json:"sessionsRevoked"`
	}](t, body)
	if len(out.Changed) != 2 || out.SessionsRevoked != 1 {
		t.Fatalf("bulk deactivate: %s", body)
	}
	e.expect(http.MethodGet, "/api/auth/me", bobToken, nil, http.StatusUnauthorized)
	// Already inactive: reported as unchanged.
	body = e.expect(http.MethodPost, "/api/admin/users/bulk-status", managerToken, map[string]any{"userIds": []int{bob.ID}, "active": false}, http.StatusOK)
	if !strings.Contains(body, `"changed":[]`) {
		t.Fatalf("second deactivate: %s", body)
	}
	e.expect(http.MethodPost, "/api/admin/users/bulk-status", managerToken, map[string]any{"userIds": []int{bob.ID}, "active": true}, http.StatusOK)
	e.login("bob")
}

// Adding members is a grant: a delegated manager may only add users to groups whose
// permissions they hold themselves, and never administrators.
func TestGroupMembersAreGrants(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	admin2 := e.user("admin2", true)
	dave := e.user("dave", false)
	manager := e.user("manager", false)
	e.grant(manager.ID, "user.view", "user.manage")
	ctx := context.Background()
	powerful, _ := e.store.CreateGroup(ctx, "auditors", "")
	roleID, _ := e.store.CreateRole(ctx, "auditor", "")
	_ = e.store.ReplaceRolePermissions(ctx, roleID, []string{"audit.view"})
	_ = e.store.SetGroupRoles(ctx, powerful, []int{roleID})
	plain, _ := e.store.CreateGroup(ctx, "plain", "")
	m, root := e.login("manager"), e.login("root")

	e.expect(http.MethodPost, fmt.Sprintf("/api/admin/groups/%d/members", powerful), m, map[string]any{"userIds": []int{dave.ID}}, http.StatusForbidden)
	e.expect(http.MethodPost, fmt.Sprintf("/api/admin/groups/%d/members", plain), m, map[string]any{"userIds": []int{admin2.ID}}, http.StatusForbidden)
	body := e.expect(http.MethodPost, fmt.Sprintf("/api/admin/groups/%d/members", plain), m, map[string]any{"userIds": []int{dave.ID, dave.ID}}, http.StatusOK)
	if !strings.Contains(body, fmt.Sprintf(`"added":[%d]`, dave.ID)) {
		t.Fatalf("add: %s", body)
	}
	e.expect(http.MethodPost, fmt.Sprintf("/api/admin/groups/%d/members", powerful), root, map[string]any{"userIds": []int{dave.ID}}, http.StatusOK)
	if ids, _ := e.store.GetUserGroupIDs(ctx, dave.ID); len(ids) != 2 {
		t.Fatalf("dave's groups: %v", ids)
	}
	e.expect(http.MethodDelete, fmt.Sprintf("/api/admin/groups/%d/members/%d", powerful, dave.ID), m, nil, http.StatusOK)
	e.expect(http.MethodDelete, fmt.Sprintf("/api/admin/groups/%d/members/%d", powerful, dave.ID), m, nil, http.StatusNotFound)
	e.expect(http.MethodPost, "/api/admin/groups/9999/members", root, map[string]any{"userIds": []int{dave.ID}}, http.StatusNotFound)
}

func TestEffectivePermissionsExplainTheirSource(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	erin := e.user("erin", false)
	e.grant(erin.ID, "audit.view")
	ctx := context.Background()
	apiID := e.api("Ledger")
	owners, _ := e.store.CreateGroup(ctx, "ledger-owners", "")
	_, _ = e.dbConn.ExecContext(ctx, `UPDATE api_definitions SET owner_group_id = ? WHERE id = ?`, owners, apiID)
	root := e.login("root")

	type permissions struct {
		Scopes  []string `json:"scopes"`
		Sources []struct {
			Scope, Via, GroupName, RoleName string
		} `json:"sources"`
	}
	got := decode[permissions](t, e.expect(http.MethodGet, fmt.Sprintf("/api/admin/users/%d/permissions", erin.ID), root, nil, http.StatusOK))
	if fmt.Sprint(got.Scopes) != "[audit.view]" || got.Sources[0].Via != "role" || got.Sources[0].RoleName == "" {
		t.Fatalf("current: %+v", got)
	}
	// Preview with the owner group added: what saving would grant.
	current, _ := e.store.GetUserGroupIDs(ctx, erin.ID)
	path := fmt.Sprintf("/api/admin/users/%d/permissions?groupIds=%d,%d", erin.ID, current[0], owners)
	got = decode[permissions](t, e.expect(http.MethodGet, path, root, nil, http.StatusOK))
	if fmt.Sprint(got.Scopes) != fmt.Sprintf("[api:%d:manage audit.view]", apiID) || got.Sources[0].Via != "owner" {
		t.Fatalf("preview: %+v", got)
	}
	e.expect(http.MethodGet, fmt.Sprintf("/api/admin/users/%d/permissions?groupIds=x", erin.ID), root, nil, http.StatusBadRequest)
	e.expect(http.MethodGet, "/api/admin/users/9999/permissions", root, nil, http.StatusNotFound)
}

// The overview shows each block only to whoever may open the matching section, and
// spec error text only to the API's managers.
func TestAdminOverviewIsScoped(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	ctx := context.Background()
	broken := e.api("Broken")
	_ = e.store.MarkSpecRefreshFailure(ctx, broken, "dial tcp 10.9.8.7:443: refused")
	other := e.api("Other")
	_ = e.store.MarkSpecRefreshFailure(ctx, other, "dial tcp 10.1.1.1:443: refused")
	people := e.user("people", false)
	e.grant(people.ID, "user.view")
	owner := e.user("owner", false)
	e.grant(owner.ID, fmt.Sprintf("api:%d:manage", broken))

	body := e.expect(http.MethodGet, "/api/admin/overview", e.login("people"), nil, http.StatusOK)
	if !strings.Contains(body, `"users":`) || strings.Contains(body, `"apis":`) || strings.Contains(body, `"activity":`) || strings.Contains(body, "Broken") {
		t.Fatalf("user viewer overview: %s", body)
	}
	body = e.expect(http.MethodGet, "/api/admin/overview", e.login("owner"), nil, http.StatusOK)
	if !strings.Contains(body, "10.9.8.7") || strings.Contains(body, "10.1.1.1") || strings.Contains(body, "Other") || strings.Contains(body, `"users":`) {
		t.Fatalf("owner overview: %s", body)
	}
	body = e.expect(http.MethodGet, "/api/admin/overview", e.login("root"), nil, http.StatusOK)
	for _, want := range []string{`"specErrors":2`, `"activity":`, `"encryption_key_in_database"`, `"signedIn24h":3`} {
		if !strings.Contains(body, want) {
			t.Errorf("admin overview lacks %s: %s", want, body)
		}
	}
	e.user("nobody", false)
	e.expect(http.MethodGet, "/api/admin/overview", e.login("nobody"), nil, http.StatusForbidden)
}

// The preview fetches and summarizes a spec without storing anything.
func TestSpecPreview(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/spec":
			_, _ = w.Write([]byte(paymentsSpec))
		case "/yaml":
			_, _ = w.Write([]byte("swagger: '2.0'\ninfo:\n  title: Pets\n  version: 1.5\npaths:\n  /pets:\n    get: {}\n"))
		case "/not-openapi":
			_, _ = w.Write([]byte(`{"hello":"world"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer upstream.Close()
	e := newEnv(t)
	e.user("root", true)
	root := e.login("root")

	body := e.expect(http.MethodPost, "/api/admin/apis/spec-preview", root, map[string]string{"url": upstream.URL + "/spec"}, http.StatusOK)
	for _, want := range []string{`"operationCount":5`, `"title":"Payments"`, `"version":"2.3.1"`, `"tagCount":1`, `"format":"json"`} {
		if !strings.Contains(body, want) {
			t.Errorf("preview lacks %s: %s", want, body)
		}
	}
	body = e.expect(http.MethodPost, "/api/admin/apis/spec-preview", root, map[string]string{"url": upstream.URL + "/yaml"}, http.StatusOK)
	if !strings.Contains(body, `"format":"yaml"`) || !strings.Contains(body, `"version":"1.5"`) || !strings.Contains(body, `"openapi":"2.0"`) {
		t.Errorf("yaml preview: %s", body)
	}
	e.expect(http.MethodPost, "/api/admin/apis/spec-preview", root, map[string]string{"url": upstream.URL + "/not-openapi"}, http.StatusUnprocessableEntity)
	e.expect(http.MethodPost, "/api/admin/apis/spec-preview", root, map[string]string{"url": upstream.URL + "/missing"}, http.StatusBadGateway)
	e.expect(http.MethodPost, "/api/admin/apis/spec-preview", root, map[string]string{"url": "file:///etc/passwd"}, http.StatusBadRequest)
	if apis, _ := e.store.ListAPIDefinitions(context.Background()); len(apis) != 0 {
		t.Fatalf("preview stored %d APIs", len(apis))
	}
}

func TestAPIImpactAndSystemInfo(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	ctx := context.Background()
	id := e.api("Ledger")
	viewers, _ := e.store.CreateGroup(ctx, "viewers", "")
	_, _ = e.dbConn.ExecContext(ctx, `INSERT INTO api_access (api_id, group_id, level) VALUES (?, ?, 'view')`, id, viewers)
	roleID, _ := e.store.CreateRole(ctx, "ledger", "")
	_ = e.store.ReplaceRolePermissions(ctx, roleID, []string{fmt.Sprintf("api:%d:invoke", id), "audit.view"})
	root := e.login("root")
	e.expect(http.MethodPut, fmt.Sprintf("/api/me/favorites/%d", id), root, nil, http.StatusOK)

	body := e.expect(http.MethodGet, fmt.Sprintf("/api/admin/apis/%d/impact", id), root, nil, http.StatusOK)
	if !strings.Contains(body, `"accessGrants":1`) || !strings.Contains(body, `"roleScopes":1`) || !strings.Contains(body, `"favorites":1`) {
		t.Fatalf("impact: %s", body)
	}
	e.expect(http.MethodGet, "/api/admin/apis/9999/impact", root, nil, http.StatusNotFound)

	body = e.expect(http.MethodGet, "/api/admin/system/info", root, nil, http.StatusOK)
	info := decode[map[string]any](t, body)
	if info["encryptionKeySource"] != "database" || info["version"] != "dev" || info["schemaVersion"] != float64(11) || info["databaseBytes"].(float64) <= 0 {
		t.Fatalf("system info: %s", body)
	}
}

func TestSessionsFilterByUser(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	frank := e.user("frank", false)
	e.login("frank")
	e.login("frank")
	root := e.login("root")
	body := e.expect(http.MethodGet, fmt.Sprintf("/api/admin/sessions?userId=%d", frank.ID), root, nil, http.StatusOK)
	if strings.Count(body, `"userId":`) != 2 || strings.Contains(body, `"username":"root"`) {
		t.Fatalf("frank's sessions: %s", body)
	}
	if body := e.expect(http.MethodGet, "/api/admin/sessions", root, nil, http.StatusOK); strings.Count(body, `"userId":`) != 3 {
		t.Fatalf("all sessions: %s", body)
	}
}

func TestCanManageUsersCapability(t *testing.T) {
	e := newEnv(t)
	viewer := e.user("viewer", false)
	e.grant(viewer.ID, "user.view")
	manager := e.user("manager", false)
	e.grant(manager.ID, "user.view", "user.manage")
	type me struct {
		Capabilities capabilities `json:"capabilities"`
	}
	if got := decode[me](t, e.expect(http.MethodGet, "/api/auth/me", e.login("viewer"), nil, http.StatusOK)); got.Capabilities.CanManageUsers {
		t.Error("user.view alone reports canManageUsers")
	}
	if got := decode[me](t, e.expect(http.MethodGet, "/api/auth/me", e.login("manager"), nil, http.StatusOK)); !got.Capabilities.CanManageUsers {
		t.Error("user.manage does not report canManageUsers")
	}
}

// A group's permissions come from its roles, the APIs it owns and API access lists;
// the last two are not part of any role, and this endpoint shows all three.
func TestGroupPermissionsShowEverySource(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	ctx := context.Background()
	apiID := e.api("Ledger")
	owned := e.api("Billing")
	group, _ := e.store.CreateGroup(ctx, "finance", "")
	roleID, _ := e.store.CreateRole(ctx, "auditor", "")
	_ = e.store.ReplaceRolePermissions(ctx, roleID, []string{"audit.view"})
	_ = e.store.SetGroupRoles(ctx, group, []int{roleID})
	_, _ = e.dbConn.ExecContext(ctx, `INSERT INTO api_access (api_id, group_id, level) VALUES (?, ?, 'invoke')`, apiID, group)
	_, _ = e.dbConn.ExecContext(ctx, `UPDATE api_definitions SET owner_group_id = ? WHERE id = ?`, group, owned)
	root := e.login("root")

	body := e.expect(http.MethodGet, fmt.Sprintf("/api/admin/groups/%d/permissions", group), root, nil, http.StatusOK)
	for _, want := range []string{
		`"scope":"audit.view","via":"role"`,
		fmt.Sprintf(`"scope":"api:%d:invoke","via":"access"`, apiID),
		fmt.Sprintf(`"scope":"api:%d:manage","via":"owner"`, owned),
	} {
		if !strings.Contains(body, want) {
			t.Errorf("missing %s in %s", want, body)
		}
	}
	e.expect(http.MethodGet, "/api/admin/groups/9999/permissions", root, nil, http.StatusNotFound)
}

// The sign-in page learns whether to show the project link, but not the version;
// signed-in users get both from /api/auth/me.
func TestVersionOnlyForSignedInUsers(t *testing.T) {
	e := newEnv(t)
	e.srv.config.Version = "9.9.9"
	e.srv.config.ShowProjectLink = true
	body := e.expect(http.MethodGet, "/api/system/public", "", nil, http.StatusOK)
	if strings.Contains(body, "9.9.9") || !strings.Contains(body, `"projectLink":true`) {
		t.Fatalf("public settings: %s", body)
	}
	e.user("viewer", false)
	body = e.expect(http.MethodGet, "/api/auth/me", e.login("viewer"), nil, http.StatusOK)
	if !strings.Contains(body, `"version":"9.9.9"`) || !strings.Contains(body, `"projectLink":true`) {
		t.Fatalf("me: %s", body)
	}
	e.srv.config.ShowProjectLink = false
	if body := e.expect(http.MethodGet, "/api/system/public", "", nil, http.StatusOK); !strings.Contains(body, `"projectLink":false`) {
		t.Fatalf("SHOW_PROJECT_LINK=false: %s", body)
	}
}

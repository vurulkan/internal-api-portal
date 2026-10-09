package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"api-portal/backend/internal/audit"
	"api-portal/backend/internal/auth"
	"api-portal/backend/internal/config"
	"api-portal/backend/internal/db"
	"api-portal/backend/internal/models"
	"api-portal/backend/internal/store"
)

// ─── Test environment: real router, real SQLite in a temp dir ────────────────

type testEnv struct {
	t       *testing.T
	srv     *Server
	handler http.Handler
	store   *store.Store
	dbConn  *sql.DB
	seq     int
}

const testPassword = "correct-horse-1"

func newEnv(t *testing.T) *testEnv {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatalf("db open: %v", err)
	}
	t.Cleanup(func() { database.Conn.Close() })
	st, err := store.New(database.Conn, store.Keys{})
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	cfg := config.Config{
		TimeZone:           "UTC",
		SessionMinutes:     60,
		ProxyTimeout:       5 * time.Second,
		MaxRequestBytes:    1 << 20,
		MaxResponseBytes:   1 << 20,
		CookieSecure:       "auto",
		ProxyAllowLoopback: true,
		MetricsEnabled:     true,
		PasswordMinLength:  12,
	}
	srv := NewServer(st, audit.New(st), cfg)
	return &testEnv{t: t, srv: srv, handler: srv.Router(), store: st, dbConn: database.Conn}
}

// user creates a local account with testPassword.
func (e *testEnv) user(username string, admin bool) *models.User {
	e.t.Helper()
	hash, err := auth.HashPassword(testPassword)
	if err != nil {
		e.t.Fatal(err)
	}
	id, err := e.store.CreateUser(context.Background(), models.User{Username: username, PasswordHash: hash, AuthSource: "local", IsActive: true, IsAdmin: admin})
	if err != nil {
		e.t.Fatalf("create user %s: %v", username, err)
	}
	u, _ := e.store.GetUserByID(context.Background(), id)
	return u
}

// grant gives the user the scopes through a fresh role + group.
func (e *testEnv) grant(userID int, scopes ...string) {
	e.t.Helper()
	ctx := context.Background()
	e.seq++
	roleID, err := e.store.CreateRole(ctx, fmt.Sprintf("role-%d", e.seq), "")
	if err != nil {
		e.t.Fatal(err)
	}
	if err := e.store.ReplaceRolePermissions(ctx, roleID, scopes); err != nil {
		e.t.Fatal(err)
	}
	groupID, err := e.store.CreateGroup(ctx, fmt.Sprintf("group-%d", e.seq), "")
	if err != nil {
		e.t.Fatal(err)
	}
	if err := e.store.SetGroupRoles(ctx, groupID, []int{roleID}); err != nil {
		e.t.Fatal(err)
	}
	current, _ := e.store.GetUserGroupIDs(ctx, userID)
	if err := e.store.SetUserGroups(ctx, userID, append(current, groupID)); err != nil {
		e.t.Fatal(err)
	}
}

func (e *testEnv) do(method, path, token string, body any) (int, string) {
	e.t.Helper()
	var reader *bytes.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	// What the SPA sends on every request.
	req.Header.Set(csrfHeader, "1")
	if token != "" {
		req.AddCookie(&http.Cookie{Name: sessionCookiePlain, Value: token})
	}
	rec := httptest.NewRecorder()
	e.handler.ServeHTTP(rec, req)
	return rec.Code, rec.Body.String()
}

func (e *testEnv) expect(method, path, token string, body any, want int) string {
	e.t.Helper()
	code, out := e.do(method, path, token, body)
	if code != want {
		e.t.Fatalf("%s %s = %d (%s), want %d", method, path, code, strings.TrimSpace(out), want)
	}
	return out
}

// login signs in and returns the session cookie value, which do() sends back.
func (e *testEnv) login(username string) string {
	e.t.Helper()
	return e.loginWith(username, testPassword)
}

func (e *testEnv) loginWith(username, pw string) string {
	e.t.Helper()
	raw, _ := json.Marshal(map[string]string{"username": username, "password": pw})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(raw))
	req.Header.Set(csrfHeader, "1")
	rec := httptest.NewRecorder()
	e.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		e.t.Fatalf("login %s = %d (%s)", username, rec.Code, rec.Body.String())
	}
	for _, c := range rec.Result().Cookies() {
		if c.Name == sessionCookiePlain && c.Value != "" {
			if !c.HttpOnly || c.SameSite != http.SameSiteStrictMode {
				e.t.Fatalf("session cookie flags: HttpOnly=%v SameSite=%v", c.HttpOnly, c.SameSite)
			}
			return c.Value
		}
	}
	e.t.Fatalf("login %s: no session cookie", username)
	return ""
}

func (e *testEnv) auditActions() []string {
	logs, _, _ := e.store.ListAuditLogs(context.Background(), 500, 0, "", "")
	var out []string
	for _, l := range logs {
		out = append(out, l.Action)
	}
	return out
}

func contains(values []string, want string) bool {
	for _, v := range values {
		if v == want {
			return true
		}
	}
	return false
}

// ─── Sessions ────────────────────────────────────────────────────────────────

func TestDeactivatedUserTokenStopsWorking(t *testing.T) {
	e := newEnv(t)
	alice := e.user("alice", false)
	token := e.login("alice")
	e.expect(http.MethodGet, "/api/catalog", token, nil, http.StatusOK)

	alice.IsActive = false
	if err := e.store.UpdateUser(context.Background(), *alice); err != nil {
		t.Fatal(err)
	}
	e.expect(http.MethodGet, "/api/catalog", token, nil, http.StatusUnauthorized)
	e.expect(http.MethodGet, "/api/auth/me", token, nil, http.StatusUnauthorized)
}

func TestMustChangePasswordBlocksEverythingElse(t *testing.T) {
	e := newEnv(t)
	hash, _ := auth.HashPassword(testPassword)
	if _, err := e.store.EnsureBootstrapAdmin(context.Background(), "admin", hash, 60); err != nil {
		t.Fatal(err)
	}
	token := e.login("admin")
	e.expect(http.MethodGet, "/api/auth/me", token, nil, http.StatusOK)
	for _, path := range []string{"/api/catalog", "/api/apis/1", "/api/admin/users"} {
		e.expect(http.MethodGet, path, token, nil, http.StatusForbidden)
	}
	e.expect(http.MethodPost, "/api/apis/1/invoke", token, map[string]string{"method": "GET", "path": "/"}, http.StatusForbidden)

	e.expect(http.MethodPost, "/api/auth/change-password", token, map[string]string{"currentPassword": testPassword, "newPassword": "short"}, http.StatusBadRequest)
	e.expect(http.MethodPost, "/api/auth/change-password", token, map[string]string{"currentPassword": "wrong-password", "newPassword": "a-new-password-1"}, http.StatusBadRequest)
	e.expect(http.MethodPost, "/api/auth/change-password", token, map[string]string{"currentPassword": testPassword, "newPassword": "a-new-password-1"}, http.StatusOK)
	e.expect(http.MethodGet, "/api/catalog", token, nil, http.StatusOK)
}

func TestLoginLockout(t *testing.T) {
	e := newEnv(t)
	e.user("bob", false)
	for i := 0; i < loginMaxFailures; i++ {
		e.expect(http.MethodPost, "/api/auth/login", "", map[string]string{"username": "bob", "password": "nope"}, http.StatusUnauthorized)
	}
	// Locked now, even with the right password.
	e.expect(http.MethodPost, "/api/auth/login", "", map[string]string{"username": "bob", "password": testPassword}, http.StatusTooManyRequests)
	if !contains(e.auditActions(), "login.locked") {
		t.Fatal("no login.locked audit entry")
	}
	// Other users from the same address are unaffected.
	e.user("carol", false)
	e.login("carol")
}

func TestUnknownUserAndAzureAccountsCannotUsePasswordLogin(t *testing.T) {
	e := newEnv(t)
	e.expect(http.MethodPost, "/api/auth/login", "", map[string]string{"username": "ghost", "password": "whatever"}, http.StatusUnauthorized)
	if _, err := e.store.CreateUser(context.Background(), models.User{Username: "azure-ann", AuthSource: "azuread", IsActive: true}); err != nil {
		t.Fatal(err)
	}
	e.expect(http.MethodPost, "/api/auth/login", "", map[string]string{"username": "azure-ann", "password": ""}, http.StatusUnauthorized)
}

// ─── Delegated administration ────────────────────────────────────────────────

func TestUserManagerCannotEscalate(t *testing.T) {
	e := newEnv(t)
	root := e.user("root", true)
	manager := e.user("manager", false)
	e.grant(manager.ID, "user.manage")
	token := e.login("manager")

	e.expect(http.MethodPost, "/api/admin/users", token, map[string]any{"username": "evil", "password": "long-enough-1", "isAdmin": true}, http.StatusForbidden)
	e.expect(http.MethodPost, "/api/admin/users", token, map[string]any{"username": "dave", "password": "long-enough-1"}, http.StatusCreated)

	rootPath := fmt.Sprintf("/api/admin/users/%d", root.ID)
	e.expect(http.MethodPut, rootPath, token, map[string]any{"username": "root", "isAdmin": true, "isActive": false}, http.StatusForbidden)
	e.expect(http.MethodDelete, rootPath, token, nil, http.StatusForbidden)
	e.expect(http.MethodPut, rootPath+"/groups", token, []int{}, http.StatusForbidden)

	self := fmt.Sprintf("/api/admin/users/%d", manager.ID)
	e.expect(http.MethodPut, self, token, map[string]any{"username": "manager", "isAdmin": true, "isActive": true}, http.StatusForbidden)

	// Settings that change how everyone signs in are admin-only now.
	for _, path := range []string{"/api/admin/azure-ad", "/api/admin/session", "/api/admin/system"} {
		e.expect(http.MethodGet, path, token, nil, http.StatusForbidden)
	}
	if !contains(e.auditActions(), "authz.denied") {
		t.Fatal("denials are not audited")
	}
}

func TestDelegatedManagersGrantOnlyWhatTheyHold(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.user("root", true)
	manager := e.user("rolemgr", false)
	e.grant(manager.ID, "role.manage", "group.manage", "user.manage", "api.view")
	token := e.login("rolemgr")

	roleID, _ := e.store.CreateRole(ctx, "target-role", "")
	rolePath := fmt.Sprintf("/api/admin/roles/%d/permissions", roleID)
	e.expect(http.MethodPost, rolePath, token, map[string]string{"scope": "audit.view"}, http.StatusForbidden)
	e.expect(http.MethodPost, rolePath, token, map[string]string{"scope": "api.view"}, http.StatusCreated)
	e.expect(http.MethodPut, rolePath, token, map[string]any{"scopes": []string{"api.view", "api.manage"}}, http.StatusForbidden)
	e.expect(http.MethodPut, rolePath, token, map[string]any{"scopes": []string{"api.view"}}, http.StatusOK)

	// A group carrying a scope the manager lacks can't be attached to anyone.
	powerRole, _ := e.store.CreateRole(ctx, "power", "")
	_ = e.store.ReplaceRolePermissions(ctx, powerRole, []string{"ldap.manage"})
	powerGroup, _ := e.store.CreateGroup(ctx, "power-group", "")
	_ = e.store.SetGroupRoles(ctx, powerGroup, []int{powerRole})
	e.expect(http.MethodPut, fmt.Sprintf("/api/admin/users/%d/groups", manager.ID), token, []int{powerGroup}, http.StatusForbidden)

	emptyGroup, _ := e.store.CreateGroup(ctx, "empty-group", "")
	e.expect(http.MethodPut, fmt.Sprintf("/api/admin/groups/%d/roles", emptyGroup), token, []int{powerRole}, http.StatusForbidden)
	e.expect(http.MethodPut, fmt.Sprintf("/api/admin/groups/%d/roles", emptyGroup), token, []int{roleID}, http.StatusOK)
}

func TestLastAdminAndSelfProtection(t *testing.T) {
	e := newEnv(t)
	root := e.user("root", true)
	token := e.login("root")
	path := fmt.Sprintf("/api/admin/users/%d", root.ID)

	e.expect(http.MethodPut, path, token, map[string]any{"username": "root", "isAdmin": true, "isActive": false}, http.StatusConflict)
	e.expect(http.MethodPut, path, token, map[string]any{"username": "root", "isAdmin": false, "isActive": true}, http.StatusConflict)
	e.expect(http.MethodDelete, path, token, nil, http.StatusConflict)

	other := e.user("other-admin", true)
	otherPath := fmt.Sprintf("/api/admin/users/%d", other.ID)
	e.expect(http.MethodPut, otherPath, token, map[string]any{"username": "other-admin", "isAdmin": false, "isActive": true}, http.StatusOK)
	// root is the last active admin again; it still can't remove itself.
	e.expect(http.MethodDelete, path, token, nil, http.StatusConflict)
}

func TestUpdateUserKeepsAuthSource(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	token := e.login("root")
	id, _ := e.store.CreateUser(context.Background(), models.User{Username: "ldap-larry", AuthSource: "ldap", IsActive: true})
	path := fmt.Sprintf("/api/admin/users/%d", id)
	e.expect(http.MethodPut, path, token, map[string]any{"username": "ldap-larry", "authSource": "local", "isActive": true}, http.StatusOK)
	e.expect(http.MethodPut, path, token, map[string]any{"username": "ldap-larry", "isActive": true, "password": "takeover-pass-1"}, http.StatusBadRequest)
	u, _ := e.store.GetUserByID(context.Background(), id)
	if u.AuthSource != "ldap" {
		t.Fatalf("auth source changed to %q", u.AuthSource)
	}
}

// ─── Azure AD account matching ───────────────────────────────────────────────

func TestAzureLoginNeverLinksToLocalAccounts(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	hash, _ := auth.HashPassword(testPassword)
	adminID, _ := e.store.CreateUser(ctx, models.User{Username: "boss", Email: "boss@example.com", PasswordHash: hash, AuthSource: "local", IsActive: true, IsAdmin: true})

	attacker := &auth.AzureADUser{ExternalID: "tenant:oid-1", Email: "boss@example.com", Username: "boss"}
	u, err := e.srv.userForAzureLogin(ctx, attacker)
	if err != nil {
		t.Fatal(err)
	}
	if u.ID == adminID || u.IsAdmin || u.AuthSource != "azuread" {
		t.Fatalf("azure login was linked to the local admin: %+v", u)
	}
	again, _ := e.srv.userForAzureLogin(ctx, attacker)
	if again.ID != u.ID {
		t.Fatalf("second login got a different account (%d vs %d)", again.ID, u.ID)
	}
}

func TestAzureLoginBindsLegacyAzureAccountOnce(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	legacyID, _ := e.store.CreateUser(ctx, models.User{Username: "ann", Email: "ann@example.com", AuthSource: "azuread", IsActive: true})

	u, err := e.srv.userForAzureLogin(ctx, &auth.AzureADUser{ExternalID: "tenant:oid-ann", Email: "ann@example.com", Username: "ann@example.com"})
	if err != nil || u.ID != legacyID {
		t.Fatalf("legacy account not bound: %+v, %v", u, err)
	}
	// Another Azure identity with the same e-mail must not take the bound account.
	other, _ := e.srv.userForAzureLogin(ctx, &auth.AzureADUser{ExternalID: "tenant:oid-other", Email: "ann@example.com", Username: "ann@example.com"})
	if other.ID == legacyID {
		t.Fatal("a second Azure identity took over the bound account")
	}
}

// ─── Misc hardening ──────────────────────────────────────────────────────────

func TestUnknownAPIPathIs404(t *testing.T) {
	e := newEnv(t)
	e.expect(http.MethodGet, "/api/does-not-exist", "", nil, http.StatusNotFound)
	e.expect(http.MethodDelete, "/api/auth/login", "", nil, http.StatusMethodNotAllowed)
}

func TestAuditListClampsLimit(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	token := e.login("root")
	out := e.expect(http.MethodGet, "/api/admin/audit-logs?limit=-1&offset=-5", token, nil, http.StatusOK)
	var resp struct{ Limit, Offset int }
	_ = json.Unmarshal([]byte(out), &resp)
	if resp.Limit != 1 || resp.Offset != 0 {
		t.Fatalf("limit/offset = %d/%d, want 1/0", resp.Limit, resp.Offset)
	}
}

func TestAuditExportNeutralisesFormulas(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	token := e.login("root")
	e.do(http.MethodPost, "/api/auth/login", "", map[string]string{"username": "=HYPERLINK(\"http://x\")", "password": "x"})
	out := e.expect(http.MethodGet, "/api/admin/audit-logs/export", token, nil, http.StatusOK)
	if strings.Contains(out, "\n=HYPERLINK") || strings.Contains(out, ",=HYPERLINK") {
		t.Fatalf("formula reached the CSV unescaped:\n%s", out)
	}
	if !strings.Contains(out, "'=HYPERLINK") {
		t.Fatalf("expected the quoted formula in the CSV:\n%s", out)
	}
}

func TestSystemUpdateIgnoresLogoPayload(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	token := e.login("root")
	e.expect(http.MethodPut, "/api/admin/system", token, map[string]string{"brandTitle": "Portal", "logoDataUrl": "data:image/svg+xml;base64,PHN2Zy8+"}, http.StatusOK)
	settings, _ := e.store.GetSystemSettings(context.Background())
	if settings.LogoDataURL != "" || settings.BrandTitle != "Portal" {
		t.Fatalf("settings = %+v", settings)
	}
}

func TestClientIPTrustsOnlyConfiguredProxies(t *testing.T) {
	e := newEnv(t)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "203.0.113.9:4000"
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	if got := e.srv.clientIP(req); got != "203.0.113.9" {
		t.Fatalf("untrusted peer: clientIP = %s", got)
	}
	e.srv.config.TrustedProxies = config.ParseCIDRs("10.0.0.0/8", nil)
	req.RemoteAddr = "10.1.2.3:4000"
	req.Header.Set("X-Forwarded-For", "6.6.6.6, 198.51.100.7, 10.0.0.9")
	if got := e.srv.clientIP(req); got != "198.51.100.7" {
		t.Fatalf("trusted chain: clientIP = %s, want the right-most untrusted hop", got)
	}
}

func TestSpecFetchFailureDoesNotCacheEmptySpec(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	id, err := e.store.CreateAPIDefinition(ctx, models.APIDefinition{Name: "a", Slug: "a", InternalOpenAPIURL: "http://127.0.0.1:1/spec", InternalBaseURL: "http://127.0.0.1:1", IsActive: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.store.MarkSpecRefreshFailure(ctx, id, "boom"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.store.GetSpecCache(ctx, id); err == nil {
		t.Fatal("a failed fetch created a cache row")
	}
}

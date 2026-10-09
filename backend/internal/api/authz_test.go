package api

import (
	"net/http"
	"sort"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

// access is who may reach a route.
type access string

const (
	public    access = "public"    // no token needed
	signedIn  access = "signed-in" // any active user; the handler may still refuse per API
	adminOnly access = "admin"     // isAdmin only
)

// routeRule is one row of the authorization table. scope is the permission a
// non-admin needs ("" when access decides alone).
type routeRule struct {
	method, pattern string
	access          access
	scope           string
}

// authzTable lists every route the router serves. TestEveryRouteIsInTheAuthzTable
// fails when a route is added without a row here, so a new endpoint can't ship
// without its access rule being stated and tested.
var authzTable = []routeRule{
	{"GET", "/healthz", public, ""},
	{"GET", "/livez", public, ""},
	{"GET", "/readyz", public, ""},
	{"GET", "/metrics", public, ""},
	{"POST", "/api/auth/login", public, ""},
	{"GET", "/api/auth/providers", public, ""},
	{"GET", "/api/auth/azure/start", public, ""},
	{"GET", "/api/auth/azure/callback", public, ""},
	{"GET", "/api/system/public", public, ""},

	{"GET", "/api/auth/me", signedIn, ""},
	{"POST", "/api/auth/change-password", signedIn, ""},
	{"POST", "/api/auth/logout", signedIn, ""},
	{"GET", "/api/auth/sessions", signedIn, ""},
	{"DELETE", "/api/auth/sessions/{id}", signedIn, ""},
	{"POST", "/api/auth/sessions/revoke-others", signedIn, ""},
	{"GET", "/api/catalog", signedIn, ""},
	{"GET", "/api/apis/{id}", signedIn, ""},
	{"GET", "/api/apis/{id}/spec", signedIn, ""},
	{"POST", "/api/apis/{id}/invoke", signedIn, ""},

	{"GET", "/api/admin/users", signedIn, "user.manage"},
	{"POST", "/api/admin/users", signedIn, "user.manage"},
	{"PUT", "/api/admin/users/{id}", signedIn, "user.manage"},
	{"DELETE", "/api/admin/users/{id}", signedIn, "user.manage"},
	{"GET", "/api/admin/users/{id}/groups", signedIn, "user.manage"},
	{"PUT", "/api/admin/users/{id}/groups", signedIn, "user.manage"},
	{"POST", "/api/admin/users/{id}/reset-password", signedIn, "user.manage"},
	{"POST", "/api/admin/users/{id}/revoke-sessions", signedIn, "user.manage"},
	{"GET", "/api/admin/sessions", adminOnly, ""},
	{"DELETE", "/api/admin/sessions/{id}", adminOnly, ""},

	{"GET", "/api/admin/groups", signedIn, "group.manage"},
	{"POST", "/api/admin/groups", signedIn, "group.manage"},
	{"PUT", "/api/admin/groups/{id}", signedIn, "group.manage"},
	{"DELETE", "/api/admin/groups/{id}", signedIn, "group.manage"},
	{"GET", "/api/admin/groups/{id}/roles", signedIn, "group.manage"},
	{"PUT", "/api/admin/groups/{id}/roles", signedIn, "group.manage"},

	{"GET", "/api/admin/roles", signedIn, "role.manage"},
	{"POST", "/api/admin/roles", signedIn, "role.manage"},
	{"PUT", "/api/admin/roles/{id}", signedIn, "role.manage"},
	{"DELETE", "/api/admin/roles/{id}", signedIn, "role.manage"},
	{"GET", "/api/admin/roles/{id}/permissions", signedIn, "role.manage"},
	{"POST", "/api/admin/roles/{id}/permissions", signedIn, "role.manage"},
	{"PUT", "/api/admin/roles/{id}/permissions", signedIn, "role.manage"},
	{"DELETE", "/api/admin/permissions/{id}", signedIn, "role.manage"},

	{"GET", "/api/admin/ldap", signedIn, "ldap.manage"},
	{"PUT", "/api/admin/ldap", signedIn, "ldap.manage"},
	{"POST", "/api/admin/ldap/test", signedIn, "ldap.manage"},
	{"POST", "/api/admin/ldap/test-login", signedIn, "ldap.manage"},
	{"POST", "/api/admin/ldap/search", signedIn, "ldap.manage"},
	{"POST", "/api/admin/ldap/import", signedIn, "ldap.manage"},

	{"GET", "/api/admin/apis", signedIn, "api.manage"},
	{"POST", "/api/admin/apis", signedIn, "api.manage"},
	{"PUT", "/api/admin/apis/{id}", signedIn, "api.manage"},
	{"DELETE", "/api/admin/apis/{id}", signedIn, "api.manage"},
	{"POST", "/api/admin/apis/{id}/refresh", signedIn, "api.manage"},

	{"GET", "/api/admin/audit-logs", signedIn, "audit.view"},
	{"GET", "/api/admin/audit-logs/export", signedIn, "audit.view"},

	{"GET", "/api/admin/azure-ad", adminOnly, ""},
	{"PUT", "/api/admin/azure-ad", adminOnly, ""},
	{"POST", "/api/admin/azure-ad/test", adminOnly, ""},
	{"GET", "/api/admin/session", adminOnly, ""},
	{"PUT", "/api/admin/session", adminOnly, ""},
	{"GET", "/api/admin/system", adminOnly, ""},
	{"PUT", "/api/admin/system", adminOnly, ""},
	{"POST", "/api/admin/system/logo", adminOnly, ""},
	{"DELETE", "/api/admin/system/logo", adminOnly, ""},
}

func concretePath(pattern string) string {
	return strings.ReplaceAll(pattern, "{id}", "999")
}

func TestEveryRouteIsInTheAuthzTable(t *testing.T) {
	e := newEnv(t)
	routes, ok := e.handler.(chi.Routes)
	if !ok {
		t.Fatal("router is not a chi.Routes")
	}
	known := map[string]bool{}
	for _, rule := range authzTable {
		known[rule.method+" "+rule.pattern] = true
	}
	served := map[string]bool{}
	_ = chi.Walk(routes, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		served[method+" "+route] = true
		return nil
	})
	var missing, stale []string
	for route := range served {
		if !known[route] {
			missing = append(missing, route)
		}
	}
	for route := range known {
		if !served[route] {
			stale = append(stale, route)
		}
	}
	sort.Strings(missing)
	sort.Strings(stale)
	if len(missing) > 0 {
		t.Errorf("routes without an authz rule (add them to authzTable): %v", missing)
	}
	if len(stale) > 0 {
		t.Errorf("authzTable rows for routes that no longer exist: %v", stale)
	}
}

func TestAuthzMatrix(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	plain := e.user("plain", false)
	e.grant(plain.ID, "api.view")
	manager := e.user("manager", false)
	e.grant(manager.ID, "user.manage", "group.manage", "role.manage", "ldap.manage", "api.manage", "audit.view")

	rootToken := e.login("root")
	plainToken := e.login("plain")
	managerToken := e.login("manager")

	allowed := func(code int) bool { return code != http.StatusUnauthorized && code != http.StatusForbidden }

	for _, rule := range authzTable {
		path := concretePath(rule.pattern)
		name := rule.method + " " + rule.pattern
		if rule.pattern == "/api/auth/azure/start" || rule.pattern == "/api/auth/azure/callback" {
			continue // need an identity provider; covered by the Azure tests
		}
		t.Run(name, func(t *testing.T) {
			rootToken, plainToken, managerToken := rootToken, plainToken, managerToken
			if rule.pattern == "/api/auth/logout" {
				// Logging out ends the session; don't spend the shared ones.
				rootToken, plainToken, managerToken = e.login("root"), e.login("plain"), e.login("manager")
			}
			if rule.access == public {
				if code, body := e.do(rule.method, path, "", nil); code == http.StatusUnauthorized {
					t.Fatalf("public route answered 401: %s", body)
				}
				return
			}
			if code, _ := e.do(rule.method, path, "", nil); code != http.StatusUnauthorized {
				t.Fatalf("anonymous: %d, want 401", code)
			}
			if code, _ := e.do(rule.method, path, "not-a-token", nil); code != http.StatusUnauthorized {
				t.Fatalf("bad token: %d, want 401", code)
			}
			switch {
			case rule.access == adminOnly:
				if code, _ := e.do(rule.method, path, managerToken, nil); code != http.StatusForbidden {
					t.Fatalf("manager on admin-only route: %d, want 403", code)
				}
			case rule.scope != "":
				if code, _ := e.do(rule.method, path, plainToken, nil); code != http.StatusForbidden {
					t.Fatalf("user without %s: %d, want 403", rule.scope, code)
				}
				if code, body := e.do(rule.method, path, managerToken, nil); !allowed(code) {
					t.Fatalf("user with %s: %d (%s)", rule.scope, code, body)
				}
			}
			if code, body := e.do(rule.method, path, rootToken, nil); !allowed(code) {
				t.Fatalf("admin: %d (%s)", code, body)
			}
		})
	}
}

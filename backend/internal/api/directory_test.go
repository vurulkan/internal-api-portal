package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"api-portal/backend/internal/auth/ldaptest"
	"api-portal/backend/internal/models"
)

// withDirectory points the portal at an in-process LDAP server with three people.
func withDirectory(t *testing.T, e *testEnv, mutate func(*models.LDAPConfig)) *ldaptest.Server {
	t.Helper()
	srv := ldaptest.Start(t,
		ldaptest.Entry{DN: "cn=svc,dc=corp", Password: "svc-pw"},
		ldaptest.Entry{DN: "uid=Bob,ou=people,dc=corp", Password: "bob-pw", Attrs: map[string][]string{
			"uid": {"Bob"}, "displayName": {"Bob Builder"}, "mail": {"bob@corp.example"},
			"memberOf": {"cn=api-readers,ou=groups,dc=corp"},
		}},
		ldaptest.Entry{DN: "uid=carol,ou=people,dc=corp", Password: "carol-pw", Attrs: map[string][]string{
			"uid": {"carol"}, "displayName": {"Carol"}, "mail": {"carol@corp.example"},
		}},
		ldaptest.Entry{DN: "uid=root,ou=people,dc=corp", Password: "dir-root-pw", Attrs: map[string][]string{"uid": {"root"}}},
	)
	cfg := models.LDAPConfig{
		Enabled: true, Host: "127.0.0.1", Port: srv.Port, TimeoutSeconds: 5,
		BindDN: "cn=svc,dc=corp", BindPassword: "svc-pw", UserBaseDN: "dc=corp",
		UsernameAttribute: "uid", DisplayNameAttr: "displayName", EmailAttr: "mail", UserFilter: "(objectClass=person)",
	}
	if mutate != nil {
		mutate(&cfg)
	}
	if err := e.store.UpdateLDAPConfig(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	return srv
}

type importResult struct {
	Imported      int      `json:"imported"`
	Skipped       []string `json:"skipped"`
	Missing       []string `json:"missing"`
	AddedToGroups int      `json:"addedToGroups"`
}

// Import takes each person from the directory: the account gets the directory's
// name and e-mail, unknown names are refused, local accounts are never converted.
func TestLDAPImportUsesTheDirectory(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	withDirectory(t, e, nil)
	ctx := context.Background()
	readers, _ := e.store.CreateGroup(ctx, "readers", "")
	root := e.login("root")

	body := e.expect(http.MethodPost, "/api/admin/ldap/import", root, map[string]any{
		"usernames": []string{"bob", "ghost", "root"}, "groupIds": []int{readers},
	}, http.StatusOK)
	var got importResult
	_ = json.Unmarshal([]byte(body), &got)
	if got.Imported != 1 || fmt.Sprint(got.Skipped) != "[root]" || fmt.Sprint(got.Missing) != "[ghost]" || got.AddedToGroups != 1 {
		t.Fatalf("import: %s", body)
	}
	bob, err := e.store.GetUserByUsername(ctx, "Bob")
	if err != nil || bob.AuthSource != "ldap" || bob.DisplayName != "Bob Builder" || bob.Email != "bob@corp.example" {
		t.Fatalf("bob: %+v %v", bob, err)
	}
	if ids, _ := e.store.GetUserGroupIDs(ctx, bob.ID); fmt.Sprint(ids) != fmt.Sprint([]int{readers}) {
		t.Fatalf("bob's groups: %v", ids)
	}
	if r, _ := e.store.GetUserByUsername(ctx, "root"); r.AuthSource != "local" {
		t.Fatalf("root became %s", r.AuthSource)
	}
	// The 2.1 body (an array of users; what it says about them is ignored) still works.
	body = e.expect(http.MethodPost, "/api/admin/ldap/import", root, []models.LDAPUser{{Username: "carol", DisplayName: "Not Carol", Email: "evil@x"}}, http.StatusOK)
	carol, _ := e.store.GetUserByUsername(ctx, "carol")
	if !strings.Contains(body, `"imported":1`) || carol.Email != "carol@corp.example" || carol.DisplayName != "Carol" {
		t.Fatalf("legacy import: %s %+v", body, carol)
	}
}

// A user manager may import (user.manage) but only into groups whose permissions
// they hold; idp.manage isn't needed.
func TestUserManagersImportWithinTheirPermissions(t *testing.T) {
	e := newEnv(t)
	withDirectory(t, e, nil)
	ctx := context.Background()
	manager := e.user("manager", false)
	e.grant(manager.ID, "user.view", "user.manage")
	plain, _ := e.store.CreateGroup(ctx, "plain", "")
	auditors, _ := e.store.CreateGroup(ctx, "auditors", "")
	role, _ := e.store.CreateRole(ctx, "auditor", "")
	_ = e.store.ReplaceRolePermissions(ctx, role, []string{"audit.view"})
	_ = e.store.SetGroupRoles(ctx, auditors, []int{role})
	m := e.login("manager")

	e.expect(http.MethodPost, "/api/admin/ldap/search", m, map[string]string{"query": "bo"}, http.StatusOK)
	e.expect(http.MethodPost, "/api/admin/ldap/import", m, map[string]any{"usernames": []string{"bob"}, "groupIds": []int{auditors}}, http.StatusForbidden)
	if _, err := e.store.GetUserByUsername(ctx, "Bob"); err == nil {
		t.Fatal("a refused import created the account")
	}
	e.expect(http.MethodPost, "/api/admin/ldap/import", m, map[string]any{"usernames": []string{"bob"}, "groupIds": []int{plain}}, http.StatusOK)
	// The settings stay with idp.manage.
	e.expect(http.MethodGet, "/api/admin/ldap", m, nil, http.StatusForbidden)
}

// With auto-create on, a directory user's first sign-in creates the account: no
// groups, no admin, the directory's spelling; with groups set, only their members.
func TestLDAPAutoCreateAtFirstSignIn(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	login := func(user, pw string) int {
		code, _ := e.do(http.MethodPost, "/api/auth/login", "", map[string]string{"username": user, "password": pw})
		return code
	}
	withDirectory(t, e, nil)
	// Off (the default): unknown users can't sign in, even with the right password.
	if code := login("bob", "bob-pw"); code != http.StatusUnauthorized {
		t.Fatalf("auto-create off: %d", code)
	}

	withDirectory(t, e, func(c *models.LDAPConfig) {
		c.AutoCreate = true
		c.AutoCreateGroups = []string{"cn=api-readers,ou=groups,dc=corp"}
	})
	if code := login("carol", "carol-pw"); code != http.StatusUnauthorized {
		t.Fatalf("carol isn't in an allowed group: %d", code)
	}
	if code := login("bob", "wrong"); code != http.StatusUnauthorized {
		t.Fatalf("wrong password: %d", code)
	}
	if _, err := e.store.GetUserByUsername(ctx, "Bob"); err == nil {
		t.Fatal("an account was created without a successful sign-in")
	}
	if code := login("bob", "bob-pw"); code != http.StatusOK {
		t.Fatalf("bob: %d", code)
	}
	bob, err := e.store.GetUserByUsername(ctx, "Bob")
	if err != nil || bob.AuthSource != "ldap" || bob.IsAdmin || bob.Email != "bob@corp.example" {
		t.Fatalf("created: %+v %v", bob, err)
	}
	if ids, _ := e.store.GetUserGroupIDs(ctx, bob.ID); len(ids) != 0 {
		t.Fatalf("new account has groups: %v", ids)
	}
	var created int
	_ = e.dbConn.QueryRowContext(ctx, `SELECT COUNT(*) FROM audit_logs WHERE action = 'auth.login.success' AND details_json LIKE '%accountCreated%'`).Scan(&created)
	if created != 1 {
		t.Fatalf("audit entries marking the creation: %d", created)
	}
	// The second sign-in uses the account; nothing new is created.
	if code := login("BOB", "bob-pw"); code != http.StatusOK {
		t.Fatalf("second sign-in: %d", code)
	}
	var n int
	_ = e.dbConn.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE lower(username) = 'bob'`).Scan(&n)
	if n != 1 {
		t.Fatalf("%d accounts for bob", n)
	}

	// A local account with the directory's username is never taken over.
	withDirectory(t, e, func(c *models.LDAPConfig) { c.AutoCreate = true })
	e.user("root", true)
	if code := login("ROOT", "dir-root-pw"); code != http.StatusUnauthorized {
		t.Fatalf("directory 'root' signed in over the local admin: %d", code)
	}
	if r, _ := e.store.GetUserByUsername(ctx, "root"); r.AuthSource != "local" {
		t.Fatalf("root became %s", r.AuthSource)
	}
}

// Pre-registration makes an Azure AD account that waits for its first Microsoft
// sign-in; groups are a grant; duplicates are refused.
func TestAzurePreregistration(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	ctx := context.Background()
	_ = e.store.UpdateAzureADConfig(ctx, models.AzureADConfig{Enabled: true, TenantID: "t", ClientID: "c", ClientSecret: "s", RedirectURL: "https://p.example/cb"})
	team, _ := e.store.CreateGroup(ctx, "team", "")
	root := e.login("root")

	body := e.expect(http.MethodPost, "/api/admin/users/azure", root, map[string]any{
		"email": "jane.doe@corp.com", "upn": "jdoe@corp.onmicrosoft.com", "displayName": "Jane", "groupIds": []int{team},
	}, http.StatusCreated)
	if !strings.Contains(body, `"username":"jdoe"`) {
		t.Fatalf("pre-registration: %s", body)
	}
	jane, _ := e.store.GetUserByUsername(ctx, "jdoe")
	if jane.AuthSource != "azuread" || jane.ExternalID != "" || jane.Email != "jane.doe@corp.com" {
		t.Fatalf("account: %+v", jane)
	}
	if ids, _ := e.store.GetUserGroupIDs(ctx, jane.ID); len(ids) != 1 {
		t.Fatalf("groups: %v", ids)
	}
	// What a first sign-in binds to: the UPN's name, or the e-mail when the UPN differs.
	if got, err := e.store.GetUnboundAzureUser(ctx, "jane.doe@corp.com", "jdoe"); err != nil || got.ID != jane.ID {
		t.Fatalf("bind by sign-in name: %v %v", got, err)
	}
	e.expect(http.MethodPost, "/api/admin/users/azure", root, map[string]any{"email": "jane.doe@corp.com"}, http.StatusConflict)
	e.expect(http.MethodPost, "/api/admin/users/azure", root, map[string]any{"email": "not-an-email"}, http.StatusBadRequest)
	e.expect(http.MethodPost, "/api/admin/users/azure", root, map[string]any{"email": "x@corp.com", "upn": "no-at-sign"}, http.StatusBadRequest)

	// The same person already has an LDAP account (same name, same e-mail): the
	// Azure AD account is a separate one, "<name>-2", and still binds at sign-in.
	if _, err := e.store.CreateUser(ctx, models.User{Username: "murat.y", Email: "murat.y@corp.com", AuthSource: "ldap", IsActive: true}); err != nil {
		t.Fatal(err)
	}
	body = e.expect(http.MethodPost, "/api/admin/users/azure", root, map[string]any{"email": "murat.y@corp.com"}, http.StatusCreated)
	if !strings.Contains(body, `"username":"murat.y-2"`) || !strings.Contains(body, `"sharesEmailWith":"murat.y (ldap)"`) {
		t.Fatalf("next to an LDAP account: %s", body)
	}
	murat, _ := e.store.GetUserByUsername(ctx, "murat.y-2")
	// At the first sign-in the UPN gives "murat.y"; without an e-mail claim the
	// suffixed pre-registration is still found (and never the LDAP account).
	if got, err := e.store.GetUnboundAzureUser(ctx, "", "murat.y"); err != nil || got.ID != murat.ID {
		t.Fatalf("bind by sign-in name with a suffix: %v %v", got, err)
	}
	if got, err := e.store.GetUnboundAzureUser(ctx, "murat.y@corp.com", "someone-else"); err != nil || got.ID != murat.ID {
		t.Fatalf("bind by e-mail: %v %v", got, err)
	}
	// A second Azure AD account for that address is a duplicate.
	e.expect(http.MethodPost, "/api/admin/users/azure", root, map[string]any{"email": "murat.y@corp.com"}, http.StatusConflict)

	_ = e.store.UpdateAzureADConfig(ctx, models.AzureADConfig{Enabled: false})
	e.expect(http.MethodPost, "/api/admin/users/azure", root, map[string]any{"email": "late@corp.com"}, http.StatusBadRequest)
}

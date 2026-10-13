package auth

import (
	"strings"
	"testing"

	"api-portal/backend/internal/auth/ldaptest"
	"api-portal/backend/internal/models"
)

func testDirectory(t *testing.T) (*ldaptest.Server, models.LDAPConfig) {
	t.Helper()
	srv := ldaptest.Start(t,
		ldaptest.Entry{DN: "cn=svc,dc=corp", Password: "svc-pw"},
		ldaptest.Entry{DN: "uid=Bob,ou=people,dc=corp", Password: "bob-pw", Attrs: map[string][]string{
			"uid": {"Bob"}, "displayName": {"Bob Builder"}, "mail": {"bob@corp.example"},
			"memberOf": {"cn=api-readers,ou=groups,dc=corp"},
		}},
		ldaptest.Entry{DN: "uid=twin,ou=people,dc=corp", Password: "x", Attrs: map[string][]string{"uid": {"twin"}}},
		ldaptest.Entry{DN: "uid=twin,ou=contractors,dc=corp", Password: "y", Attrs: map[string][]string{"uid": {"twin"}}},
	)
	cfg := models.LDAPConfig{
		Enabled: true, Host: "127.0.0.1", Port: srv.Port, TimeoutSeconds: 5,
		BindDN: "cn=svc,dc=corp", BindPassword: "svc-pw", UserBaseDN: "dc=corp",
		UsernameAttribute: "uid", DisplayNameAttr: "displayName", EmailAttr: "mail", UserFilter: "(objectClass=person)",
	}
	return srv, cfg
}

func TestLDAPAuthenticateUserReturnsTheEntry(t *testing.T) {
	_, cfg := testDirectory(t)
	user, groups, err := LDAPAuthenticateUser(cfg, "bob", "bob-pw")
	if err != nil {
		t.Fatal(err)
	}
	// The directory's spelling of the username, not what was typed.
	if user.Username != "Bob" || user.DisplayName != "Bob Builder" || user.Email != "bob@corp.example" || len(groups) != 1 {
		t.Fatalf("got %+v %v", user, groups)
	}
	if _, _, err := LDAPAuthenticateUser(cfg, "bob", "wrong"); err == nil {
		t.Fatal("wrong password accepted")
	}
	if _, _, err := LDAPAuthenticateUser(cfg, "twin", "x"); err == nil || !strings.Contains(err.Error(), "more than one") {
		t.Fatalf("two entries for one name: %v", err)
	}
}

func TestLookupLDAPUsersOnlyFindsRealEntries(t *testing.T) {
	_, cfg := testDirectory(t)
	found, missing, err := LookupLDAPUsers(cfg, []string{"bob", "ghost", "twin"})
	if err != nil {
		t.Fatal(err)
	}
	if len(found) != 1 || found[0].Username != "Bob" || found[0].DN != "uid=Bob,ou=people,dc=corp" {
		t.Fatalf("found %+v", found)
	}
	if strings.Join(missing, ",") != "ghost,twin" {
		t.Fatalf("missing %v", missing)
	}
}

package rbac

import "testing"

func TestImplications(t *testing.T) {
	e := New(false, []string{"api:7:manage", "LDAP.manage", "user.manage", "api:9:invoke"})
	cases := map[string]bool{
		"api:7:view": true, "api:7:invoke": true, "api:7:manage": true,
		"api:7:delete": false, // manage doesn't imply delete
		"api:8:view":   false,
		"api:9:view":   true, "api:9:manage": false,
		"idp.manage": true, // retired alias
		"user.view":  true,
		"api.view":   false,
		"audit.view": false,
	}
	for scope, want := range cases {
		if got := e.Has(scope); got != want {
			t.Errorf("Has(%s) = %v, want %v", scope, got, want)
		}
	}
	global := New(false, []string{"api.manage"})
	for _, s := range []string{"api.create", "api.delete", "api.view", "api:3:delete", "api:3:invoke"} {
		if !global.Has(s) {
			t.Errorf("api.manage should cover %s", s)
		}
	}
	if New(false, []string{"api.invoke"}).Has("api.create") {
		t.Error("api.invoke covers api.create")
	}
	if !New(true, nil).Has("anything.at.all") {
		t.Error("admin lacks a scope")
	}
}

func TestValid(t *testing.T) {
	for scope, want := range map[string]bool{"api.view": true, "api:12:delete": true, "api:x:view": false, "api:1:own": false, "ldap.manage": true, "root": false} {
		if Valid(scope) != want {
			t.Errorf("Valid(%s) = %v", scope, !want)
		}
	}
}

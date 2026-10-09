package auth

import (
	"testing"

	"api-portal/backend/internal/models"
)

func TestUserLoginFilterAlwaysContainsUsername(t *testing.T) {
	cases := []struct {
		name   string
		cfg    models.LDAPConfig
		user   string
		expect string
	}{
		{"no filter, default attr", models.LDAPConfig{}, "alice", "(uid=alice)"},
		{"no filter, custom attr", models.LDAPConfig{UsernameAttribute: "sAMAccountName"}, "alice", "(sAMAccountName=alice)"},
		// The 1.0.x bug: this filter was used as-is and matched the first directory entry.
		{"filter without %s is AND-ed", models.LDAPConfig{UserFilter: "(objectClass=user)", UsernameAttribute: "sAMAccountName"}, "alice", "(&(objectClass=user)(sAMAccountName=alice))"},
		{"filter with %s", models.LDAPConfig{UserFilter: "(&(objectClass=person)(mail=%s))"}, "alice@example.com", "(&(objectClass=person)(mail=alice@example.com))"},
		{"filter with repeated %s", models.LDAPConfig{UserFilter: "(|(uid=%s)(mail=%s))"}, "bob", "(|(uid=bob)(mail=bob))"},
		{"username is escaped", models.LDAPConfig{UserFilter: "(objectClass=user)"}, "*)(uid=*", `(&(objectClass=user)(uid=\2a\29\28uid=\2a))`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := UserLoginFilter(tc.cfg, tc.user); got != tc.expect {
				t.Fatalf("UserLoginFilter() = %q, want %q", got, tc.expect)
			}
		})
	}
}

func TestValidateUserFilter(t *testing.T) {
	if err := ValidateUserFilter(models.LDAPConfig{UserFilter: "(objectClass=user)"}); err != nil {
		t.Fatalf("valid filter rejected: %v", err)
	}
	if err := ValidateUserFilter(models.LDAPConfig{}); err != nil {
		t.Fatalf("empty filter rejected: %v", err)
	}
	if err := ValidateUserFilter(models.LDAPConfig{UserFilter: "(objectClass=user"}); err == nil {
		t.Fatal("unbalanced filter accepted")
	}
}

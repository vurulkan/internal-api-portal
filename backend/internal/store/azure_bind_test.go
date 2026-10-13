package store

import (
	"context"
	"path/filepath"
	"testing"

	"api-portal/backend/internal/models"
)

// Which account a first Microsoft sign-in binds to: only never-bound Azure AD
// accounts, by sign-in name first, by e-mail only when that address is unambiguous.
func TestGetUnboundAzureUser(t *testing.T) {
	ctx := context.Background()
	st, err := New(openDB(t, filepath.Join(t.TempDir(), "app.db")), Keys{})
	if err != nil {
		t.Fatal(err)
	}
	add := func(u models.User) int {
		id, err := st.CreateUser(ctx, u)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	// Pre-registered by e-mail; the person's UPN differs from it.
	jane := add(models.User{Username: "jane.doe-corp.com", Email: "jane.doe@corp.com", AuthSource: "azuread", IsActive: true})
	// A local and an LDAP account with addresses an Azure profile could also carry.
	add(models.User{Username: "boss", Email: "boss@corp.com", AuthSource: "local", IsActive: true, IsAdmin: true})
	add(models.User{Username: "ops", Email: "ops@corp.com", AuthSource: "ldap", IsActive: true})

	got, err := st.GetUnboundAzureUser(ctx, "Jane.Doe@corp.com", "jdoe-corp.onmicrosoft.com")
	if err != nil || got.ID != jane {
		t.Fatalf("UPN differs from the e-mail: got %v, %v; want the pre-registration", got, err)
	}
	for _, email := range []string{"boss@corp.com", "ops@corp.com"} {
		if got, err := st.GetUnboundAzureUser(ctx, email, "someone"); err == nil {
			t.Fatalf("%s bound a %s account", email, got.AuthSource)
		}
	}

	// The sign-in name wins over the e-mail.
	byName := add(models.User{Username: "jdoe-corp.onmicrosoft.com", Email: "other@corp.com", AuthSource: "azuread", IsActive: true})
	if got, _ := st.GetUnboundAzureUser(ctx, "jane.doe@corp.com", "jdoe-corp.onmicrosoft.com"); got == nil || got.ID != byName {
		t.Fatalf("sign-in name match: got %v, want %d", got, byName)
	}

	// Two never-bound accounts with one address: neither is chosen.
	add(models.User{Username: "jane-again", Email: "JANE.DOE@corp.com", AuthSource: "azuread", IsActive: true})
	if got, err := st.GetUnboundAzureUser(ctx, "jane.doe@corp.com", "nobody"); err == nil {
		t.Fatalf("ambiguous e-mail bound %s", got.Username)
	}

	// A bound account (signed in before) is never re-bound to another identity.
	if err := st.SetUserExternalID(ctx, byName, "tenant:oid-1"); err != nil {
		t.Fatal(err)
	}
	if got, err := st.GetUnboundAzureUser(ctx, "", "jdoe-corp.onmicrosoft.com"); err == nil {
		t.Fatalf("bound account matched again: %s", got.Username)
	}
}

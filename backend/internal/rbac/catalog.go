package rbac

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Family tells how much a scope can do; the UI colours and labels by it.
type Family string

const (
	Read        Family = "read"
	Write       Family = "write"
	Destructive Family = "destructive"
)

// ScopeDef describes one grantable permission. PerAPI scopes are templates: the
// stored scope is api:<id>:<Action>.
type ScopeDef struct {
	Scope       string `json:"scope"`
	Group       string `json:"group"`
	Family      Family `json:"family"`
	Description string `json:"description"`
	PerAPI      bool   `json:"perApi,omitempty"`
	Action      string `json:"action,omitempty"`
}

// Catalog is the single list of scopes. GET /api/permissions/catalog serves it and
// role editing validates against it.
var Catalog = []ScopeDef{
	{Scope: "api.view", Group: "APIs", Family: Read, Description: "See every API in the catalog: documentation and spec"},
	{Scope: "api.invoke", Group: "APIs", Family: Write, Description: "Call every API through try-it (includes view)"},
	{Scope: "api.create", Group: "APIs", Family: Write, Description: "Register new APIs"},
	{Scope: "api.manage", Group: "APIs", Family: Write, Description: "Edit, refresh, create and delete every API, and manage access to it"},
	{Scope: "api.delete", Group: "APIs", Family: Destructive, Description: "Delete any API"},

	{Scope: "api:{id}:view", Group: "Single API", Family: Read, PerAPI: true, Action: "view", Description: "See this API"},
	{Scope: "api:{id}:invoke", Group: "Single API", Family: Write, PerAPI: true, Action: "invoke", Description: "Call this API through try-it (includes view)"},
	{Scope: "api:{id}:manage", Group: "Single API", Family: Write, PerAPI: true, Action: "manage", Description: "Edit and refresh this API and manage who may view / call it"},
	{Scope: "api:{id}:delete", Group: "Single API", Family: Destructive, PerAPI: true, Action: "delete", Description: "Delete this API"},

	{Scope: "user.view", Group: "Users & access", Family: Read, Description: "See users and their groups"},
	{Scope: "user.manage", Group: "Users & access", Family: Write, Description: "Create, edit, deactivate and delete non-administrator users; reset passwords"},
	{Scope: "group.manage", Group: "Users & access", Family: Write, Description: "Create and edit groups and their roles"},
	{Scope: "role.manage", Group: "Users & access", Family: Write, Description: "Create and edit roles and their permissions"},
	{Scope: "session.manage", Group: "Users & access", Family: Destructive, Description: "See and end anyone's sessions"},

	{Scope: "idp.manage", Group: "System", Family: Write, Description: "Configure LDAP and Azure AD, import LDAP users"},
	{Scope: "settings.manage", Group: "System", Family: Write, Description: "Session timeouts and branding"},

	{Scope: "audit.view", Group: "Audit", Family: Read, Description: "Read the audit log"},
	{Scope: "audit.export", Group: "Audit", Family: Read, Description: "Export the audit log as CSV"},
}

// aliases maps retired scope names to their replacement (still honoured if a role
// was not migrated).
var aliases = map[string]string{"ldap.manage": "idp.manage"}

var perAPIScope = regexp.MustCompile(`^api:([0-9]+):(view|invoke|manage|delete)$`)

// Normalize lower-cases and trims a scope and maps retired names.
func Normalize(scope string) string {
	scope = strings.ToLower(strings.TrimSpace(scope))
	if alias, ok := aliases[scope]; ok {
		return alias
	}
	return scope
}

// Valid reports whether scope is in the catalog (per-API scopes with a numeric id).
func Valid(scope string) bool {
	scope = Normalize(scope)
	if perAPIScope.MatchString(scope) {
		return true
	}
	for _, def := range Catalog {
		if !def.PerAPI && def.Scope == scope {
			return true
		}
	}
	return false
}

// APIScope builds api:<id>:<action>.
func APIScope(apiID int, action string) string {
	return fmt.Sprintf("api:%d:%s", apiID, action)
}

// ParseAPIScope returns the API id and action of a per-API scope.
func ParseAPIScope(scope string) (int, string, bool) {
	m := perAPIScope.FindStringSubmatch(Normalize(scope))
	if m == nil {
		return 0, "", false
	}
	id, _ := strconv.Atoi(m[1])
	return id, m[2], true
}

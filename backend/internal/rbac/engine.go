package rbac

// Engine answers permission questions for one user. Administrators (isAdmin) hold
// every scope. Implications (a broader scope covering a narrower one) live here,
// so handlers ask for the narrowest scope they need.
type Engine struct {
	isAdmin     bool
	permissions map[string]struct{}
}

func New(isAdmin bool, permissions []string) *Engine {
	set := make(map[string]struct{}, len(permissions))
	for _, p := range permissions {
		set[Normalize(p)] = struct{}{}
	}
	return &Engine{isAdmin: isAdmin, permissions: set}
}

func (e *Engine) IsAdmin() bool { return e.isAdmin }

// Has reports whether the user holds scope, directly or through an implication.
func (e *Engine) Has(scope string) bool {
	if e.isAdmin {
		return true
	}
	scope = Normalize(scope)
	if e.direct(scope) {
		return true
	}
	if id, action, ok := ParseAPIScope(scope); ok {
		switch action {
		case "view":
			return e.CanViewAPI(id)
		case "invoke":
			return e.CanInvokeAPI(id)
		case "manage":
			return e.CanManageAPI(id)
		case "delete":
			return e.CanDeleteAPI(id)
		}
	}
	switch scope {
	case "user.view":
		return e.direct("user.manage")
	case "api.view", "api.invoke", "api.create", "api.delete":
		return e.direct("api.manage") || (scope == "api.view" && e.direct("api.invoke"))
	}
	return false
}

func (e *Engine) direct(scope string) bool {
	_, ok := e.permissions[scope]
	return ok
}

func (e *Engine) Any(scopes ...string) bool {
	for _, s := range scopes {
		if e.Has(s) {
			return true
		}
	}
	return false
}

func (e *Engine) CanViewAPI(id int) bool {
	return e.isAdmin || e.direct("api.view") || e.CanInvokeAPI(id) || e.direct(APIScope(id, "view"))
}

func (e *Engine) CanInvokeAPI(id int) bool {
	return e.isAdmin || e.direct("api.invoke") || e.CanManageAPI(id) || e.direct(APIScope(id, "invoke"))
}

func (e *Engine) CanManageAPI(id int) bool {
	return e.isAdmin || e.direct("api.manage") || e.direct(APIScope(id, "manage"))
}

// CanDeleteAPI: api:<id>:manage alone does not allow deleting the API.
func (e *Engine) CanDeleteAPI(id int) bool {
	return e.isAdmin || e.direct("api.manage") || e.direct("api.delete") || e.direct(APIScope(id, "delete"))
}

// ManagesAllAPIs reports a global API management scope.
func (e *Engine) ManagesAllAPIs() bool { return e.isAdmin || e.direct("api.manage") }

// ManagedAPIs lists the API ids the user manages through per-API scopes.
func (e *Engine) ManagedAPIs() []int {
	var ids []int
	for scope := range e.permissions {
		if id, action, ok := ParseAPIScope(scope); ok && (action == "manage" || action == "delete") {
			ids = append(ids, id)
		}
	}
	return ids
}

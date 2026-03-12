package rbac

import (
	"fmt"
	"strings"
)

type Engine struct {
	isAdmin     bool
	permissions map[string]struct{}
}

func New(isAdmin bool, permissions []string) *Engine {
	permSet := make(map[string]struct{}, len(permissions))
	for _, permission := range permissions {
		permSet[strings.ToLower(permission)] = struct{}{}
	}
	return &Engine{isAdmin: isAdmin, permissions: permSet}
}

func (e *Engine) Has(permission string) bool {
	if e.isAdmin {
		return true
	}
	_, ok := e.permissions[strings.ToLower(permission)]
	return ok
}

func (e *Engine) Any(permissions ...string) bool {
	for _, permission := range permissions {
		if e.Has(permission) {
			return true
		}
	}
	return false
}

func (e *Engine) CanViewAPI(apiID int) bool {
	return e.Any("api.view", fmt.Sprintf("api:%d:view", apiID), fmt.Sprintf("api:%d:manage", apiID), "api.manage")
}

func (e *Engine) CanInvokeAPI(apiID int) bool {
	return e.Any("api.invoke", fmt.Sprintf("api:%d:invoke", apiID), fmt.Sprintf("api:%d:manage", apiID), "api.manage")
}

func (e *Engine) CanManageAPI(apiID int) bool {
	return e.Any("api.manage", fmt.Sprintf("api:%d:manage", apiID))
}

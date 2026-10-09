package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"api-portal/backend/internal/models"
)

func (s *Server) handleListRoles(w http.ResponseWriter, r *http.Request) {
	roles, err := s.store.ListRoles(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load roles")
		return
	}
	writeJSON(w, http.StatusOK, roles)
}

func (s *Server) handleCreateRole(w http.ResponseWriter, r *http.Request) {
	var payload models.Role
	if !decodeJSON(w, r, &payload) {
		return
	}
	id, err := s.store.CreateRole(r.Context(), payload.Name, payload.Description)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to create role")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]int{"id": id})
}

func (s *Server) handleUpdateRole(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	var payload models.Role
	if !decodeJSON(w, r, &payload) {
		return
	}
	payload.ID = id
	if err := s.store.UpdateRole(r.Context(), payload); err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to update role")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleDeleteRole(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	if err := s.store.DeleteRole(r.Context(), id); err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to delete role")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleRolePermissions(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	perms, err := s.store.ListRolePermissions(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load permissions")
		return
	}
	writeJSON(w, http.StatusOK, perms)
}

func (s *Server) handleAddRolePermission(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	var payload struct {
		Scope       string `json:"scope"`
		Description string `json:"description"`
	}
	if !decodeJSON(w, r, &payload) {
		return
	}
	actor, _ := s.identityForRequest(r)
	payload.Scope = strings.TrimSpace(payload.Scope)
	if payload.Scope == "" {
		writeError(w, r, http.StatusBadRequest, "scope is required")
		return
	}
	if !s.allowGrant(w, r, actor, func() ([]string, error) { return []string{payload.Scope}, nil }) {
		return
	}
	if err := s.store.AddRolePermission(r.Context(), id, payload.Scope, payload.Description); err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to add permission")
		return
	}
	s.recordAudit(r, models.AuditLog{Action: "admin.role.permission.add", ResourceType: "role", ResourceID: strconv.Itoa(id), StatusCode: http.StatusCreated, DetailsJSON: marshalJSON(map[string]string{"scope": payload.Scope})})
	writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

func (s *Server) handleReplaceRolePermissions(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	var payload struct {
		Scopes []string `json:"scopes"`
	}
	if !decodeJSON(w, r, &payload) {
		return
	}
	actor, _ := s.identityForRequest(r)
	newScopes := func() ([]string, error) {
		existing, err := s.store.ListRolePermissions(r.Context(), id)
		if err != nil {
			return nil, err
		}
		have := map[string]bool{}
		for _, perm := range existing {
			have[strings.ToLower(perm.Scope)] = true
		}
		var added []string
		for _, scope := range payload.Scopes {
			if !have[strings.ToLower(strings.TrimSpace(scope))] {
				added = append(added, strings.TrimSpace(scope))
			}
		}
		return added, nil
	}
	if !s.allowGrant(w, r, actor, newScopes) {
		return
	}
	if err := s.store.ReplaceRolePermissions(r.Context(), id, payload.Scopes); err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to replace permissions")
		return
	}
	s.recordAudit(r, models.AuditLog{User: s.usernameOrAnonymous(r), Action: "admin.role.permissions.replace", ResourceType: "role", ResourceID: strconv.Itoa(id), StatusCode: http.StatusOK, DetailsJSON: marshalJSON(payload.Scopes)})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleDeletePermission(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	if err := s.store.DeletePermission(r.Context(), id); err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to delete permission")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

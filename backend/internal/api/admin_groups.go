package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"api-portal/backend/internal/models"
)

func (s *Server) handleListGroups(w http.ResponseWriter, r *http.Request) {
	groups, err := s.store.ListGroups(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load groups")
		return
	}
	writeJSON(w, http.StatusOK, groups)
}

func (s *Server) handleCreateGroup(w http.ResponseWriter, r *http.Request) {
	var payload models.Group
	if !decodeJSON(w, r, &payload) {
		return
	}
	id, err := s.store.CreateGroup(r.Context(), payload.Name, payload.Description)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to create group")
		return
	}
	s.recordAudit(r, models.AuditLog{User: s.usernameOrAnonymous(r), Action: "admin.group.create", ResourceType: "group", ResourceID: strconv.Itoa(id), ResourceName: payload.Name, StatusCode: http.StatusCreated})
	writeJSON(w, http.StatusCreated, map[string]int{"id": id})
}

func (s *Server) handleUpdateGroup(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	var payload models.Group
	if !decodeJSON(w, r, &payload) {
		return
	}
	if err := s.store.UpdateGroup(r.Context(), id, payload.Name, payload.Description); err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to update group")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleDeleteGroup(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	if err := s.store.DeleteGroup(r.Context(), id); err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to delete group")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleGetGroupRoles(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	roleIDs, err := s.store.GetGroupRoleIDs(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load group roles")
		return
	}
	writeJSON(w, http.StatusOK, roleIDs)
}

func (s *Server) handleSetGroupRoles(w http.ResponseWriter, r *http.Request) {
	actor, _ := s.identityForRequest(r)
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	var payload []int
	if !decodeJSON(w, r, &payload) {
		return
	}
	current, err := s.store.GetGroupRoleIDs(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load group roles")
		return
	}
	if !s.allowGrant(w, r, actor, func() ([]string, error) { return s.store.ScopesForRoles(r.Context(), addedIDs(current, payload)) }) {
		return
	}
	if err := s.store.SetGroupRoles(r.Context(), id, payload); err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to update group roles")
		return
	}
	s.recordAudit(r, models.AuditLog{Action: "admin.group.roles.update", ResourceType: "group", ResourceID: strconv.Itoa(id), StatusCode: http.StatusOK, DetailsJSON: marshalJSON(payload)})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

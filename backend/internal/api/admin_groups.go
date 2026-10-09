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
		http.Error(w, "failed to load groups", http.StatusInternalServerError)
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
		http.Error(w, "failed to create group", http.StatusBadRequest)
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
		http.Error(w, "failed to update group", http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleDeleteGroup(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	if err := s.store.DeleteGroup(r.Context(), id); err != nil {
		http.Error(w, "failed to delete group", http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleGetGroupRoles(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	roleIDs, err := s.store.GetGroupRoleIDs(r.Context(), id)
	if err != nil {
		http.Error(w, "failed to load group roles", http.StatusInternalServerError)
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
		http.Error(w, "failed to load group roles", http.StatusInternalServerError)
		return
	}
	if !s.allowGrant(w, r, actor, func() ([]string, error) { return s.store.ScopesForRoles(r.Context(), addedIDs(current, payload)) }) {
		return
	}
	if err := s.store.SetGroupRoles(r.Context(), id, payload); err != nil {
		http.Error(w, "failed to update group roles", http.StatusBadRequest)
		return
	}
	s.recordAudit(r, models.AuditLog{Action: "admin.group.roles.update", ResourceType: "group", ResourceID: strconv.Itoa(id), StatusCode: http.StatusOK, DetailsJSON: marshalJSON(payload)})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

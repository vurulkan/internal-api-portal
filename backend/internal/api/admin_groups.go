package api

import (
	"net/http"
	"strconv"
	"strings"

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
	payload.Name = strings.TrimSpace(payload.Name)
	if payload.Name == "" {
		writeError(w, r, http.StatusBadRequest, "name is required")
		return
	}
	id, err := s.store.CreateGroupWithMapping(r.Context(), payload)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to create group")
		return
	}
	auditTarget(r, "group", strconv.Itoa(id), payload.Name)
	writeJSON(w, http.StatusCreated, map[string]int{"id": id})
}

func (s *Server) handleUpdateGroup(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	auditTarget(r, "group", strconv.Itoa(id), "")
	actor, _ := s.identityForRequest(r)
	before, err := s.store.GetGroup(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "group not found")
		return
	}
	auditTarget(r, "group", strconv.Itoa(id), before.Name)
	var payload models.Group
	if !decodeJSON(w, r, &payload) {
		return
	}
	payload.ID = id
	payload.Name = strings.TrimSpace(payload.Name)
	if payload.Name == "" {
		writeError(w, r, http.StatusBadRequest, "name is required")
		return
	}
	// Mapping a group to a directory group hands its permissions to that directory
	// group's members (at their next sign-in): treat it like granting them.
	if strings.TrimSpace(payload.AzureGroupID) != before.AzureGroupID || strings.TrimSpace(payload.LDAPGroupDN) != before.LDAPGroupDN {
		if !s.allowGrant(w, r, actor, func() ([]string, error) { return s.store.ScopesForGroups(r.Context(), []int{id}) }) {
			return
		}
	}
	if err := s.store.UpdateGroup(r.Context(), payload); err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to update group")
		return
	}
	payload.CreatedAt = before.CreatedAt
	auditChanges(r, before, payload)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleDeleteGroup(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	auditTarget(r, "group", strconv.Itoa(id), "")
	if err := s.store.DeleteGroup(r.Context(), id); err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to delete group")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleGetGroupRoles(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	auditTarget(r, "group", strconv.Itoa(id), "")
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
	auditTarget(r, "group", strconv.Itoa(id), "")
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
	auditTarget(r, "group", strconv.Itoa(id), "")
	auditDetail(r, "roleIds", payload)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

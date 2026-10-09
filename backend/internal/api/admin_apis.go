package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"api-portal/backend/internal/models"
)

func (s *Server) handleAdminAPIs(w http.ResponseWriter, r *http.Request) {
	apis, err := s.store.ListAPIDefinitions(r.Context())
	if err != nil {
		http.Error(w, "failed to load apis", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, apis)
}

func (s *Server) handleCreateAPI(w http.ResponseWriter, r *http.Request) {
	var payload models.APIDefinition
	if !decodeJSON(w, r, &payload) {
		return
	}
	id, err := s.store.CreateAPIDefinition(r.Context(), payload)
	if err != nil {
		http.Error(w, "failed to create api", http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]int{"id": id})
}

func (s *Server) handleUpdateAPI(w http.ResponseWriter, r *http.Request) {
	var payload models.APIDefinition
	if !decodeJSON(w, r, &payload) {
		return
	}
	payload.ID, _ = strconv.Atoi(chi.URLParam(r, "id"))
	if err := s.store.UpdateAPIDefinition(r.Context(), payload); err != nil {
		http.Error(w, "failed to update api", http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleDeleteAPI(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	if err := s.store.DeleteAPIDefinition(r.Context(), id); err != nil {
		http.Error(w, "failed to delete api", http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleRefreshAPISpec(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	apiDef, err := s.store.GetAPIDefinition(r.Context(), id)
	if err != nil {
		http.Error(w, "api not found", http.StatusNotFound)
		return
	}
	cache, err := s.openapi.Refresh(r.Context(), *apiDef)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	s.recordAudit(r, models.AuditLog{User: s.usernameOrAnonymous(r), Action: "api.spec.refresh", ResourceType: "api", ResourceID: strconv.Itoa(apiDef.ID), ResourceName: apiDef.Name, StatusCode: http.StatusOK})
	writeJSON(w, http.StatusOK, cache)
}

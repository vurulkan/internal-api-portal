package api

import (
	"context"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"api-portal/backend/internal/models"
)

func (s *Server) handleAdminAPIs(w http.ResponseWriter, r *http.Request) {
	apis, err := s.store.ListAPIDefinitions(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load apis")
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
		writeError(w, r, http.StatusBadRequest, "failed to create api")
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
		writeError(w, r, http.StatusBadRequest, "failed to update api")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleDeleteAPI(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	if err := s.store.DeleteAPIDefinition(r.Context(), id); err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to delete api")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleRefreshAPISpec(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	apiDef, err := s.store.GetAPIDefinition(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "api not found")
		return
	}
	cache, err := s.refreshSpec(r.Context(), *apiDef)
	if err != nil {
		// API managers need the reason (DNS, TLS, status code, parse error) to fix the
		// definition, so the detail is returned here, unlike on the viewer endpoints.
		s.recordAudit(r, models.AuditLog{Action: "api.spec.refresh", ResourceType: "api", ResourceID: strconv.Itoa(apiDef.ID), ResourceName: apiDef.Name, ErrorMessage: err.Error(), StatusCode: http.StatusBadGateway})
		writeError(w, r, http.StatusBadGateway, "spec refresh failed: "+err.Error())
		return
	}
	s.recordAudit(r, models.AuditLog{User: s.usernameOrAnonymous(r), Action: "api.spec.refresh", ResourceType: "api", ResourceID: strconv.Itoa(apiDef.ID), ResourceName: apiDef.Name, StatusCode: http.StatusOK})
	writeJSON(w, http.StatusOK, cache)
}

// refreshSpec fetches the API's spec and records the outcome metric.
func (s *Server) refreshSpec(ctx context.Context, apiDef models.APIDefinition) (*models.APISpecCache, error) {
	cache, err := s.openapi.Refresh(ctx, apiDef)
	if err != nil {
		s.metrics.SpecRefreshes.Inc("error")
		return nil, err
	}
	s.metrics.SpecRefreshes.Inc("ok")
	return cache, nil
}

package api

import (
	"context"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"api-portal/backend/internal/models"
	"api-portal/backend/internal/rbac"
)

func (s *Server) apiEngine(r *http.Request) *rbac.Engine {
	identity, _ := s.identityForRequest(r)
	return rbac.New(identity.User.IsAdmin, identity.Permissions)
}

// withInjectNames fills the names of the configured injected headers; their values
// never leave the server.
func (s *Server) withInjectNames(ctx context.Context, api *models.APIDefinition) {
	headers, err := s.store.GetAPIInjectHeaders(ctx, api.ID)
	names := []string{}
	if err == nil {
		for name := range headers {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	api.InjectHeaderNames = names
	api.InjectHeaders = nil
}

// handleAdminAPIs lists the APIs the caller may manage: all of them with api.manage,
// otherwise those covered by api:<id>:manage / api:<id>:delete.
func (s *Server) handleAdminAPIs(w http.ResponseWriter, r *http.Request) {
	apis, err := s.store.ListAPIDefinitions(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load apis")
		return
	}
	engine := s.apiEngine(r)
	out := []models.APIDefinition{}
	for i := range apis {
		if engine.CanManageAPI(apis[i].ID) || engine.CanDeleteAPI(apis[i].ID) {
			s.withInjectNames(r.Context(), &apis[i])
			out = append(out, apis[i])
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// validateAPI checks a definition before it is stored and returns a user-facing
// problem, or "".
func (s *Server) validateAPI(ctx context.Context, api *models.APIDefinition) string {
	api.Name = strings.TrimSpace(api.Name)
	api.Slug = strings.TrimSpace(api.Slug)
	switch {
	case api.Name == "":
		return "name is required"
	case api.Slug == "":
		return "slug is required"
	}
	for _, raw := range []string{api.InternalBaseURL, api.InternalOpenAPIURL} {
		u, err := url.Parse(strings.TrimSpace(raw))
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return "base URL and OpenAPI URL must be absolute http(s) URLs"
		}
	}
	if api.RateLimitPerMinute < 0 || api.RateLimitPerMinute > 10000 {
		return "rate limit must be between 0 (default) and 10000 requests per minute"
	}
	if api.TimeoutSeconds < 0 || api.TimeoutSeconds > 300 {
		return "timeout must be between 0 (default) and 300 seconds"
	}
	for i, h := range api.AllowedRequestHeaders {
		h = strings.TrimSpace(h)
		if h == "" || strings.ContainsAny(h, " :\r\n") {
			return "invalid header name in the allow-list: " + strconv.Quote(h)
		}
		api.AllowedRequestHeaders[i] = http.CanonicalHeaderKey(h)
	}
	for _, h := range api.InjectHeaders {
		if name := strings.TrimSpace(h.Name); name == "" || strings.ContainsAny(name, " :\r\n") || strings.ContainsAny(h.Value, "\r\n") {
			return "invalid injected header " + strconv.Quote(h.Name)
		}
	}
	if api.OwnerGroupID != nil {
		if _, err := s.store.GetGroup(ctx, *api.OwnerGroupID); err != nil {
			return "owner group not found"
		}
	}
	return ""
}

func (s *Server) handleCreateAPI(w http.ResponseWriter, r *http.Request) {
	var payload models.APIDefinition
	if !decodeJSON(w, r, &payload) {
		return
	}
	auditTarget(r, "api", "", payload.Name)
	if msg := s.validateAPI(r.Context(), &payload); msg != "" {
		writeError(w, r, http.StatusBadRequest, msg)
		return
	}
	// Owning a new API hands its group api:<id>:manage; only someone who could
	// manage every API may give that to a group (api.create alone can't).
	if payload.OwnerGroupID != nil && !s.apiEngine(r).ManagesAllAPIs() {
		writeError(w, r, http.StatusForbidden, "only API administrators (api.manage) can set an owner group")
		return
	}
	id, err := s.store.CreateAPIDefinition(r.Context(), payload)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to create api (is the slug taken?)")
		return
	}
	auditTarget(r, "api", strconv.Itoa(id), payload.Name)
	writeJSON(w, http.StatusCreated, map[string]int{"id": id})
}

func (s *Server) handleUpdateAPI(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	auditTarget(r, "api", strconv.Itoa(id), "")
	if !s.apiEngine(r).CanManageAPI(id) {
		writeError(w, r, http.StatusForbidden, "you don't manage this API")
		return
	}
	before, err := s.store.GetAPIDefinition(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "api not found")
		return
	}
	var payload models.APIDefinition
	if !decodeJSON(w, r, &payload) {
		return
	}
	payload.ID = id
	auditTarget(r, "api", strconv.Itoa(id), before.Name)
	if msg := s.validateAPI(r.Context(), &payload); msg != "" {
		writeError(w, r, http.StatusBadRequest, msg)
		return
	}
	if !intPtrEqual(before.OwnerGroupID, payload.OwnerGroupID) && !s.apiEngine(r).ManagesAllAPIs() {
		writeError(w, r, http.StatusForbidden, "only API administrators (api.manage) can change the owner group")
		return
	}
	if payload.InjectHeaders == nil {
		// Older clients don't send the field: keep what is configured.
		existing, _ := s.store.GetAPIInjectHeaders(r.Context(), id)
		for name := range existing {
			payload.InjectHeaders = append(payload.InjectHeaders, models.HeaderValue{Name: name})
		}
	}
	if err := s.store.UpdateAPIDefinition(r.Context(), payload); err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to update api")
		return
	}
	auditChanges(r, before, payload, "id", "createdAt", "updatedAt", "lastSpecRefreshAt", "lastSpecStatus", "injectHeaders", "injectHeaderNames")
	for _, h := range payload.InjectHeaders {
		if h.Value != "" {
			auditChanged(r, "injectHeaders")
			break
		}
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleDeleteAPI(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	auditTarget(r, "api", strconv.Itoa(id), "")
	if !s.apiEngine(r).CanDeleteAPI(id) {
		writeError(w, r, http.StatusForbidden, "deleting this API needs api.delete or api:"+strconv.Itoa(id)+":delete")
		return
	}
	apiDef, err := s.store.GetAPIDefinition(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "api not found")
		return
	}
	auditTarget(r, "api", strconv.Itoa(id), apiDef.Name)
	if err := s.store.DeleteAPIDefinition(r.Context(), id); err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to delete api")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleRefreshAPISpec(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	auditTarget(r, "api", strconv.Itoa(id), "")
	if !s.apiEngine(r).CanManageAPI(id) {
		writeError(w, r, http.StatusForbidden, "you don't manage this API")
		return
	}
	apiDef, err := s.store.GetAPIDefinition(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "api not found")
		return
	}
	auditTarget(r, "api", strconv.Itoa(apiDef.ID), apiDef.Name)
	cache, err := s.refreshSpec(r.Context(), *apiDef)
	if err != nil {
		// API managers need the reason (DNS, TLS, status code, parse error) to fix the
		// definition, so the detail is returned here, unlike on the viewer endpoints.
		writeError(w, r, http.StatusBadGateway, "spec refresh failed: "+err.Error())
		return
	}
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

func (s *Server) handleGetAPIAccess(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	if !s.apiEngine(r).CanManageAPI(id) {
		writeError(w, r, http.StatusForbidden, "you don't manage this API")
		return
	}
	access, err := s.store.ListAPIAccess(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load access")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": access})
}

// handleSetAPIAccess lets an API's managers decide which groups may view or call
// it, without touching roles. The grant is limited to this one API, so an
// api:<id>:manage holder can give it to any group.
func (s *Server) handleSetAPIAccess(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	auditTarget(r, "api", strconv.Itoa(id), "")
	if !s.apiEngine(r).CanManageAPI(id) {
		writeError(w, r, http.StatusForbidden, "you don't manage this API")
		return
	}
	apiDef, err := s.store.GetAPIDefinition(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "api not found")
		return
	}
	auditTarget(r, "api", strconv.Itoa(id), apiDef.Name)
	var payload []models.APIAccess
	if !decodeJSON(w, r, &payload) {
		return
	}
	for _, a := range payload {
		if a.Level != "view" && a.Level != "invoke" {
			writeError(w, r, http.StatusBadRequest, "level must be view or invoke")
			return
		}
		if _, err := s.store.GetGroup(r.Context(), a.GroupID); err != nil {
			writeError(w, r, http.StatusBadRequest, "group "+strconv.Itoa(a.GroupID)+" not found")
			return
		}
	}
	if err := s.store.SetAPIAccess(r.Context(), id, payload); err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to update access")
		return
	}
	auditDetail(r, "access", payload)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func intPtrEqual(a, b *int) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

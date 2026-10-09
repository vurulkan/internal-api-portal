package api

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"api-portal/backend/internal/models"
	"api-portal/backend/internal/netguard"
	"api-portal/backend/internal/proxy"
	"api-portal/backend/internal/rbac"
)

func (s *Server) handleCatalog(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.identityForRequest(r)
	if !ok {
		writeError(w, r, http.StatusUnauthorized, "unauthorized")
		return
	}
	engine := rbac.New(identity.User.IsAdmin, identity.Permissions)
	apis, err := s.store.ListAPIDefinitions(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load apis")
		return
	}
	var out []models.APISummary
	for _, api := range apis {
		summary := models.APISummary{
			ID: api.ID, Name: api.Name, Slug: api.Slug, Description: api.Description, IsActive: api.IsActive, TryItEnabled: api.TryItEnabled, OwnerTeam: api.OwnerTeam, Tags: api.Tags, LastSpecRefreshAt: api.LastSpecRefreshAt, LastSpecStatus: api.LastSpecStatus,
			CanView:   engine.CanViewAPI(api.ID),
			CanInvoke: engine.CanInvokeAPI(api.ID),
			CanManage: engine.CanManageAPI(api.ID),
		}
		if summary.CanView || summary.CanManage {
			out = append(out, summary)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleAPIDetails(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.identityForRequest(r)
	if !ok {
		writeError(w, r, http.StatusUnauthorized, "unauthorized")
		return
	}
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	apiDef, err := s.store.GetAPIDefinition(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "api not found")
		return
	}
	engine := rbac.New(identity.User.IsAdmin, identity.Permissions)
	if !engine.CanViewAPI(apiDef.ID) && !engine.CanManageAPI(apiDef.ID) {
		writeError(w, r, http.StatusForbidden, "forbidden")
		return
	}
	s.recordAudit(r, models.AuditLog{User: identity.User.Username, Action: "api.view", ResourceType: "api", ResourceID: strconv.Itoa(apiDef.ID), ResourceName: apiDef.Name, StatusCode: http.StatusOK})
	writeJSON(w, http.StatusOK, map[string]any{
		"id": apiDef.ID, "name": apiDef.Name, "slug": apiDef.Slug, "description": apiDef.Description, "isActive": apiDef.IsActive, "tryItEnabled": apiDef.TryItEnabled, "allowedMethods": apiDef.AllowedMethods, "allowedPathPrefixes": apiDef.AllowedPathPrefixes, "ownerTeam": apiDef.OwnerTeam, "tags": apiDef.Tags, "createdAt": apiDef.CreatedAt, "updatedAt": apiDef.UpdatedAt, "lastSpecRefreshAt": apiDef.LastSpecRefreshAt, "lastSpecStatus": apiDef.LastSpecStatus,
		"permissions": map[string]bool{"view": engine.CanViewAPI(apiDef.ID), "invoke": engine.CanInvokeAPI(apiDef.ID), "manage": engine.CanManageAPI(apiDef.ID)},
	})
}

func (s *Server) handleAPISpec(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.identityForRequest(r)
	if !ok {
		writeError(w, r, http.StatusUnauthorized, "unauthorized")
		return
	}
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	engine := rbac.New(identity.User.IsAdmin, identity.Permissions)
	if !engine.CanViewAPI(id) && !engine.CanManageAPI(id) {
		writeError(w, r, http.StatusForbidden, "forbidden")
		return
	}
	cache, err := s.store.GetSpecCache(r.Context(), id)
	// A row without spec_json is left over from a failed first fetch (pre-1.1.0); retry.
	if err == sql.ErrNoRows || (err == nil && len(cache.SpecJSON) == 0) {
		apiDef, apiErr := s.store.GetAPIDefinition(r.Context(), id)
		if apiErr != nil {
			writeError(w, r, http.StatusNotFound, "api not found")
			return
		}
		cache, err = s.refreshSpec(r.Context(), *apiDef)
	}
	if err != nil {
		// Viewers get no detail (it can name internal hosts); admins see it on refresh.
		writeError(w, r, http.StatusBadGateway, "the API's specification is currently unavailable")
		return
	}
	s.recordAudit(r, models.AuditLog{User: identity.User.Username, Action: "api.spec.view", ResourceType: "api", ResourceID: strconv.Itoa(id), StatusCode: http.StatusOK})
	w.Header().Set("Content-Type", "application/json")
	w.Write(cache.SpecJSON)
}

func (s *Server) handleInvoke(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.identityForRequest(r)
	if !ok {
		writeError(w, r, http.StatusUnauthorized, "unauthorized")
		return
	}
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	engine := rbac.New(identity.User.IsAdmin, identity.Permissions)
	if !engine.CanInvokeAPI(id) {
		s.recordAudit(r, models.AuditLog{User: identity.User.Username, Action: "api.invoke.blocked", ResourceType: "api", ResourceID: strconv.Itoa(id), Blocked: true, StatusCode: http.StatusForbidden})
		writeError(w, r, http.StatusForbidden, "forbidden")
		return
	}
	if !s.userLimiter(identity.User.ID).Allow() {
		w.Header().Set("Retry-After", "1")
		s.metrics.Invocations.Inc(strconv.Itoa(id), "rate_limited")
		writeError(w, r, http.StatusTooManyRequests, "rate limit exceeded; wait a moment and try again")
		return
	}
	var payload proxy.InvokeRequest
	if !decodeJSON(w, r, &payload) {
		return
	}
	apiDef, err := s.store.GetAPIDefinition(r.Context(), id)
	if err != nil || !apiDef.IsActive || !apiDef.TryItEnabled {
		writeError(w, r, http.StatusBadRequest, "api unavailable")
		return
	}
	start := time.Now()
	resp, sanitizedHeaders, err := s.proxy.Invoke(r.Context(), *apiDef, payload)
	apiLabel := strconv.Itoa(apiDef.ID)
	entry := models.AuditLog{
		User:            identity.User.Username,
		Action:          "api.invoke",
		ResourceType:    "api",
		ResourceID:      strconv.Itoa(apiDef.ID),
		ResourceName:    apiDef.Name,
		SourceIP:        s.clientIP(r),
		DurationMs:      time.Since(start).Milliseconds(),
		SanitizedHeader: marshalJSON(sanitizedHeaders),
	}
	entry.DetailsJSON = marshalJSON(map[string]any{"method": payload.Method, "path": payload.Path})
	if err != nil {
		status, message := invokeErrorResponse(err)
		entry.Blocked = status == http.StatusForbidden
		entry.ErrorMessage = err.Error()
		entry.StatusCode = status
		s.recordAudit(r, entry)
		s.metrics.Invocations.Inc(apiLabel, invokeOutcome(status))
		writeError(w, r, status, message)
		return
	}
	s.metrics.Invocations.Inc(apiLabel, "ok")
	s.metrics.UpstreamDuration.Observe(time.Since(start).Seconds(), apiLabel)
	entry.StatusCode = resp.StatusCode
	entry.RequestBytes = resp.RequestBytes
	entry.ResponseBytes = resp.ResponseBytes
	s.recordAudit(r, entry)
	writeJSON(w, http.StatusOK, resp)
}

func invokeOutcome(status int) string {
	switch status {
	case http.StatusForbidden:
		return "blocked"
	case http.StatusGatewayTimeout:
		return "timeout"
	default:
		return "upstream_error"
	}
}

// invokeErrorResponse maps a proxy error to what the caller sees. Policy refusals
// carry their reason; upstream failures get a generic message (the detail, which can
// name internal hosts, goes to the audit log only).
func invokeErrorResponse(err error) (int, string) {
	var policyErr *proxy.PolicyError
	if errors.As(err, &policyErr) {
		return http.StatusForbidden, policyErr.Reason
	}
	if errors.Is(err, netguard.ErrForbiddenAddress) {
		return http.StatusForbidden, "the upstream address is not allowed by the portal's network policy"
	}
	if errors.Is(err, context.DeadlineExceeded) || strings.Contains(err.Error(), "Client.Timeout") {
		return http.StatusGatewayTimeout, "the upstream did not answer in time"
	}
	return http.StatusBadGateway, "the upstream request failed"
}

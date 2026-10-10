package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
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
	identity, _ := s.identityForRequest(r)
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	auditTarget(r, "api", strconv.Itoa(id), "")
	if !rbac.New(identity.User.IsAdmin, identity.Permissions).CanInvokeAPI(id) {
		writeError(w, r, http.StatusForbidden, "you may not call this API")
		return
	}
	apiDef, err := s.store.GetAPIDefinition(r.Context(), id)
	if err != nil || !apiDef.IsActive || !apiDef.TryItEnabled {
		writeError(w, r, http.StatusBadRequest, "try-it is not available for this API")
		return
	}
	auditTarget(r, "api", strconv.Itoa(id), apiDef.Name)
	limiter, perMinute := s.invokeLimiter(identity.User.ID, apiDef)
	if !limiter.Allow() {
		wait := limiter.Reserve()
		delay := wait.Delay()
		wait.Cancel()
		w.Header().Set("Retry-After", retryAfterSeconds(delay))
		w.Header().Set("X-RateLimit-Limit", strconv.Itoa(perMinute))
		w.Header().Set("X-RateLimit-Remaining", "0")
		s.metrics.Invocations.Inc(strconv.Itoa(id), "rate_limited")
		writeError(w, r, http.StatusTooManyRequests, fmt.Sprintf("rate limit of %d calls per minute reached; try again in %s", perMinute, retryAfterSeconds(delay)+"s"))
		return
	}
	remaining := int(limiter.Tokens())
	w.Header().Set("X-RateLimit-Limit", strconv.Itoa(perMinute))
	w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(max(remaining, 0)))

	var payload proxy.InvokeRequest
	if !decodeJSON(w, r, &payload) {
		return
	}
	auditDetails(r, map[string]any{"method": strings.ToUpper(payload.Method), "path": payload.Path, "queryParams": queryParamNames(payload.Query)})
	inject, err := s.store.GetAPIInjectHeaders(r.Context(), id)
	if err != nil {
		slog.ErrorContext(r.Context(), "invoke.inject_headers", "error", err.Error())
		writeError(w, r, http.StatusInternalServerError, "the API's server-side headers can't be read; ask its owner to re-enter them")
		return
	}
	ctx := r.Context()
	if apiDef.TimeoutSeconds > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(apiDef.TimeoutSeconds)*time.Second)
		defer cancel()
	}
	start := time.Now()
	resp, sanitizedHeaders, err := s.proxy.Invoke(ctx, *apiDef, payload, inject)
	apiLabel := strconv.Itoa(apiDef.ID)
	auditFill(r, func(e *models.AuditLog) {
		e.SanitizedHeader = marshalJSON(sanitizedHeaders)
		if resp != nil {
			// The portal call succeeded; record what the upstream answered.
			e.StatusCode, e.RequestBytes, e.ResponseBytes = resp.StatusCode, resp.RequestBytes, resp.ResponseBytes
		}
	})
	if err != nil {
		status, message := invokeErrorResponse(err)
		if status == http.StatusForbidden {
			auditBlocked(r)
		}
		auditReason(r, err.Error())
		s.metrics.Invocations.Inc(apiLabel, invokeOutcome(status))
		writeError(w, r, status, message)
		return
	}
	s.metrics.Invocations.Inc(apiLabel, "ok")
	s.metrics.UpstreamDuration.Observe(time.Since(start).Seconds(), apiLabel)
	writeJSON(w, http.StatusOK, map[string]any{
		"statusCode": resp.StatusCode, "headers": resp.Headers, "bodyBase64": resp.BodyB64, "contentType": resp.ContentType,
		"truncated": resp.Truncated, "requestBytes": resp.RequestBytes, "responseBytes": resp.ResponseBytes,
		"durationMs": time.Since(start).Milliseconds(),
		"rateLimit":  map[string]int{"limitPerMinute": perMinute, "remaining": max(remaining, 0)},
	})
}

// queryParamNames lists the parameter names of a query string; values are left
// out of the audit log (they can carry tokens).
func queryParamNames(raw string) []string {
	values, err := url.ParseQuery(strings.TrimPrefix(raw, "?"))
	if err != nil {
		return nil
	}
	names := make([]string, 0, len(values))
	for name := range values {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
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

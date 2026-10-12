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
	"sigs.k8s.io/yaml"

	"api-portal/backend/internal/models"
	"api-portal/backend/internal/netguard"
	"api-portal/backend/internal/proxy"
	"api-portal/backend/internal/rbac"
)

// specState is what viewers learn about an API's spec: ok, error or missing.
// The error text itself (it can name internal hosts) goes only to managers.
func specState(api models.APIDefinition) (state, detail string) {
	switch {
	case strings.HasPrefix(api.LastSpecStatus, "error"):
		return "error", strings.TrimSpace(strings.TrimPrefix(api.LastSpecStatus, "error:"))
	case api.LastSpecRefreshAt == nil:
		return "missing", ""
	}
	return "ok", ""
}

func summarize(api models.APIDefinition, engine *rbac.Engine) models.APISummary {
	state, detail := specState(api)
	summary := models.APISummary{
		ID: api.ID, Name: api.Name, Slug: api.Slug, Description: api.Description, IsActive: api.IsActive, TryItEnabled: api.TryItEnabled,
		OwnerTeam: api.OwnerTeam, Tags: api.Tags, LastSpecRefreshAt: api.LastSpecRefreshAt, SpecState: state,
		SpecVersion: api.SpecVersion, OperationCount: api.OperationCount,
		CanView:   engine.CanViewAPI(api.ID),
		CanInvoke: engine.CanInvokeAPI(api.ID),
		CanManage: engine.CanManageAPI(api.ID),
	}
	if summary.CanManage {
		summary.SpecError = detail
	}
	return summary
}

// visibleAPIs are the APIs the user may see (view or manage), as summaries.
func (s *Server) visibleAPIs(r *http.Request, identity *models.Identity) ([]models.APISummary, error) {
	engine := rbac.New(identity.User.IsAdmin, identity.Permissions)
	apis, err := s.store.ListAPIDefinitions(r.Context())
	if err != nil {
		return nil, err
	}
	out := []models.APISummary{}
	for _, api := range apis {
		summary := summarize(api, engine)
		if summary.CanView || summary.CanManage {
			out = append(out, summary)
		}
	}
	return out, nil
}

func (s *Server) handleCatalog(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.identityForRequest(r)
	if !ok {
		writeError(w, r, http.StatusUnauthorized, "unauthorized")
		return
	}
	out, err := s.visibleAPIs(r, identity)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load apis")
		return
	}
	favorites, _ := s.store.Favorites(r.Context(), identity.User.ID)
	recent, _ := s.store.RecentAPIViews(r.Context(), identity.User.ID)
	for i := range out {
		out[i].Favorite = favorites[out[i].ID]
		if at, ok := recent[out[i].ID]; ok {
			out[i].LastViewedAt = &at
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// searchResult is an operation hit with the API it belongs to.
type searchResult struct {
	models.APIOperation
	APIName string `json:"apiName"`
	APISlug string `json:"apiSlug"`
}

// handleSearch finds APIs and operations the user may see. The permission filter
// runs here (only visible API ids reach the query), never in the browser.
func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.identityForRequest(r)
	if !ok {
		writeError(w, r, http.StatusUnauthorized, "unauthorized")
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if runes := []rune(query); len(runes) > 100 {
		query = string(runes[:100])
	}
	result := map[string]any{"query": query, "apis": []models.APISummary{}, "operations": []searchResult{}}
	if len([]rune(query)) < 2 {
		writeJSON(w, http.StatusOK, result)
		return
	}
	visible, err := s.visibleAPIs(r, identity)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "search failed")
		return
	}
	lower := strings.ToLower(query)
	byID := map[int]models.APISummary{}
	ids := make([]int, 0, len(visible))
	var nameHits, otherHits []models.APISummary
	for _, api := range visible {
		byID[api.ID] = api
		ids = append(ids, api.ID)
		switch {
		case strings.Contains(strings.ToLower(api.Name), lower) || strings.Contains(strings.ToLower(api.Slug), lower):
			nameHits = append(nameHits, api)
		case strings.Contains(strings.ToLower(api.Description), lower) || strings.Contains(strings.ToLower(api.OwnerTeam), lower) || containsFold(api.Tags, lower):
			otherHits = append(otherHits, api)
		}
	}
	apis := append(nameHits, otherHits...)
	if len(apis) > 20 {
		apis = apis[:20]
	}
	ops, err := s.store.SearchOperations(r.Context(), query, ids, 50)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "search failed")
		return
	}
	hits := make([]searchResult, 0, len(ops))
	for _, op := range ops {
		api := byID[op.APIID]
		hits = append(hits, searchResult{APIOperation: op, APIName: api.Name, APISlug: api.Slug})
	}
	if apis == nil {
		apis = []models.APISummary{}
	}
	result["apis"] = apis
	result["operations"] = hits
	writeJSON(w, http.StatusOK, result)
}

func containsFold(values []string, lower string) bool {
	for _, v := range values {
		if strings.Contains(strings.ToLower(v), lower) {
			return true
		}
	}
	return false
}

// handleSetFavorite stars (PUT) or unstars (DELETE) an API for the signed-in user.
func (s *Server) handleSetFavorite(w http.ResponseWriter, r *http.Request) {
	identity, _ := s.identityForRequest(r)
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	auditTarget(r, "api", strconv.Itoa(id), "")
	engine := rbac.New(identity.User.IsAdmin, identity.Permissions)
	if !engine.CanViewAPI(id) && !engine.CanManageAPI(id) {
		writeError(w, r, http.StatusForbidden, "forbidden")
		return
	}
	apiDef, err := s.store.GetAPIDefinition(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "api not found")
		return
	}
	auditTarget(r, "api", strconv.Itoa(id), apiDef.Name)
	if err := s.store.SetFavorite(r.Context(), identity.User.ID, id, r.Method == http.MethodPut); err != nil {
		writeError(w, r, http.StatusInternalServerError, "could not save the favorite")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"favorite": r.Method == http.MethodPut})
}

// resolveAPI finds the API of a {id} route parameter: a numeric id or the slug
// (the portal's own URLs use slugs: /apis/payments/operations/createCharge).
func (s *Server) resolveAPI(r *http.Request) (*models.APIDefinition, error) {
	ref := chi.URLParam(r, "id")
	if id, err := strconv.Atoi(ref); err == nil {
		return s.store.GetAPIDefinition(r.Context(), id)
	}
	return s.store.GetAPIDefinitionBySlug(r.Context(), ref)
}

func (s *Server) handleAPIDetails(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.identityForRequest(r)
	if !ok {
		writeError(w, r, http.StatusUnauthorized, "unauthorized")
		return
	}
	apiDef, err := s.resolveAPI(r)
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
	if err := s.store.RecordAPIView(r.Context(), identity.User.ID, apiDef.ID); err != nil {
		slog.WarnContext(r.Context(), "recent.record_failed", "error", err.Error())
	}
	favorites, _ := s.store.Favorites(r.Context(), identity.User.ID)
	summary := summarize(*apiDef, engine)
	// Header names only: the try-it console shows which headers the portal adds,
	// never their values.
	injected, _ := s.store.GetAPIInjectHeaders(r.Context(), apiDef.ID)
	injectNames := make([]string, 0, len(injected))
	for name := range injected {
		injectNames = append(injectNames, name)
	}
	sort.Strings(injectNames)
	body := map[string]any{
		"id": apiDef.ID, "name": apiDef.Name, "slug": apiDef.Slug, "description": apiDef.Description, "isActive": apiDef.IsActive, "tryItEnabled": apiDef.TryItEnabled, "allowedMethods": apiDef.AllowedMethods, "allowedPathPrefixes": apiDef.AllowedPathPrefixes, "ownerTeam": apiDef.OwnerTeam, "tags": apiDef.Tags, "createdAt": apiDef.CreatedAt, "updatedAt": apiDef.UpdatedAt, "lastSpecRefreshAt": apiDef.LastSpecRefreshAt,
		"specState": summary.SpecState, "specError": summary.SpecError, "specVersion": apiDef.SpecVersion, "operationCount": apiDef.OperationCount,
		"rateLimitPerMinute": apiDef.RateLimitPerMinute, "timeoutSeconds": apiDef.TimeoutSeconds, "favorite": favorites[apiDef.ID],
		"allowedRequestHeaders": nonNilStrings(apiDef.AllowedRequestHeaders), "forwardAllXHeaders": apiDef.ForwardAllXHeaders, "injectHeaderNames": injectNames,
		"permissions": map[string]bool{"view": engine.CanViewAPI(apiDef.ID), "invoke": engine.CanInvokeAPI(apiDef.ID), "manage": engine.CanManageAPI(apiDef.ID)},
	}
	// Internal URLs stay server-side for everyone but the API's managers.
	if summary.CanManage {
		body["internalBaseUrl"] = apiDef.InternalBaseURL
		body["internalOpenapiUrl"] = apiDef.InternalOpenAPIURL
	}
	writeJSON(w, http.StatusOK, body)
}

func nonNilStrings(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

// handleAPIActivity: the spec history (changes, failures) for the API's managers.
func (s *Server) handleAPIActivity(w http.ResponseWriter, r *http.Request) {
	identity, _ := s.identityForRequest(r)
	apiDef, err := s.resolveAPI(r)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "api not found")
		return
	}
	if !rbac.New(identity.User.IsAdmin, identity.Permissions).CanManageAPI(apiDef.ID) {
		writeError(w, r, http.StatusForbidden, "you don't manage this API")
		return
	}
	history, err := s.store.SpecHistory(r.Context(), apiDef.ID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load the history")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": history})
}

func (s *Server) handleAPISpec(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.identityForRequest(r)
	if !ok {
		writeError(w, r, http.StatusUnauthorized, "unauthorized")
		return
	}
	resolved, err := s.resolveAPI(r)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "api not found")
		return
	}
	id := resolved.ID
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
	s.recordAudit(r, models.AuditLog{User: identity.User.Username, Action: "api.spec.view", ResourceType: "api", ResourceID: strconv.Itoa(id), ResourceName: resolved.Name, StatusCode: http.StatusOK})
	// ?format=yaml converts; ?download=1 makes it a file ("payments.yaml").
	body, contentType, ext := []byte(cache.SpecJSON), "application/json", "json"
	if r.URL.Query().Get("format") == "yaml" {
		converted, err := yaml.JSONToYAML(cache.SpecJSON)
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, "could not convert the specification")
			return
		}
		body, contentType, ext = converted, "application/yaml", "yaml"
	}
	if r.URL.Query().Get("download") == "1" {
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.%s"`, resolved.Slug, ext))
	}
	w.Header().Set("Content-Type", contentType)
	w.Write(body)
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

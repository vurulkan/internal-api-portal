package api

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/time/rate"

	"api-portal/backend/internal/audit"
	"api-portal/backend/internal/auth"
	"api-portal/backend/internal/config"
	"api-portal/backend/internal/models"
	"api-portal/backend/internal/netguard"
	"api-portal/backend/internal/openapi"
	"api-portal/backend/internal/proxy"
	"api-portal/backend/internal/rbac"
	"api-portal/backend/internal/store"
)

type Server struct {
	store      *store.Store
	audit      *audit.Logger
	openapi    *openapi.Service
	proxy      *proxy.Service
	config     config.Config
	staticDir  string
	jwtKey     []byte
	timezone   *time.Location
	limiters   map[int]*rate.Limiter
	limitersMu sync.Mutex
	logins     *loginGate
	// dummyHash is checked when the user doesn't exist, so a failed login takes the
	// same time either way and doesn't reveal which usernames exist.
	dummyHash string
}

// minPasswordLength applies to every password set through the API. A full password
// policy (configurable length, common-password list) is planned for M4.
const minPasswordLength = 8

func NewServer(store *store.Store, auditLogger *audit.Logger, cfg config.Config) *Server {
	tz, err := time.LoadLocation(cfg.TimeZone)
	if err != nil {
		tz = time.UTC
	}
	guard := netguard.New(cfg.ProxyDenyCIDRs, cfg.ProxyAllowLoopback)
	random, _ := auth.RandomState()
	dummyHash, _ := auth.HashPassword(random)
	return &Server{
		store:     store,
		audit:     auditLogger,
		openapi:   openapi.New(store, guard.Client(cfg.ProxyTimeout, true)),
		proxy:     proxy.New(guard.Client(cfg.ProxyTimeout, false), cfg.MaxRequestBytes, cfg.MaxResponseBytes),
		config:    cfg,
		staticDir: cfg.StaticDir,
		jwtKey:    store.SigningKey(),
		timezone:  tz,
		limiters:  map[int]*rate.Limiter{},
		logins:    newLoginGate(),
		dummyHash: dummyHash,
	}
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(recoverMiddleware)
	r.Use(securityHeaders)
	r.Use(requestLogger)

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Post("/api/auth/login", s.handleLogin)
	r.Get("/api/auth/providers", s.handleAuthProviders)
	r.Get("/api/auth/azure/start", s.handleAzureStart)
	r.Get("/api/auth/azure/callback", s.handleAzureCallback)

	r.Get("/api/system/public", s.handlePublicSettings)

	r.Group(func(r chi.Router) {
		r.Use(auth.AuthMiddleware(s.jwtKey), s.requireSession)
		r.Get("/api/auth/me", s.handleMe)
		r.Post("/api/auth/change-password", s.handleChangePassword)
		r.Get("/api/catalog", s.handleCatalog)
		r.Get("/api/apis/{id}", s.handleAPIDetails)
		r.Get("/api/apis/{id}/spec", s.handleAPISpec)
		r.Post("/api/apis/{id}/invoke", s.handleInvoke)
	})

	r.Group(func(r chi.Router) {
		r.Use(auth.AuthMiddleware(s.jwtKey), s.requireSession)
		r.With(s.requirePermission("user.manage")).Get("/api/admin/users", s.handleListUsers)
		r.With(s.requirePermission("user.manage")).Post("/api/admin/users", s.handleCreateUser)
		r.With(s.requirePermission("user.manage")).Put("/api/admin/users/{id}", s.handleUpdateUser)
		r.With(s.requirePermission("user.manage")).Delete("/api/admin/users/{id}", s.handleDeleteUser)
		r.With(s.requirePermission("user.manage")).Get("/api/admin/users/{id}/groups", s.handleGetUserGroups)
		r.With(s.requirePermission("user.manage")).Put("/api/admin/users/{id}/groups", s.handleSetUserGroups)

		r.With(s.requirePermission("group.manage")).Get("/api/admin/groups", s.handleListGroups)
		r.With(s.requirePermission("group.manage")).Post("/api/admin/groups", s.handleCreateGroup)
		r.With(s.requirePermission("group.manage")).Put("/api/admin/groups/{id}", s.handleUpdateGroup)
		r.With(s.requirePermission("group.manage")).Delete("/api/admin/groups/{id}", s.handleDeleteGroup)
		r.With(s.requirePermission("group.manage")).Get("/api/admin/groups/{id}/roles", s.handleGetGroupRoles)
		r.With(s.requirePermission("group.manage")).Put("/api/admin/groups/{id}/roles", s.handleSetGroupRoles)

		r.With(s.requirePermission("role.manage")).Get("/api/admin/roles", s.handleListRoles)
		r.With(s.requirePermission("role.manage")).Post("/api/admin/roles", s.handleCreateRole)
		r.With(s.requirePermission("role.manage")).Put("/api/admin/roles/{id}", s.handleUpdateRole)
		r.With(s.requirePermission("role.manage")).Delete("/api/admin/roles/{id}", s.handleDeleteRole)
		r.With(s.requirePermission("role.manage")).Get("/api/admin/roles/{id}/permissions", s.handleRolePermissions)
		r.With(s.requirePermission("role.manage")).Post("/api/admin/roles/{id}/permissions", s.handleAddRolePermission)
		r.With(s.requirePermission("role.manage")).Put("/api/admin/roles/{id}/permissions", s.handleReplaceRolePermissions)
		r.With(s.requirePermission("role.manage")).Delete("/api/admin/permissions/{id}", s.handleDeletePermission)

		r.With(s.requirePermission("ldap.manage")).Get("/api/admin/ldap", s.handleGetLDAP)
		r.With(s.requirePermission("ldap.manage")).Put("/api/admin/ldap", s.handleUpdateLDAP)
		r.With(s.requirePermission("ldap.manage")).Post("/api/admin/ldap/test", s.handleTestLDAP)
		r.With(s.requirePermission("ldap.manage")).Post("/api/admin/ldap/search", s.handleSearchLDAP)
		r.With(s.requirePermission("ldap.manage")).Post("/api/admin/ldap/import", s.handleImportLDAP)

		r.With(s.requireAdmin).Get("/api/admin/azure-ad", s.handleGetAzureAD)
		r.With(s.requireAdmin).Put("/api/admin/azure-ad", s.handleUpdateAzureAD)
		r.With(s.requireAdmin).Post("/api/admin/azure-ad/test", s.handleTestAzureAD)

		r.With(s.requirePermission("api.manage")).Get("/api/admin/apis", s.handleAdminAPIs)
		r.With(s.requirePermission("api.manage")).Post("/api/admin/apis", s.handleCreateAPI)
		r.With(s.requirePermission("api.manage")).Put("/api/admin/apis/{id}", s.handleUpdateAPI)
		r.With(s.requirePermission("api.manage")).Delete("/api/admin/apis/{id}", s.handleDeleteAPI)
		r.With(s.requirePermission("api.manage")).Post("/api/admin/apis/{id}/refresh", s.handleRefreshAPISpec)

		r.With(s.requirePermission("audit.view")).Get("/api/admin/audit-logs", s.handleAuditLogs)
		r.With(s.requirePermission("audit.view")).Get("/api/admin/audit-logs/export", s.handleAuditLogsExport)

		r.With(s.requireAdmin).Get("/api/admin/session", s.handleGetSession)
		r.With(s.requireAdmin).Put("/api/admin/session", s.handleUpdateSession)

		r.With(s.requireAdmin).Get("/api/admin/system", s.handleGetSystem)
		r.With(s.requireAdmin).Put("/api/admin/system", s.handleUpdateSystem)
		r.With(s.requireAdmin).Post("/api/admin/system/logo", s.handleUploadSystemLogo)
		r.With(s.requireAdmin).Delete("/api/admin/system/logo", s.handleDeleteSystemLogo)
	})

	r.NotFound(s.notFound)
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
			s.notFound(w, r)
			return
		}
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	})
	return r
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &payload) {
		return
	}
	name := auditUsername(payload.Username)
	key := loginKey(s.clientIP(r), payload.Username)
	if wait := s.logins.locked(key); wait > 0 {
		w.Header().Set("Retry-After", retryAfterSeconds(wait))
		s.recordAudit(r, models.AuditLog{User: name, Action: "login.locked", ResourceType: "auth", Blocked: true, StatusCode: http.StatusTooManyRequests})
		http.Error(w, "too many failed sign-in attempts; try again in a few minutes", http.StatusTooManyRequests)
		return
	}
	user, reason := s.authenticate(r.Context(), payload.Username, payload.Password)
	if user == nil {
		s.recordAudit(r, models.AuditLog{User: name, Action: "login.failed", ResourceType: "auth", ErrorMessage: reason, StatusCode: http.StatusUnauthorized})
		if s.logins.fail(key) {
			s.recordAudit(r, models.AuditLog{User: name, Action: "login.locked", ResourceType: "auth", Blocked: true, StatusCode: http.StatusTooManyRequests, DetailsJSON: marshalJSON(map[string]any{"lockoutSeconds": int(loginLockout.Seconds())})})
		}
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	s.logins.succeed(key)
	token, err := auth.GenerateToken(s.jwtKey, user.ID, user.Username, s.sessionTTL(r.Context()))
	if err != nil {
		http.Error(w, "token error", http.StatusInternalServerError)
		return
	}
	s.recordAudit(r, models.AuditLog{User: user.Username, Action: "login.success", ResourceType: "auth", StatusCode: http.StatusOK})
	writeJSON(w, http.StatusOK, map[string]any{"token": token})
}

// authenticate checks a username/password login. On failure it returns a nil user and
// the reason for the audit log (never shown to the caller).
func (s *Server) authenticate(ctx context.Context, username, password string) (*models.User, string) {
	user, err := s.store.GetUserByUsername(ctx, username)
	if err != nil {
		_ = auth.ComparePassword(s.dummyHash, password)
		return nil, "user not found"
	}
	if !user.IsActive {
		_ = auth.ComparePassword(s.dummyHash, password)
		return nil, "user inactive"
	}
	switch user.AuthSource {
	case "ldap":
		cfg, err := s.store.GetLDAPConfig(ctx)
		if err != nil {
			return nil, "ldap config unavailable"
		}
		if err := auth.LDAPAuthenticate(*cfg, username, password); err != nil {
			return nil, "ldap auth failed: " + err.Error()
		}
	case "azuread":
		_ = auth.ComparePassword(s.dummyHash, password)
		return nil, "azure ad account; password login not allowed"
	default:
		if err := auth.ComparePassword(user.PasswordHash, password); err != nil {
			return nil, "local auth failed"
		}
	}
	return user, ""
}

func (s *Server) sessionTTL(ctx context.Context) time.Duration {
	ttl := time.Duration(s.config.SessionMinutes) * time.Minute
	if session, err := s.store.GetSessionSettings(ctx); err == nil && session.SessionMinutes > 0 {
		ttl = time.Duration(session.SessionMinutes) * time.Minute
	}
	return ttl
}

func (s *Server) handleAuthProviders(w http.ResponseWriter, r *http.Request) {
	ldapCfg, _ := s.store.GetLDAPConfig(r.Context())
	azureCfg, _ := s.store.GetAzureADConfig(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{
		"local":   true,
		"ldap":    ldapCfg != nil && ldapCfg.Enabled,
		"azureAd": azureCfg != nil && azureCfg.Enabled,
	})
}

func (s *Server) handleAzureStart(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.store.GetAzureADConfig(r.Context())
	if err != nil || cfg == nil || !cfg.Enabled {
		http.Error(w, "azure ad not configured", http.StatusBadRequest)
		return
	}
	state, err := auth.RandomState()
	if err != nil {
		http.Error(w, "failed to initialize azure login", http.StatusInternalServerError)
		return
	}
	nonce, err := auth.RandomState()
	if err != nil {
		http.Error(w, "failed to initialize azure login", http.StatusInternalServerError)
		return
	}
	authURL, err := auth.AzureADAuthURL(*cfg, state, nonce)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	s.setEphemeralCookie(w, r, "azuread_state", state)
	s.setEphemeralCookie(w, r, "azuread_nonce", nonce)
	http.Redirect(w, r, authURL, http.StatusFound)
}

func (s *Server) handleAzureCallback(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.store.GetAzureADConfig(r.Context())
	if err != nil || cfg == nil || !cfg.Enabled {
		http.Error(w, "azure ad not configured", http.StatusBadRequest)
		return
	}
	if r.URL.Query().Get("state") == "" || r.URL.Query().Get("state") != cookieValue(r, "azuread_state") {
		http.Error(w, "invalid azure ad state", http.StatusBadRequest)
		return
	}
	if errText := r.URL.Query().Get("error"); errText != "" {
		http.Error(w, errText, http.StatusBadRequest)
		return
	}
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if code == "" {
		http.Error(w, "missing azure ad code", http.StatusBadRequest)
		return
	}
	azureUser, err := auth.AzureADExchangeCode(r.Context(), *cfg, code, cookieValue(r, "azuread_nonce"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	user, err := s.userForAzureLogin(r.Context(), azureUser)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	s.clearCookie(w, r, "azuread_state")
	s.clearCookie(w, r, "azuread_nonce")
	if !user.IsActive {
		s.recordAudit(r, models.AuditLog{User: user.Username, Action: "login.azure.denied", ResourceType: "auth", ErrorMessage: "user inactive", Blocked: true, StatusCode: http.StatusForbidden})
		http.Error(w, "your portal account is disabled; contact an administrator", http.StatusForbidden)
		return
	}
	token, err := auth.GenerateToken(s.jwtKey, user.ID, user.Username, s.sessionTTL(r.Context()))
	if err != nil {
		http.Error(w, "token error", http.StatusInternalServerError)
		return
	}
	s.recordAudit(r, models.AuditLog{User: user.Username, Action: "login.success", ResourceType: "auth", StatusCode: http.StatusOK})
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(fmt.Sprintf(`<!doctype html><html><body><script>localStorage.setItem("api_portal_token", %q); window.location.replace("/");</script></body></html>`, token)))
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.identityForRequest(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	settings, _ := s.store.GetSystemSettings(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{
		"user":        identity.User,
		"permissions": identity.Permissions,
		"groupIds":    identity.GroupIDs,
		"branding":    settings,
	})
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.identityForRequest(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if identity.User.AuthSource != "local" {
		http.Error(w, "password changes supported only for local users", http.StatusBadRequest)
		return
	}
	var payload struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if !decodeJSON(w, r, &payload) {
		return
	}
	if err := auth.ComparePassword(identity.User.PasswordHash, payload.CurrentPassword); err != nil {
		s.recordAudit(r, models.AuditLog{User: identity.User.Username, Action: "user.password.change.failed", ResourceType: "user", ResourceID: strconv.Itoa(identity.User.ID), ErrorMessage: "current password incorrect", StatusCode: http.StatusBadRequest})
		// 400, not 401: the session itself is fine, and the UI treats 401 as "signed out".
		http.Error(w, "current password is incorrect", http.StatusBadRequest)
		return
	}
	if msg := passwordProblem(payload.NewPassword); msg != "" {
		http.Error(w, msg, http.StatusBadRequest)
		return
	}
	if payload.NewPassword == payload.CurrentPassword {
		http.Error(w, "the new password must differ from the current one", http.StatusBadRequest)
		return
	}
	hash, err := auth.HashPassword(payload.NewPassword)
	if err != nil {
		http.Error(w, "failed to update password", http.StatusInternalServerError)
		return
	}
	if err := s.store.UpdateUserPassword(r.Context(), identity.User.ID, hash, false); err != nil {
		http.Error(w, "failed to update password", http.StatusInternalServerError)
		return
	}
	s.recordAudit(r, models.AuditLog{User: identity.User.Username, Action: "user.password.changed", ResourceType: "user", ResourceID: strconv.Itoa(identity.User.ID), ResourceName: identity.User.Username, StatusCode: http.StatusOK})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handlePublicSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.store.GetSystemSettings(r.Context())
	if err != nil {
		http.Error(w, "failed to load settings", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleCatalog(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.identityForRequest(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	engine := rbac.New(identity.User.IsAdmin, identity.Permissions)
	apis, err := s.store.ListAPIDefinitions(r.Context())
	if err != nil {
		http.Error(w, "failed to load apis", http.StatusInternalServerError)
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
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	apiDef, err := s.store.GetAPIDefinition(r.Context(), id)
	if err != nil {
		http.Error(w, "api not found", http.StatusNotFound)
		return
	}
	engine := rbac.New(identity.User.IsAdmin, identity.Permissions)
	if !engine.CanViewAPI(apiDef.ID) && !engine.CanManageAPI(apiDef.ID) {
		http.Error(w, "forbidden", http.StatusForbidden)
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
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	engine := rbac.New(identity.User.IsAdmin, identity.Permissions)
	if !engine.CanViewAPI(id) && !engine.CanManageAPI(id) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	cache, err := s.store.GetSpecCache(r.Context(), id)
	// A row without spec_json is left over from a failed first fetch (pre-1.1.0); retry.
	if err == sql.ErrNoRows || (err == nil && len(cache.SpecJSON) == 0) {
		apiDef, apiErr := s.store.GetAPIDefinition(r.Context(), id)
		if apiErr != nil {
			http.Error(w, "api not found", http.StatusNotFound)
			return
		}
		cache, err = s.openapi.Refresh(r.Context(), *apiDef)
	}
	if err != nil {
		http.Error(w, "spec unavailable", http.StatusBadGateway)
		return
	}
	s.recordAudit(r, models.AuditLog{User: identity.User.Username, Action: "api.spec.view", ResourceType: "api", ResourceID: strconv.Itoa(id), StatusCode: http.StatusOK})
	w.Header().Set("Content-Type", "application/json")
	w.Write(cache.SpecJSON)
}

func (s *Server) handleInvoke(w http.ResponseWriter, r *http.Request) {
	identity, ok := s.identityForRequest(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	engine := rbac.New(identity.User.IsAdmin, identity.Permissions)
	if !engine.CanInvokeAPI(id) {
		s.recordAudit(r, models.AuditLog{User: identity.User.Username, Action: "api.invoke.blocked", ResourceType: "api", ResourceID: strconv.Itoa(id), Blocked: true, StatusCode: http.StatusForbidden})
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if !s.userLimiter(identity.User.ID).Allow() {
		w.Header().Set("Retry-After", "1")
		http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
		return
	}
	var payload proxy.InvokeRequest
	if !decodeJSON(w, r, &payload) {
		return
	}
	apiDef, err := s.store.GetAPIDefinition(r.Context(), id)
	if err != nil || !apiDef.IsActive || !apiDef.TryItEnabled {
		http.Error(w, "api unavailable", http.StatusBadRequest)
		return
	}
	start := time.Now()
	resp, sanitizedHeaders, err := s.proxy.Invoke(r.Context(), *apiDef, payload)
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
		http.Error(w, message, status)
		return
	}
	entry.StatusCode = resp.StatusCode
	entry.RequestBytes = resp.RequestBytes
	entry.ResponseBytes = resp.ResponseBytes
	s.recordAudit(r, entry)
	writeJSON(w, http.StatusOK, resp)
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

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		http.Error(w, "failed to load users", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	actor, _ := s.identityForRequest(r)
	var payload struct {
		Username           string `json:"username"`
		DisplayName        string `json:"displayName"`
		Email              string `json:"email"`
		Password           string `json:"password"`
		IsAdmin            bool   `json:"isAdmin"`
		MustChangePassword bool   `json:"mustChangePassword"`
	}
	if !decodeJSON(w, r, &payload) {
		return
	}
	payload.Username = strings.TrimSpace(payload.Username)
	if payload.Username == "" {
		http.Error(w, "username is required", http.StatusBadRequest)
		return
	}
	if msg := passwordProblem(payload.Password); msg != "" {
		http.Error(w, msg, http.StatusBadRequest)
		return
	}
	if payload.IsAdmin && !actor.User.IsAdmin {
		s.denyAudit(r, "non-admin tried to create an administrator", marshalJSON(map[string]string{"username": payload.Username}))
		http.Error(w, "only administrators can create administrator accounts", http.StatusForbidden)
		return
	}
	hash, err := auth.HashPassword(payload.Password)
	if err != nil {
		http.Error(w, "failed to create user", http.StatusInternalServerError)
		return
	}
	id, err := s.store.CreateUser(r.Context(), models.User{
		Username:           payload.Username,
		DisplayName:        strings.TrimSpace(payload.DisplayName),
		Email:              strings.TrimSpace(payload.Email),
		PasswordHash:       hash,
		AuthSource:         "local",
		MustChangePassword: payload.MustChangePassword,
		IsActive:           true,
		IsAdmin:            payload.IsAdmin,
	})
	if err != nil {
		http.Error(w, "failed to create user (is the username taken?)", http.StatusBadRequest)
		return
	}
	s.recordAudit(r, models.AuditLog{Action: "admin.user.create", ResourceType: "user", ResourceID: strconv.Itoa(id), ResourceName: payload.Username, StatusCode: http.StatusCreated, DetailsJSON: marshalJSON(map[string]bool{"isAdmin": payload.IsAdmin})})
	writeJSON(w, http.StatusCreated, map[string]int{"id": id})
}

func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	actor, _ := s.identityForRequest(r)
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	var request struct {
		models.User
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &request) {
		return
	}
	target, err := s.store.GetUserByID(r.Context(), id)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	request.ID = id
	request.Username = strings.TrimSpace(request.Username)
	if request.Username == "" {
		http.Error(w, "username is required", http.StatusBadRequest)
		return
	}
	if (target.IsAdmin || request.IsAdmin) && !actor.User.IsAdmin {
		s.denyAudit(r, "non-admin tried to change an administrator account", marshalJSON(map[string]any{"userId": id}))
		http.Error(w, "only administrators can manage administrator accounts", http.StatusForbidden)
		return
	}
	if msg := s.adminChangeProblem(r.Context(), actor, target, request.IsAdmin, request.IsActive); msg != "" {
		http.Error(w, msg, http.StatusConflict)
		return
	}
	if request.Password != "" {
		if target.AuthSource != "local" {
			http.Error(w, "passwords can only be set for local users", http.StatusBadRequest)
			return
		}
		if msg := passwordProblem(request.Password); msg != "" {
			http.Error(w, msg, http.StatusBadRequest)
			return
		}
	}
	if err := s.store.UpdateUser(r.Context(), request.User); err != nil {
		http.Error(w, "failed to update user", http.StatusBadRequest)
		return
	}
	if request.Password != "" {
		hash, err := auth.HashPassword(request.Password)
		if err != nil {
			http.Error(w, "failed to update password", http.StatusInternalServerError)
			return
		}
		if err := s.store.UpdateUserPassword(r.Context(), id, hash, request.MustChangePassword); err != nil {
			http.Error(w, "failed to update password", http.StatusInternalServerError)
			return
		}
	}
	s.recordAudit(r, models.AuditLog{Action: "admin.user.update", ResourceType: "user", ResourceID: strconv.Itoa(id), ResourceName: request.Username, StatusCode: http.StatusOK,
		DetailsJSON: marshalJSON(map[string]any{"isAdmin": request.IsAdmin, "isActive": request.IsActive, "passwordChanged": request.Password != ""})})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// adminChangeProblem enforces the account-safety rules shared by update and delete:
// nobody deactivates, demotes or deletes themselves, and the last active admin stays.
// remainAdmin / remainActive describe the target after the change (false, false for delete).
func (s *Server) adminChangeProblem(ctx context.Context, actor *models.Identity, target *models.User, remainAdmin, remainActive bool) string {
	if target.ID == actor.User.ID {
		if !remainActive {
			return "you can't deactivate or delete your own account"
		}
		if target.IsAdmin && !remainAdmin {
			return "you can't remove your own administrator rights"
		}
	}
	if target.IsAdmin && target.IsActive && (!remainAdmin || !remainActive) {
		count, err := s.store.CountActiveAdmins(ctx)
		if err != nil || count <= 1 {
			return "this is the last active administrator; promote another user first"
		}
	}
	return ""
}

// passwordProblem returns why a new password is refused, or "" if it is acceptable.
// Passwords are taken as typed: no trimming.
func passwordProblem(password string) string {
	if strings.TrimSpace(password) == "" {
		return "password is required"
	}
	if len([]rune(password)) < minPasswordLength {
		return fmt.Sprintf("password must be at least %d characters", minPasswordLength)
	}
	if len(password) > 256 {
		return "password is too long"
	}
	return ""
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	actor, _ := s.identityForRequest(r)
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	target, err := s.store.GetUserByID(r.Context(), id)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	if target.IsAdmin && !actor.User.IsAdmin {
		s.denyAudit(r, "non-admin tried to delete an administrator", marshalJSON(map[string]any{"userId": id}))
		http.Error(w, "only administrators can delete administrator accounts", http.StatusForbidden)
		return
	}
	if msg := s.adminChangeProblem(r.Context(), actor, target, false, false); msg != "" {
		http.Error(w, msg, http.StatusConflict)
		return
	}
	if err := s.store.DeleteUser(r.Context(), id); err != nil {
		http.Error(w, "failed to delete user", http.StatusBadRequest)
		return
	}
	s.recordAudit(r, models.AuditLog{Action: "admin.user.delete", ResourceType: "user", ResourceID: strconv.Itoa(id), ResourceName: target.Username, StatusCode: http.StatusOK})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleGetUserGroups(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	ids, err := s.store.GetUserGroupIDs(r.Context(), id)
	if err != nil {
		http.Error(w, "failed to load user groups", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, ids)
}

func (s *Server) handleSetUserGroups(w http.ResponseWriter, r *http.Request) {
	actor, _ := s.identityForRequest(r)
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	var payload []int
	if !decodeJSON(w, r, &payload) {
		return
	}
	target, err := s.store.GetUserByID(r.Context(), id)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	if target.IsAdmin && !actor.User.IsAdmin {
		s.denyAudit(r, "non-admin tried to change an administrator's groups", marshalJSON(map[string]any{"userId": id}))
		http.Error(w, "only administrators can manage administrator accounts", http.StatusForbidden)
		return
	}
	current, err := s.store.GetUserGroupIDs(r.Context(), id)
	if err != nil {
		http.Error(w, "failed to load user groups", http.StatusInternalServerError)
		return
	}
	if !s.allowGrant(w, r, actor, func() ([]string, error) { return s.store.ScopesForGroups(r.Context(), addedIDs(current, payload)) }) {
		return
	}
	if err := s.store.SetUserGroups(r.Context(), id, payload); err != nil {
		http.Error(w, "failed to update user groups", http.StatusBadRequest)
		return
	}
	s.recordAudit(r, models.AuditLog{Action: "admin.user.groups.update", ResourceType: "user", ResourceID: strconv.Itoa(id), ResourceName: target.Username, StatusCode: http.StatusOK, DetailsJSON: marshalJSON(payload)})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// allowGrant checks that a delegated manager only hands out scopes they hold
// themselves; scopes() returns the scopes the change would newly grant. It writes the
// 403 and the audit entry itself and returns false when the change is refused.
func (s *Server) allowGrant(w http.ResponseWriter, r *http.Request, actor *models.Identity, scopes func() ([]string, error)) bool {
	if actor.User.IsAdmin {
		return true
	}
	granted, err := scopes()
	if err != nil {
		http.Error(w, "failed to resolve permissions", http.StatusInternalServerError)
		return false
	}
	if missing := scopesBeyondActor(actor, granted); len(missing) > 0 {
		s.denyAudit(r, "grant exceeds the actor's own permissions", marshalJSON(map[string]any{"scopes": missing}))
		http.Error(w, "you can only grant permissions you hold yourself; missing: "+strings.Join(missing, ", "), http.StatusForbidden)
		return false
	}
	return true
}

func addedIDs(current, next []int) []int {
	have := make(map[int]bool, len(current))
	for _, id := range current {
		have[id] = true
	}
	var added []int
	for _, id := range next {
		if !have[id] {
			added = append(added, id)
		}
	}
	return added
}

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

func (s *Server) handleListRoles(w http.ResponseWriter, r *http.Request) {
	roles, err := s.store.ListRoles(r.Context())
	if err != nil {
		http.Error(w, "failed to load roles", http.StatusInternalServerError)
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
		http.Error(w, "failed to create role", http.StatusBadRequest)
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
		http.Error(w, "failed to update role", http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleDeleteRole(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	if err := s.store.DeleteRole(r.Context(), id); err != nil {
		http.Error(w, "failed to delete role", http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleRolePermissions(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	perms, err := s.store.ListRolePermissions(r.Context(), id)
	if err != nil {
		http.Error(w, "failed to load permissions", http.StatusInternalServerError)
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
		http.Error(w, "scope is required", http.StatusBadRequest)
		return
	}
	if !s.allowGrant(w, r, actor, func() ([]string, error) { return []string{payload.Scope}, nil }) {
		return
	}
	if err := s.store.AddRolePermission(r.Context(), id, payload.Scope, payload.Description); err != nil {
		http.Error(w, "failed to add permission", http.StatusBadRequest)
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
		http.Error(w, "failed to replace permissions", http.StatusBadRequest)
		return
	}
	s.recordAudit(r, models.AuditLog{User: s.usernameOrAnonymous(r), Action: "admin.role.permissions.replace", ResourceType: "role", ResourceID: strconv.Itoa(id), StatusCode: http.StatusOK, DetailsJSON: marshalJSON(payload.Scopes)})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleDeletePermission(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	if err := s.store.DeletePermission(r.Context(), id); err != nil {
		http.Error(w, "failed to delete permission", http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleGetLDAP(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.store.GetLDAPConfig(r.Context())
	if err != nil {
		http.Error(w, "failed to load ldap config", http.StatusInternalServerError)
		return
	}
	cfg.BindPassword = ""
	writeJSON(w, http.StatusOK, cfg)
}

func (s *Server) handleUpdateLDAP(w http.ResponseWriter, r *http.Request) {
	var payload models.LDAPConfig
	if !decodeJSON(w, r, &payload) {
		return
	}
	if err := auth.ValidateUserFilter(payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := s.store.UpdateLDAPConfig(r.Context(), payload); err != nil {
		http.Error(w, "failed to update ldap config", http.StatusBadRequest)
		return
	}
	s.recordAudit(r, models.AuditLog{User: s.usernameOrAnonymous(r), Action: "admin.ldap.update", ResourceType: "ldap", StatusCode: http.StatusOK})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleTestLDAP(w http.ResponseWriter, r *http.Request) {
	var payload models.LDAPConfig
	if !decodeJSON(w, r, &payload) {
		return
	}
	if payload.BindPassword == "" {
		existing, _ := s.store.GetLDAPConfig(r.Context())
		if existing != nil {
			payload.BindPassword = existing.BindPassword
		}
	}
	if err := auth.TestLDAPConnection(payload); err != nil {
		s.recordAudit(r, models.AuditLog{User: s.usernameOrAnonymous(r), Action: "admin.ldap.test", ResourceType: "ldap", ErrorMessage: err.Error(), StatusCode: http.StatusBadRequest})
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	s.recordAudit(r, models.AuditLog{User: s.usernameOrAnonymous(r), Action: "admin.ldap.test", ResourceType: "ldap", StatusCode: http.StatusOK})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleSearchLDAP(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Query string `json:"query"`
	}
	if !decodeJSON(w, r, &payload) {
		return
	}
	cfg, err := s.store.GetLDAPConfig(r.Context())
	if err != nil {
		http.Error(w, "failed to load ldap config", http.StatusInternalServerError)
		return
	}
	users, err := auth.SearchLDAPUsers(*cfg, payload.Query)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func (s *Server) handleImportLDAP(w http.ResponseWriter, r *http.Request) {
	var payload []models.LDAPUser
	if !decodeJSON(w, r, &payload) {
		return
	}
	if err := s.store.ImportLDAPUsers(r.Context(), payload); err != nil {
		http.Error(w, "failed to import users", http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleGetAzureAD(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.store.GetAzureADConfig(r.Context())
	if err != nil {
		http.Error(w, "failed to load azure ad config", http.StatusInternalServerError)
		return
	}
	cfg.ClientSecret = ""
	writeJSON(w, http.StatusOK, cfg)
}

func (s *Server) handleUpdateAzureAD(w http.ResponseWriter, r *http.Request) {
	var payload models.AzureADConfig
	if !decodeJSON(w, r, &payload) {
		return
	}
	if err := s.store.UpdateAzureADConfig(r.Context(), payload); err != nil {
		http.Error(w, "failed to update azure ad config", http.StatusBadRequest)
		return
	}
	s.recordAudit(r, models.AuditLog{User: s.usernameOrAnonymous(r), Action: "admin.azuread.update", ResourceType: "azuread", StatusCode: http.StatusOK})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleTestAzureAD(w http.ResponseWriter, r *http.Request) {
	var payload models.AzureADConfig
	if !decodeJSON(w, r, &payload) {
		return
	}
	if payload.ClientSecret == "" {
		existing, _ := s.store.GetAzureADConfig(r.Context())
		if existing != nil {
			payload.ClientSecret = existing.ClientSecret
		}
	}
	if err := auth.TestAzureADConnection(r.Context(), payload); err != nil {
		s.recordAudit(r, models.AuditLog{User: s.usernameOrAnonymous(r), Action: "admin.azuread.test", ResourceType: "azuread", ErrorMessage: err.Error(), StatusCode: http.StatusBadRequest})
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	s.recordAudit(r, models.AuditLog{User: s.usernameOrAnonymous(r), Action: "admin.azuread.test", ResourceType: "azuread", StatusCode: http.StatusOK})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

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

func (s *Server) handleAuditLogs(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(defaultString(r.URL.Query().Get("limit"), "25"))
	offset, _ := strconv.Atoi(defaultString(r.URL.Query().Get("offset"), "0"))
	limit = clampInt(limit, 1, 500)
	offset = clampInt(offset, 0, 1<<30)
	logs, total, err := s.store.ListAuditLogs(r.Context(), limit, offset, r.URL.Query().Get("action"), r.URL.Query().Get("user"))
	if err != nil {
		http.Error(w, "failed to load audit logs", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":  logs,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (s *Server) handleAuditLogsExport(w http.ResponseWriter, r *http.Request) {
	logs, _, err := s.store.ListAuditLogs(r.Context(), 5000, 0, r.URL.Query().Get("action"), r.URL.Query().Get("user"))
	if err != nil {
		http.Error(w, "failed to export audit logs", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", `attachment; filename="audit-logs.csv"`)
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"timestamp", "user", "action", "resourceType", "resourceId", "resourceName", "statusCode", "durationMs", "blocked", "errorMessage"})
	for _, entry := range logs {
		_ = writer.Write([]string{entry.Timestamp.In(s.timezone).Format(time.RFC3339), csvCell(entry.User), csvCell(entry.Action), csvCell(entry.ResourceType), csvCell(entry.ResourceID), csvCell(entry.ResourceName), strconv.Itoa(entry.StatusCode), strconv.FormatInt(entry.DurationMs, 10), strconv.FormatBool(entry.Blocked), csvCell(entry.ErrorMessage)})
	}
	writer.Flush()
}

func (s *Server) handleGetSession(w http.ResponseWriter, r *http.Request) {
	session, err := s.store.GetSessionSettings(r.Context())
	if err != nil {
		http.Error(w, "failed to load session settings", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (s *Server) handleUpdateSession(w http.ResponseWriter, r *http.Request) {
	var session models.SessionSettings
	if !decodeJSON(w, r, &session) {
		return
	}
	if session.SessionMinutes < 5 {
		http.Error(w, "session timeout too low", http.StatusBadRequest)
		return
	}
	if err := s.store.UpdateSessionSettings(r.Context(), session); err != nil {
		http.Error(w, "failed to update session settings", http.StatusBadRequest)
		return
	}
	s.recordAudit(r, models.AuditLog{Action: "admin.session.update", ResourceType: "settings", StatusCode: http.StatusOK, DetailsJSON: marshalJSON(session)})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleGetSystem(w http.ResponseWriter, r *http.Request) {
	settings, err := s.store.GetSystemSettings(r.Context())
	if err != nil {
		http.Error(w, "failed to load settings", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

// handleUpdateSystem changes the brand title. The logo is only changed through the
// upload / delete endpoints, which validate the image; a logoDataUrl in this payload
// is ignored.
func (s *Server) handleUpdateSystem(w http.ResponseWriter, r *http.Request) {
	var payload models.SystemSettings
	if !decodeJSON(w, r, &payload) {
		return
	}
	title := strings.TrimSpace(payload.BrandTitle)
	if len([]rune(title)) > 100 {
		http.Error(w, "brand title is too long (max 100 characters)", http.StatusBadRequest)
		return
	}
	settings, err := s.store.GetSystemSettings(r.Context())
	if err != nil {
		http.Error(w, "failed to load settings", http.StatusInternalServerError)
		return
	}
	settings.BrandTitle = title
	if err := s.store.UpdateSystemSettings(r.Context(), *settings); err != nil {
		http.Error(w, "failed to update settings", http.StatusBadRequest)
		return
	}
	s.recordAudit(r, models.AuditLog{Action: "admin.system.update", ResourceType: "settings", StatusCode: http.StatusOK, DetailsJSON: marshalJSON(map[string]string{"brandTitle": title})})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleUploadSystemLogo(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 512*1024)
	if err := r.ParseMultipartForm(512 * 1024); err != nil {
		http.Error(w, "invalid multipart payload", http.StatusBadRequest)
		return
	}
	file, header, err := r.FormFile("logo")
	if err != nil {
		http.Error(w, "logo file is required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	if header.Size <= 0 || header.Size > 256*1024 {
		http.Error(w, "logo file too large", http.StatusBadRequest)
		return
	}

	content, err := io.ReadAll(io.LimitReader(file, 256*1024+1))
	if err != nil {
		http.Error(w, "failed to read logo file", http.StatusBadRequest)
		return
	}
	if len(content) == 0 || len(content) > 256*1024 {
		http.Error(w, "logo file too large", http.StatusBadRequest)
		return
	}

	// Sniffed, not taken from the client. SVG is refused: it can carry script.
	contentType := http.DetectContentType(content)
	if !allowedLogoContentType(contentType) {
		http.Error(w, "unsupported logo type (use PNG, JPEG or WEBP)", http.StatusBadRequest)
		return
	}

	dataURL := "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(content)
	if !validLogo(dataURL) {
		http.Error(w, "invalid logo data", http.StatusBadRequest)
		return
	}

	settings, err := s.store.GetSystemSettings(r.Context())
	if err != nil {
		http.Error(w, "failed to load settings", http.StatusInternalServerError)
		return
	}
	settings.LogoDataURL = dataURL
	if err := s.store.UpdateSystemSettings(r.Context(), *settings); err != nil {
		http.Error(w, "failed to store logo", http.StatusInternalServerError)
		return
	}
	s.recordAudit(r, models.AuditLog{Action: "admin.system.logo.update", ResourceType: "settings", StatusCode: http.StatusOK, DetailsJSON: marshalJSON(map[string]any{"contentType": contentType, "bytes": len(content)})})
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleDeleteSystemLogo(w http.ResponseWriter, r *http.Request) {
	settings, err := s.store.GetSystemSettings(r.Context())
	if err != nil {
		http.Error(w, "failed to load settings", http.StatusInternalServerError)
		return
	}
	settings.LogoDataURL = ""
	if err := s.store.UpdateSystemSettings(r.Context(), *settings); err != nil {
		http.Error(w, "failed to remove logo", http.StatusInternalServerError)
		return
	}
	s.recordAudit(r, models.AuditLog{Action: "admin.system.logo.delete", ResourceType: "settings", StatusCode: http.StatusOK})
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) userLimiter(userID int) *rate.Limiter {
	s.limitersMu.Lock()
	defer s.limitersMu.Unlock()
	if limiter, ok := s.limiters[userID]; ok {
		return limiter
	}
	limiter := rate.NewLimiter(rate.Every(500*time.Millisecond), 5)
	s.limiters[userID] = limiter
	return limiter
}

func (s *Server) recordAudit(r *http.Request, entry models.AuditLog) {
	if entry.User == "" {
		entry.User = s.usernameOrAnonymous(r)
	}
	if entry.SourceIP == "" {
		entry.SourceIP = s.clientIP(r)
	}
	s.audit.Record(r.Context(), entry)
}

func (s *Server) usernameOrAnonymous(r *http.Request) string {
	if identity, ok := s.identityForRequest(r); ok {
		return identity.User.Username
	}
	return "anonymous"
}

// userForAzureLogin finds or creates the portal account for an Azure AD sign-in.
// Accounts are matched only on the Azure identity (tenant:object id). Accounts made
// before 1.1.0 are bound once by e-mail / username, but only if they are Azure AD
// accounts: matching local or LDAP accounts by e-mail let anyone whose Azure profile
// carried an admin's address sign in as that admin.
func (s *Server) userForAzureLogin(ctx context.Context, azureUser *auth.AzureADUser) (*models.User, error) {
	if user, err := s.store.GetAzureUserByExternalID(ctx, azureUser.ExternalID); err == nil {
		return user, nil
	}
	if user, err := s.store.GetUnboundAzureUser(ctx, azureUser.Email, sanitizeUsername(azureUser.Username)); err == nil {
		if err := s.store.SetUserExternalID(ctx, user.ID, azureUser.ExternalID); err != nil {
			return nil, err
		}
		user.ExternalID = azureUser.ExternalID
		return user, nil
	}
	if azureUser.Email != "" {
		if existing, err := s.store.GetUserByEmail(ctx, azureUser.Email); err == nil && existing.AuthSource != "azuread" {
			log.Printf("azure.link.skipped: azure identity %s shares e-mail with %s account %q; creating a separate azuread account", azureUser.ExternalID, existing.AuthSource, existing.Username)
		}
	}
	baseUsername := sanitizeUsername(azureUser.Username)
	if baseUsername == "" {
		baseUsername = sanitizeUsername(azureUser.Email)
	}
	if baseUsername == "" {
		baseUsername = "azure-user"
	}
	username := uniqueUsername(ctx, s.store, baseUsername)
	id, err := s.store.CreateUser(ctx, models.User{
		Username:           username,
		DisplayName:        azureUser.DisplayName,
		Email:              azureUser.Email,
		AuthSource:         "azuread",
		ExternalID:         azureUser.ExternalID,
		MustChangePassword: false,
		IsActive:           true,
		IsAdmin:            false,
	})
	if err != nil {
		return nil, err
	}
	return s.store.GetUserByID(ctx, id)
}

func (s *Server) notFound(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") || s.staticDir == "" || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	s.serveSPA(w, r)
}

func (s *Server) serveSPA(w http.ResponseWriter, r *http.Request) {
	path := filepath.Join(s.staticDir, filepath.Clean(r.URL.Path))
	if info, err := os.Stat(path); err == nil && !info.IsDir() {
		http.ServeFile(w, r, path)
		return
	}
	http.ServeFile(w, r, filepath.Join(s.staticDir, "index.html"))
}

func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}

// setEphemeralCookie stores OIDC state / nonce. Path is limited to the Azure routes and
// Secure follows COOKIE_SECURE (auto: TLS or https via a trusted proxy).
func (s *Server) setEphemeralCookie(w http.ResponseWriter, r *http.Request, name, value string) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/api/auth/azure",
		HttpOnly: true,
		Secure:   s.secureRequest(r),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   600,
	})
}

func (s *Server) clearCookie(w http.ResponseWriter, r *http.Request, name string) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/api/auth/azure",
		HttpOnly: true,
		Secure:   s.secureRequest(r),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

func cookieValue(r *http.Request, name string) string {
	cookie, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	return cookie.Value
}

func recoverMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				log.Printf("panic: %v", err)
				http.Error(w, "internal server error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	defer r.Body.Close()
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2*1024*1024)).Decode(target); err != nil {
		http.Error(w, "invalid json payload", http.StatusBadRequest)
		return false
	}
	return true
}

// validLogo bounds the data URL to a base64-encoded 256 KB raster image.
func validLogo(dataURL string) bool {
	if len(dataURL) > 360*1024 {
		return false
	}
	return strings.HasPrefix(dataURL, "data:image/png;base64,") ||
		strings.HasPrefix(dataURL, "data:image/jpeg;base64,") ||
		strings.HasPrefix(dataURL, "data:image/webp;base64,")
}

func allowedLogoContentType(contentType string) bool {
	switch contentType {
	case "image/png", "image/jpeg", "image/webp":
		return true
	default:
		return false
	}
}

func marshalJSON(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(data)
}

func sanitizeUsername(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	value = strings.ReplaceAll(value, " ", ".")
	if strings.Contains(value, "@") {
		value = strings.SplitN(value, "@", 2)[0]
	}
	value = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '.' || r == '-' || r == '_' {
			return r
		}
		return -1
	}, value)
	return strings.Trim(value, "._-")
}

func uniqueUsername(ctx context.Context, store *store.Store, base string) string {
	if _, err := store.GetUserByUsername(ctx, base); err != nil {
		return base
	}
	for i := 2; i < 1000; i++ {
		candidate := fmt.Sprintf("%s-%d", base, i)
		if _, err := store.GetUserByUsername(ctx, candidate); err != nil {
			return candidate
		}
	}
	return fmt.Sprintf("%s-%d", base, time.Now().Unix())
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

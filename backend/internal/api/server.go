package api

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/time/rate"

	"api-portal/backend/internal/audit"
	"api-portal/backend/internal/auth"
	"api-portal/backend/internal/config"
	"api-portal/backend/internal/logging"
	"api-portal/backend/internal/metrics"
	"api-portal/backend/internal/models"
	"api-portal/backend/internal/netguard"
	"api-portal/backend/internal/openapi"
	"api-portal/backend/internal/password"
	"api-portal/backend/internal/proxy"
	"api-portal/backend/internal/store"
)

type Server struct {
	store      *store.Store
	audit      *audit.Logger
	openapi    *openapi.Service
	proxy      *proxy.Service
	config     config.Config
	staticDir  string
	passwords  password.Policy
	timezone   *time.Location
	limiters   map[limiterKey]*userLimiter
	limitersMu sync.Mutex
	metrics    *metrics.Portal
	logins     *loginGate
	// dummyHash is checked when the user doesn't exist, so a failed login takes the
	// same time either way and doesn't reveal which usernames exist.
	dummyHash string
}

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
		passwords: password.NewPolicy(cfg.PasswordMinLength),
		timezone:  tz,
		limiters:  map[limiterKey]*userLimiter{},
		metrics:   metrics.NewPortal(),
		logins:    newLoginGate(),
		dummyHash: dummyHash,
	}
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(requestContext, s.requestLogger, recoverMiddleware, s.securityHeaders, s.csrfProtect)

	// Probes. /livez only says the process serves HTTP; /readyz also needs the
	// database. /healthz is the pre-1.2.0 name, kept as an alias of /livez.
	r.Get("/livez", s.handleLivez)
	r.Get("/healthz", s.handleLivez)
	r.Get("/readyz", s.handleReadyz)
	if s.config.MetricsEnabled && s.config.MetricsAddr == "" {
		r.Get("/metrics", s.MetricsHandler().ServeHTTP)
	}

	// Every state-changing route goes through s.audited (see audit_trail.go).
	r.With(s.audited("auth.login")).Post("/api/auth/login", s.handleLogin)
	r.Get("/api/auth/providers", s.handleAuthProviders)
	r.Get("/api/auth/azure/start", s.handleAzureStart)
	r.Get("/api/auth/azure/callback", s.handleAzureCallback)
	r.Get("/api/features", s.handleFeatures)
	r.Get("/api/system/public", s.handlePublicSettings)

	r.Group(func(r chi.Router) {
		r.Use(s.requireSession)
		perm := s.requirePermission
		a := s.audited

		r.Get("/api/auth/me", s.handleMe)
		r.With(a("auth.password_change")).Post("/api/auth/change-password", s.handleChangePassword)
		r.With(a("auth.logout")).Post("/api/auth/logout", s.handleLogout)
		r.Get("/api/auth/sessions", s.handleMySessions)
		r.With(a("session.revoke")).Delete("/api/auth/sessions/{id}", s.handleRevokeMySession)
		r.With(a("session.revoke_others")).Post("/api/auth/sessions/revoke-others", s.handleRevokeMyOtherSessions)
		r.Get("/api/permissions/catalog", s.handlePermissionCatalog)

		r.Get("/api/catalog", s.handleCatalog)
		r.Get("/api/apis/{id}", s.handleAPIDetails)
		r.Get("/api/apis/{id}/spec", s.handleAPISpec)
		r.With(a("api.invoke"), s.requireFeature("tryIt")).Post("/api/apis/{id}/invoke", s.handleInvoke)

		r.With(perm("user.view")).Get("/api/admin/users", s.handleListUsers)
		r.With(a("user.create"), perm("user.manage")).Post("/api/admin/users", s.handleCreateUser)
		r.With(a("user.update"), perm("user.manage")).Put("/api/admin/users/{id}", s.handleUpdateUser)
		r.With(a("user.delete"), perm("user.manage")).Delete("/api/admin/users/{id}", s.handleDeleteUser)
		r.With(perm("user.view")).Get("/api/admin/users/{id}/groups", s.handleGetUserGroups)
		r.With(a("user.groups_set"), perm("user.manage")).Put("/api/admin/users/{id}/groups", s.handleSetUserGroups)
		r.With(a("user.password_reset"), perm("user.manage")).Post("/api/admin/users/{id}/reset-password", s.handleResetPassword)
		r.With(a("user.sessions_revoke"), perm("user.manage")).Post("/api/admin/users/{id}/revoke-sessions", s.handleRevokeUserSessions)

		r.With(perm("session.manage")).Get("/api/admin/sessions", s.handleListSessions)
		r.With(a("session.revoke"), perm("session.manage")).Delete("/api/admin/sessions/{id}", s.handleRevokeSession)

		// Group and role names are needed by anyone who assigns them (user managers,
		// API owners granting access); editing them still needs group / role.manage.
		r.With(s.requireAnyAdminSection).Get("/api/admin/groups", s.handleListGroups)
		r.With(a("group.create"), perm("group.manage")).Post("/api/admin/groups", s.handleCreateGroup)
		r.With(a("group.update"), perm("group.manage")).Put("/api/admin/groups/{id}", s.handleUpdateGroup)
		r.With(a("group.delete"), perm("group.manage")).Delete("/api/admin/groups/{id}", s.handleDeleteGroup)
		r.With(perm("group.manage")).Get("/api/admin/groups/{id}/roles", s.handleGetGroupRoles)
		r.With(a("group.roles_set"), perm("group.manage")).Put("/api/admin/groups/{id}/roles", s.handleSetGroupRoles)

		r.With(s.requireAnyAdminSection).Get("/api/admin/roles", s.handleListRoles)
		r.With(a("role.create"), perm("role.manage")).Post("/api/admin/roles", s.handleCreateRole)
		r.With(a("role.update"), perm("role.manage")).Put("/api/admin/roles/{id}", s.handleUpdateRole)
		r.With(a("role.delete"), perm("role.manage")).Delete("/api/admin/roles/{id}", s.handleDeleteRole)
		r.With(perm("role.manage")).Get("/api/admin/roles/{id}/permissions", s.handleRolePermissions)
		r.With(a("role.permission_add"), perm("role.manage")).Post("/api/admin/roles/{id}/permissions", s.handleAddRolePermission)
		r.With(a("role.permissions_set"), perm("role.manage")).Put("/api/admin/roles/{id}/permissions", s.handleReplaceRolePermissions)
		r.With(a("role.permission_delete"), perm("role.manage")).Delete("/api/admin/permissions/{id}", s.handleDeletePermission)

		ldap := s.requireFeature("ldap")
		r.With(perm("idp.manage"), ldap).Get("/api/admin/ldap", s.handleGetLDAP)
		r.With(a("idp.ldap_update"), perm("idp.manage"), ldap).Put("/api/admin/ldap", s.handleUpdateLDAP)
		r.With(a("idp.ldap_test"), perm("idp.manage"), ldap).Post("/api/admin/ldap/test", s.handleTestLDAP)
		r.With(a("idp.ldap_test_login"), perm("idp.manage"), ldap).Post("/api/admin/ldap/test-login", s.handleTestLDAPLogin)
		r.With(a("idp.ldap_search"), perm("idp.manage"), ldap).Post("/api/admin/ldap/search", s.handleSearchLDAP)
		r.With(a("idp.ldap_import"), perm("idp.manage"), ldap).Post("/api/admin/ldap/import", s.handleImportLDAP)

		azure := s.requireFeature("azureAd")
		r.With(perm("idp.manage"), azure).Get("/api/admin/azure-ad", s.handleGetAzureAD)
		r.With(a("idp.azure_update"), perm("idp.manage"), azure).Put("/api/admin/azure-ad", s.handleUpdateAzureAD)
		r.With(a("idp.azure_test"), perm("idp.manage"), azure).Post("/api/admin/azure-ad/test", s.handleTestAzureAD)

		// API management: global (api.manage / api.create) or per API
		// (api:<id>:manage, api:<id>:delete). Per-API checks are in the handlers.
		r.With(s.requireAPIManagement).Get("/api/admin/apis", s.handleAdminAPIs)
		r.With(a("api.create"), perm("api.create")).Post("/api/admin/apis", s.handleCreateAPI)
		r.With(a("api.update"), s.requireAPIManagement).Put("/api/admin/apis/{id}", s.handleUpdateAPI)
		r.With(a("api.delete"), s.requireAPIManagement).Delete("/api/admin/apis/{id}", s.handleDeleteAPI)
		r.With(a("api.spec_refresh"), s.requireAPIManagement).Post("/api/admin/apis/{id}/refresh", s.handleRefreshAPISpec)
		r.With(s.requireAPIManagement).Get("/api/admin/apis/{id}/access", s.handleGetAPIAccess)
		r.With(a("api.access_set"), s.requireAPIManagement).Put("/api/admin/apis/{id}/access", s.handleSetAPIAccess)

		r.With(perm("audit.view")).Get("/api/admin/audit-logs", s.handleAuditLogs)
		r.With(perm("audit.export"), s.requireFeature("auditExport")).Get("/api/admin/audit-logs/export", s.handleAuditLogsExport)

		r.With(perm("settings.manage")).Get("/api/admin/session", s.handleGetSession)
		r.With(a("settings.session_update"), perm("settings.manage")).Put("/api/admin/session", s.handleUpdateSession)
		r.With(perm("settings.manage")).Get("/api/admin/system", s.handleGetSystem)
		r.With(a("settings.system_update"), perm("settings.manage")).Put("/api/admin/system", s.handleUpdateSystem)
		r.With(a("settings.logo_update"), perm("settings.manage")).Post("/api/admin/system/logo", s.handleUploadSystemLogo)
		r.With(a("settings.logo_delete"), perm("settings.manage")).Delete("/api/admin/system/logo", s.handleDeleteSystemLogo)
	})

	r.NotFound(s.notFound)
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
			s.notFound(w, r)
			return
		}
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
	})
	return r
}

func (s *Server) handleLivez(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleReadyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.store.Ping(ctx); err != nil {
		slog.WarnContext(r.Context(), "readyz.database", "error", err.Error())
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable", "reason": "database"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

// MetricsHandler serves the Prometheus text format. main mounts it on METRICS_ADDR
// when that is set; otherwise the router serves it at /metrics.
func (s *Server) MetricsHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		s.metrics.Registry.WriteText(w)
	})
}

func (s *Server) notFound(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") || s.staticDir == "" || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
		writeError(w, r, http.StatusNotFound, "not found")
		return
	}
	s.serveSPA(w, r)
}

// serveSPA serves built assets, and index.html for client-side routes. Vite puts
// content-hashed files under /assets/, so they can be cached forever; index.html must
// be revalidated so a new release is picked up.
func (s *Server) serveSPA(w http.ResponseWriter, r *http.Request) {
	path := filepath.Join(s.staticDir, filepath.Clean(r.URL.Path))
	if info, err := os.Stat(path); err == nil && !info.IsDir() {
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		http.ServeFile(w, r, path)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, filepath.Join(s.staticDir, "index.html"))
}

type userLimiter struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

type limiterKey struct{ user, api int }

// defaultInvokesPerMinute applies when an API sets no rate limit.
const defaultInvokesPerMinute = 120

// invokeLimiter returns the try-it limiter for one user on one API, from the API's
// rate_limit_per_minute (default 120/min, burst up to 10). Limiters idle for 10
// minutes are dropped so the map can't grow forever.
func (s *Server) invokeLimiter(userID int, apiDef *models.APIDefinition) (*rate.Limiter, int) {
	perMinute := apiDef.RateLimitPerMinute
	if perMinute <= 0 {
		perMinute = defaultInvokesPerMinute
	}
	s.limitersMu.Lock()
	defer s.limitersMu.Unlock()
	now := time.Now()
	if len(s.limiters) > 256 {
		for key, entry := range s.limiters {
			if now.Sub(entry.lastSeen) > 10*time.Minute {
				delete(s.limiters, key)
			}
		}
	}
	key := limiterKey{userID, apiDef.ID}
	every := time.Minute / time.Duration(perMinute)
	entry, ok := s.limiters[key]
	if !ok || entry.limiter.Limit() != rate.Every(every) {
		entry = &userLimiter{limiter: rate.NewLimiter(rate.Every(every), min(perMinute, 10))}
		s.limiters[key] = entry
	}
	entry.lastSeen = now
	return entry.limiter, perMinute
}

func (s *Server) recordAudit(r *http.Request, entry models.AuditLog) {
	if entry.User == "" {
		entry.User = s.usernameOrAnonymous(r)
		if identity, ok := s.identityForRequest(r); ok && entry.ActorSource == "" {
			entry.ActorSource = identity.User.AuthSource
		}
	}
	if entry.Outcome == "" {
		entry.Outcome = auditOutcome(entry.StatusCode)
	}
	if entry.SourceIP == "" {
		entry.SourceIP = s.clientIP(r)
	}
	entry.RequestID = logging.RequestID(r.Context())
	s.audit.Record(r.Context(), entry)
}

func (s *Server) usernameOrAnonymous(r *http.Request) string {
	if identity, ok := s.identityForRequest(r); ok {
		return identity.User.Username
	}
	return "anonymous"
}

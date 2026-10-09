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
	jwtKey     []byte
	timezone   *time.Location
	limiters   map[int]*userLimiter
	limitersMu sync.Mutex
	metrics    *metrics.Portal
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
		limiters:  map[int]*userLimiter{},
		metrics:   metrics.NewPortal(),
		logins:    newLoginGate(),
		dummyHash: dummyHash,
	}
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(requestContext, s.requestLogger, recoverMiddleware, s.securityHeaders)

	// Probes. /livez only says the process serves HTTP; /readyz also needs the
	// database. /healthz is the pre-1.2.0 name, kept as an alias of /livez.
	r.Get("/livez", s.handleLivez)
	r.Get("/healthz", s.handleLivez)
	r.Get("/readyz", s.handleReadyz)
	if s.config.MetricsEnabled && s.config.MetricsAddr == "" {
		r.Get("/metrics", s.MetricsHandler().ServeHTTP)
	}

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

// userLimiter returns the per-user try-it rate limiter (burst 5, then one every
// 500 ms). Limiters idle for 10 minutes are dropped so the map can't grow forever.
func (s *Server) userLimiter(userID int) *rate.Limiter {
	s.limitersMu.Lock()
	defer s.limitersMu.Unlock()
	now := time.Now()
	if len(s.limiters) > 256 {
		for id, entry := range s.limiters {
			if now.Sub(entry.lastSeen) > 10*time.Minute {
				delete(s.limiters, id)
			}
		}
	}
	entry, ok := s.limiters[userID]
	if !ok {
		entry = &userLimiter{limiter: rate.NewLimiter(rate.Every(500*time.Millisecond), 5)}
		s.limiters[userID] = entry
	}
	entry.lastSeen = now
	return entry.limiter
}

func (s *Server) recordAudit(r *http.Request, entry models.AuditLog) {
	if entry.User == "" {
		entry.User = s.usernameOrAnonymous(r)
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

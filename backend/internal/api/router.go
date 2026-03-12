package api

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
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
	"api-portal/backend/internal/openapi"
	"api-portal/backend/internal/proxy"
	"api-portal/backend/internal/rbac"
	"api-portal/backend/internal/store"
)

type Server struct {
	store        *store.Store
	audit        *audit.Logger
	openapi      *openapi.Service
	proxy        *proxy.Service
	config       config.Config
	staticDir    string
	jwtKey       []byte
	timezone     *time.Location
	limiters     map[int]*rate.Limiter
	limitersMu   sync.Mutex
}

func NewServer(store *store.Store, auditLogger *audit.Logger, cfg config.Config) *Server {
	tz, err := time.LoadLocation(cfg.TimeZone)
	if err != nil {
		tz = time.UTC
	}
	return &Server{
		store:     store,
		audit:     auditLogger,
		openapi:   openapi.New(store, cfg.ProxyTimeout),
		proxy:     proxy.New(cfg.ProxyTimeout, cfg.MaxRequestBytes, cfg.MaxResponseBytes),
		config:    cfg,
		staticDir: cfg.StaticDir,
		jwtKey:    store.SigningKey(),
		timezone:  tz,
		limiters:  map[int]*rate.Limiter{},
	}
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(recoverMiddleware)
	r.Use(requestLogger)

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Post("/api/auth/login", s.handleLogin)

	r.Get("/api/system/public", s.handlePublicSettings)

	r.Group(func(r chi.Router) {
		r.Use(auth.AuthMiddleware(s.jwtKey))
		r.Get("/api/auth/me", s.handleMe)
		r.Post("/api/auth/change-password", s.handleChangePassword)
		r.Get("/api/catalog", s.handleCatalog)
		r.Get("/api/apis/{id}", s.handleAPIDetails)
		r.Get("/api/apis/{id}/spec", s.handleAPISpec)
		r.Post("/api/apis/{id}/invoke", s.handleInvoke)
	})

	r.Group(func(r chi.Router) {
		r.Use(auth.AuthMiddleware(s.jwtKey))
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

		r.With(s.requirePermission("api.manage")).Get("/api/admin/apis", s.handleAdminAPIs)
		r.With(s.requirePermission("api.manage")).Post("/api/admin/apis", s.handleCreateAPI)
		r.With(s.requirePermission("api.manage")).Put("/api/admin/apis/{id}", s.handleUpdateAPI)
		r.With(s.requirePermission("api.manage")).Delete("/api/admin/apis/{id}", s.handleDeleteAPI)
		r.With(s.requirePermission("api.manage")).Post("/api/admin/apis/{id}/refresh", s.handleRefreshAPISpec)

		r.With(s.requirePermission("audit.view")).Get("/api/admin/audit-logs", s.handleAuditLogs)
		r.With(s.requirePermission("audit.view")).Get("/api/admin/audit-logs/export", s.handleAuditLogsExport)

		r.With(s.requirePermission("user.manage")).Get("/api/admin/session", s.handleGetSession)
		r.With(s.requirePermission("user.manage")).Put("/api/admin/session", s.handleUpdateSession)

		r.With(s.requirePermission("user.manage")).Get("/api/admin/system", s.handleGetSystem)
		r.With(s.requirePermission("user.manage")).Put("/api/admin/system", s.handleUpdateSystem)
		r.With(s.requirePermission("user.manage")).Post("/api/admin/system/logo", s.handleUploadSystemLogo)
		r.With(s.requirePermission("user.manage")).Delete("/api/admin/system/logo", s.handleDeleteSystemLogo)
	})

	if s.staticDir != "" {
		r.NotFound(s.serveSPA)
		r.MethodNotAllowed(s.serveSPA)
	}
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
	user, err := s.store.GetUserByUsername(r.Context(), payload.Username)
	if err != nil {
		s.recordAudit(r, models.AuditLog{User: payload.Username, Action: "login.failed", ResourceType: "auth", ErrorMessage: "user not found", StatusCode: http.StatusUnauthorized})
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	if !user.IsActive {
		s.recordAudit(r, models.AuditLog{User: payload.Username, Action: "login.failed", ResourceType: "auth", ErrorMessage: "user inactive", StatusCode: http.StatusUnauthorized})
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	switch user.AuthSource {
	case "ldap":
		cfg, err := s.store.GetLDAPConfig(r.Context())
		if err != nil || auth.LDAPAuthenticate(*cfg, payload.Username, payload.Password) != nil {
			s.recordAudit(r, models.AuditLog{User: payload.Username, Action: "login.failed", ResourceType: "auth", ErrorMessage: "ldap auth failed", StatusCode: http.StatusUnauthorized})
			http.Error(w, "invalid credentials", http.StatusUnauthorized)
			return
		}
	default:
		if err := auth.ComparePassword(user.PasswordHash, payload.Password); err != nil {
			s.recordAudit(r, models.AuditLog{User: payload.Username, Action: "login.failed", ResourceType: "auth", ErrorMessage: "local auth failed", StatusCode: http.StatusUnauthorized})
			http.Error(w, "invalid credentials", http.StatusUnauthorized)
			return
		}
	}
	session, _ := s.store.GetSessionSettings(r.Context())
	ttl := time.Duration(s.config.SessionMinutes) * time.Minute
	if session != nil && session.SessionMinutes > 0 {
		ttl = time.Duration(session.SessionMinutes) * time.Minute
	}
	token, err := auth.GenerateToken(s.jwtKey, user.ID, user.Username, ttl)
	if err != nil {
		http.Error(w, "token error", http.StatusInternalServerError)
		return
	}
	s.recordAudit(r, models.AuditLog{User: user.Username, Action: "login.success", ResourceType: "auth", StatusCode: http.StatusOK})
	writeJSON(w, http.StatusOK, map[string]any{"token": token})
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
		http.Error(w, "current password is incorrect", http.StatusUnauthorized)
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
			CanView: engine.CanViewAPI(api.ID),
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
	if err == sql.ErrNoRows {
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
		User:          identity.User.Username,
		Action:        "api.invoke",
		ResourceType:  "api",
		ResourceID:    strconv.Itoa(apiDef.ID),
		ResourceName:  apiDef.Name,
		SourceIP:      clientIP(r),
		DurationMs:    time.Since(start).Milliseconds(),
		SanitizedHeader: marshalJSON(sanitizedHeaders),
	}
	if err != nil {
		entry.Blocked = true
		entry.ErrorMessage = err.Error()
		entry.StatusCode = http.StatusBadGateway
		s.recordAudit(r, entry)
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	entry.StatusCode = resp.StatusCode
	entry.RequestBytes = resp.RequestBytes
	entry.ResponseBytes = resp.ResponseBytes
	entry.DetailsJSON = marshalJSON(map[string]any{"method": payload.Method, "path": payload.Path})
	s.recordAudit(r, entry)
	writeJSON(w, http.StatusOK, resp)
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
	payload.Password = strings.TrimSpace(payload.Password)
	if payload.Username == "" {
		http.Error(w, "username is required", http.StatusBadRequest)
		return
	}
	if payload.Password == "" {
		http.Error(w, "password is required", http.StatusBadRequest)
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
		http.Error(w, "failed to create user", http.StatusBadRequest)
		return
	}
	s.recordAudit(r, models.AuditLog{User: s.usernameOrAnonymous(r), Action: "admin.user.create", ResourceType: "user", ResourceID: strconv.Itoa(id), ResourceName: payload.Username, StatusCode: http.StatusCreated})
	writeJSON(w, http.StatusCreated, map[string]int{"id": id})
}

func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	var request struct {
		models.User
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &request) {
		return
	}
	request.ID = id
	request.Username = strings.TrimSpace(request.Username)
	if request.Username == "" {
		http.Error(w, "username is required", http.StatusBadRequest)
		return
	}
	if err := s.store.UpdateUser(r.Context(), request.User); err != nil {
		http.Error(w, "failed to update user", http.StatusBadRequest)
		return
	}
	if request.Password = strings.TrimSpace(request.Password); request.Password != "" {
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
	s.recordAudit(r, models.AuditLog{User: s.usernameOrAnonymous(r), Action: "admin.user.update", ResourceType: "user", ResourceID: strconv.Itoa(id), ResourceName: request.Username, StatusCode: http.StatusOK})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	if err := s.store.DeleteUser(r.Context(), id); err != nil {
		http.Error(w, "failed to delete user", http.StatusBadRequest)
		return
	}
	s.recordAudit(r, models.AuditLog{User: s.usernameOrAnonymous(r), Action: "admin.user.delete", ResourceType: "user", ResourceID: strconv.Itoa(id), StatusCode: http.StatusOK})
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
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	var payload []int
	if !decodeJSON(w, r, &payload) {
		return
	}
	if err := s.store.SetUserGroups(r.Context(), id, payload); err != nil {
		http.Error(w, "failed to update user groups", http.StatusBadRequest)
		return
	}
	s.recordAudit(r, models.AuditLog{User: s.usernameOrAnonymous(r), Action: "admin.user.groups.update", ResourceType: "user", ResourceID: strconv.Itoa(id), StatusCode: http.StatusOK, DetailsJSON: marshalJSON(payload)})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
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
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	var payload []int
	if !decodeJSON(w, r, &payload) {
		return
	}
	if err := s.store.SetGroupRoles(r.Context(), id, payload); err != nil {
		http.Error(w, "failed to update group roles", http.StatusBadRequest)
		return
	}
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
	if err := s.store.AddRolePermission(r.Context(), id, payload.Scope, payload.Description); err != nil {
		http.Error(w, "failed to add permission", http.StatusBadRequest)
		return
	}
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
	var payload struct{ Query string `json:"query"` }
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
		_ = writer.Write([]string{entry.Timestamp.In(s.timezone).Format(time.RFC3339), entry.User, entry.Action, entry.ResourceType, entry.ResourceID, entry.ResourceName, strconv.Itoa(entry.StatusCode), strconv.FormatInt(entry.DurationMs, 10), strconv.FormatBool(entry.Blocked), entry.ErrorMessage})
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

func (s *Server) handleUpdateSystem(w http.ResponseWriter, r *http.Request) {
	var settings models.SystemSettings
	if !decodeJSON(w, r, &settings) {
		return
	}
	if settings.LogoDataURL != "" && !validLogo(settings.LogoDataURL) {
		http.Error(w, "invalid logo data", http.StatusBadRequest)
		return
	}
	if err := s.store.UpdateSystemSettings(r.Context(), settings); err != nil {
		http.Error(w, "failed to update settings", http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleUploadSystemLogo(w http.ResponseWriter, r *http.Request) {
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

	contentType := http.DetectContentType(content)
	if svgContent(content) {
		contentType = "image/svg+xml"
	}
	if !allowedLogoContentType(contentType) {
		http.Error(w, "unsupported logo type", http.StatusBadRequest)
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
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) identityForRequest(r *http.Request) (*models.Identity, bool) {
	claims, ok := auth.FromContext(r.Context())
	if !ok {
		return nil, false
	}
	user, err := s.store.GetUserByID(r.Context(), claims.UserID)
	if err != nil {
		return nil, false
	}
	groupIDs, _ := s.store.GetUserGroupIDs(r.Context(), user.ID)
	permissions, _ := s.store.ResolvePermissions(r.Context(), user.ID)
	return &models.Identity{User: *user, Permissions: permissions, GroupIDs: groupIDs}, true
}

func (s *Server) requirePermission(permission string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			identity, ok := s.identityForRequest(r)
			if !ok {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			if identity.User.MustChangePassword && identity.User.AuthSource == "local" {
				http.Error(w, "password change required", http.StatusForbidden)
				return
			}
			if !rbac.New(identity.User.IsAdmin, identity.Permissions).Has(permission) {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
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
		entry.SourceIP = clientIP(r)
	}
	s.audit.Record(r.Context(), entry)
}

func (s *Server) usernameOrAnonymous(r *http.Request) string {
	if identity, ok := s.identityForRequest(r); ok {
		return identity.User.Username
	}
	return "anonymous"
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

func clientIP(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		parts := strings.Split(forwarded, ",")
		return strings.TrimSpace(parts[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func validLogo(dataURL string) bool {
	if len(dataURL) > 512*1024 {
		return false
	}
	return strings.HasPrefix(dataURL, "data:image/png;base64,") ||
		strings.HasPrefix(dataURL, "data:image/jpeg;base64,") ||
		strings.HasPrefix(dataURL, "data:image/svg+xml;base64,") ||
		strings.HasPrefix(dataURL, "data:image/webp;base64,")
}

func allowedLogoContentType(contentType string) bool {
	switch contentType {
	case "image/png", "image/jpeg", "image/svg+xml", "image/webp":
		return true
	default:
		return false
	}
}

func svgContent(content []byte) bool {
	trimmed := strings.TrimSpace(string(content))
	return strings.HasPrefix(trimmed, "<svg") || strings.HasPrefix(trimmed, "<?xml")
}

func marshalJSON(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(data)
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func decodeBase64Body(encoded string) string {
	if encoded == "" {
		return ""
	}
	body, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return ""
	}
	return string(body)
}

func debugContext(ctx context.Context) string {
	deadline, ok := ctx.Deadline()
	if !ok {
		return "no-deadline"
	}
	return fmt.Sprintf("deadline=%s", deadline.Format(time.RFC3339))
}

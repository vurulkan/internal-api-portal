package api

import (
	"context"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"api-portal/backend/internal/auth"
	"api-portal/backend/internal/logging"
	"api-portal/backend/internal/models"
	"api-portal/backend/internal/store"
)

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
		s.metrics.Logins.Inc("password", "locked")
		s.recordAudit(r, models.AuditLog{User: name, Action: "login.locked", ResourceType: "auth", Blocked: true, StatusCode: http.StatusTooManyRequests})
		writeError(w, r, http.StatusTooManyRequests, "too many failed sign-in attempts; try again in a few minutes")
		return
	}
	user, reason := s.authenticate(r.Context(), payload.Username, payload.Password)
	if user == nil {
		s.metrics.Logins.Inc("password", "failed")
		s.recordAudit(r, models.AuditLog{User: name, Action: "login.failed", ResourceType: "auth", ErrorMessage: reason, StatusCode: http.StatusUnauthorized})
		if s.logins.fail(key) {
			s.recordAudit(r, models.AuditLog{User: name, Action: "login.locked", ResourceType: "auth", Blocked: true, StatusCode: http.StatusTooManyRequests, DetailsJSON: marshalJSON(map[string]any{"lockoutSeconds": int(loginLockout.Seconds())})})
		}
		writeError(w, r, http.StatusUnauthorized, "invalid credentials")
		return
	}
	s.logins.succeed(key)
	if err := s.startSession(w, r, user); err != nil {
		slog.ErrorContext(r.Context(), "session.create_failed", "error", err.Error())
		writeError(w, r, http.StatusInternalServerError, "could not start a session")
		return
	}
	s.metrics.Logins.Inc(user.AuthSource, "success")
	s.recordAudit(r, models.AuditLog{User: user.Username, Action: "login.success", ResourceType: "auth", StatusCode: http.StatusOK, DetailsJSON: marshalJSON(map[string]string{"source": user.AuthSource})})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
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
		s.azureFail(w, r, "azure_not_configured", "azure ad is not enabled", nil)
		return
	}
	state, err := auth.RandomState()
	if err != nil {
		s.azureFail(w, r, "azure_failed", "random state", err)
		return
	}
	nonce, err := auth.RandomState()
	if err != nil {
		s.azureFail(w, r, "azure_failed", "random nonce", err)
		return
	}
	verifier := auth.NewPKCEVerifier()
	authURL, err := auth.AzureADAuthURL(*cfg, state, nonce, verifier)
	if err != nil {
		s.azureFail(w, r, "azure_failed", "building the authorization url (discovery)", err)
		return
	}
	s.setEphemeralCookie(w, r, "azuread_state", state)
	s.setEphemeralCookie(w, r, "azuread_nonce", nonce)
	s.setEphemeralCookie(w, r, "azuread_pkce", verifier)
	http.Redirect(w, r, authURL, http.StatusFound)
}

// handleAzureCallback finishes the OIDC flow. This is a browser navigation, so
// failures redirect to the login page with a short error code (shown there as a
// message) instead of returning JSON; the detail goes to the log and audit.
func (s *Server) handleAzureCallback(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.store.GetAzureADConfig(r.Context())
	if err != nil || cfg == nil || !cfg.Enabled {
		s.azureFail(w, r, "azure_not_configured", "azure ad is not enabled", nil)
		return
	}
	query := r.URL.Query()
	if query.Get("state") == "" || query.Get("state") != cookieValue(r, "azuread_state") {
		s.azureFail(w, r, "azure_state", "state mismatch (expired, replayed or forged callback)", nil)
		return
	}
	if errCode := query.Get("error"); errCode != "" {
		s.azureFail(w, r, "azure_denied", "identity provider returned "+errCode+": "+query.Get("error_description"), nil)
		return
	}
	code := strings.TrimSpace(query.Get("code"))
	if code == "" {
		s.azureFail(w, r, "azure_failed", "callback without code", nil)
		return
	}
	azureUser, err := auth.AzureADExchangeCode(r.Context(), *cfg, code, cookieValue(r, "azuread_nonce"), cookieValue(r, "azuread_pkce"))
	if err != nil {
		s.azureFail(w, r, "azure_failed", "code exchange / id token verification", err)
		return
	}
	if len(cfg.AllowedGroups) > 0 {
		if azureUser.GroupsOverage {
			s.azureFail(w, r, "azure_groups", "the user is in too many groups for the token to list them; assign the groups to the app registration or use group filtering", nil)
			return
		}
		if !azureUser.InAllowedGroups(cfg.AllowedGroups) {
			s.azureFail(w, r, "azure_groups", "user "+azureUser.Username+" is not in an allowed group", nil)
			return
		}
	}
	user, err := s.userForAzureLogin(r.Context(), azureUser)
	if err != nil {
		s.azureFail(w, r, "azure_failed", "finding or creating the portal account", err)
		return
	}
	s.clearAzureCookies(w, r)
	if !user.IsActive {
		s.metrics.Logins.Inc("azuread", "denied")
		s.recordAudit(r, models.AuditLog{User: user.Username, Action: "login.azure.denied", ResourceType: "auth", ErrorMessage: "user inactive", Blocked: true, StatusCode: http.StatusForbidden})
		http.Redirect(w, r, "/?auth_error=account_disabled", http.StatusFound)
		return
	}
	if err := s.startSession(w, r, user); err != nil {
		s.azureFail(w, r, "azure_failed", "starting the session", err)
		return
	}
	s.metrics.Logins.Inc("azuread", "success")
	s.recordAudit(r, models.AuditLog{User: user.Username, Action: "login.success", ResourceType: "auth", StatusCode: http.StatusOK, DetailsJSON: marshalJSON(map[string]string{"source": "azuread"})})
	// The session cookie is SameSite=Strict, so the browser won't send it on this
	// cross-site redirect chain's final page load; the SPA's own API calls carry it.
	http.Redirect(w, r, "/", http.StatusFound)
}

// azureFail logs and audits a failed Azure AD sign-in step and sends the browser
// back to the login page with an error code the UI turns into a message.
func (s *Server) azureFail(w http.ResponseWriter, r *http.Request, code, step string, err error) {
	detail := step
	if err != nil {
		detail = step + ": " + err.Error()
	}
	slog.WarnContext(r.Context(), "login.azure.failed", "code", code, "detail", detail, "request_id", logging.RequestID(r.Context()))
	s.metrics.Logins.Inc("azuread", "failed")
	s.recordAudit(r, models.AuditLog{Action: "login.azure.failed", ResourceType: "auth", ErrorMessage: detail, StatusCode: http.StatusBadRequest, DetailsJSON: marshalJSON(map[string]string{"code": code})})
	s.clearAzureCookies(w, r)
	http.Redirect(w, r, "/?auth_error="+url.QueryEscape(code), http.StatusFound)
}

func (s *Server) clearAzureCookies(w http.ResponseWriter, r *http.Request) {
	for _, name := range []string{"azuread_state", "azuread_nonce", "azuread_pkce"} {
		s.clearCookie(w, r, name)
	}
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

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	identity, _ := s.identityForRequest(r)
	settings, _ := s.store.GetSystemSettings(r.Context())
	idle, _ := s.sessionTimeouts(r.Context())
	session := currentSession(r)
	warnings := []string{}
	if identity.User.IsAdmin && s.store.KeyInDatabase() {
		warnings = append(warnings, "encryption_key_in_database")
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":           identity.User,
		"permissions":    identity.Permissions,
		"groupIds":       identity.GroupIDs,
		"branding":       settings,
		"passwordPolicy": map[string]int{"minLength": s.passwords.MinLength},
		"session":        map[string]any{"expiresAt": session.ExpiresAt, "idleMinutes": int(idle.Minutes())},
		"warnings":       warnings,
	})
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	identity, _ := s.identityForRequest(r)
	if identity.User.AuthSource != "local" {
		writeError(w, r, http.StatusBadRequest, "password changes are supported only for local users")
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
		s.recordAudit(r, models.AuditLog{User: identity.User.Username, Action: "password.change.failed", ResourceType: "user", ResourceID: strconv.Itoa(identity.User.ID), ErrorMessage: "current password incorrect", StatusCode: http.StatusBadRequest})
		// 400, not 401: the session itself is fine, and the UI treats 401 as "signed out".
		writeError(w, r, http.StatusBadRequest, "current password is incorrect")
		return
	}
	if msg := s.passwords.Problem(payload.NewPassword, identity.User.Username); msg != "" {
		writeError(w, r, http.StatusBadRequest, msg)
		return
	}
	if payload.NewPassword == payload.CurrentPassword {
		writeError(w, r, http.StatusBadRequest, "the new password must differ from the current one")
		return
	}
	hash, err := auth.HashPassword(payload.NewPassword)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to update password")
		return
	}
	if err := s.store.UpdateUserPassword(r.Context(), identity.User.ID, hash, false); err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to update password")
		return
	}
	// Other browsers signed in as this user may have been someone who knew the old password.
	revoked, _ := s.store.RevokeUserSessions(r.Context(), identity.User.ID, currentSession(r).ID, time.Now().UTC())
	s.recordAudit(r, models.AuditLog{User: identity.User.Username, Action: "password.change.success", ResourceType: "user", ResourceID: strconv.Itoa(identity.User.ID), ResourceName: identity.User.Username, StatusCode: http.StatusOK, DetailsJSON: marshalJSON(map[string]int{"sessionsRevoked": revoked})})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "sessionsRevoked": revoked})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	identity, _ := s.identityForRequest(r)
	if err := s.store.RevokeSession(r.Context(), currentSession(r).ID, time.Now().UTC()); err != nil {
		writeError(w, r, http.StatusInternalServerError, "could not end the session")
		return
	}
	s.clearSessionCookies(w, r)
	s.recordAudit(r, models.AuditLog{User: identity.User.Username, Action: "logout", ResourceType: "auth", StatusCode: http.StatusOK})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handlePublicSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.store.GetSystemSettings(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load settings")
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

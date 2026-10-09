package api

import (
	"net/http"
	"strings"

	"api-portal/backend/internal/auth"
	"api-portal/backend/internal/models"
)

func (s *Server) handleGetLDAP(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.store.GetLDAPConfig(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load ldap config")
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
		writeError(w, r, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.UpdateLDAPConfig(r.Context(), payload); err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to update ldap config")
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
	// The LDAP / Azure test endpoints return the directory's error text: they exist to
	// diagnose the connection, and only identity administrators can call them.
	if err := auth.TestLDAPConnection(payload); err != nil {
		s.recordAudit(r, models.AuditLog{User: s.usernameOrAnonymous(r), Action: "admin.ldap.test", ResourceType: "ldap", ErrorMessage: err.Error(), StatusCode: http.StatusBadRequest})
		writeError(w, r, http.StatusBadRequest, err.Error())
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
		writeError(w, r, http.StatusInternalServerError, "failed to load ldap config")
		return
	}
	users, err := auth.SearchLDAPUsers(*cfg, payload.Query)
	if err != nil {
		writeError(w, r, http.StatusBadGateway, "ldap search failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func (s *Server) handleImportLDAP(w http.ResponseWriter, r *http.Request) {
	var payload []models.LDAPUser
	if !decodeJSON(w, r, &payload) {
		return
	}
	skipped, err := s.store.ImportLDAPUsers(r.Context(), payload)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to import users")
		return
	}
	if skipped == nil {
		skipped = []string{}
	}
	s.recordAudit(r, models.AuditLog{Action: "admin.ldap.import", ResourceType: "ldap", StatusCode: http.StatusOK,
		DetailsJSON: marshalJSON(map[string]any{"requested": len(payload), "skipped": skipped})})
	// skipped lists usernames that already belong to a local or Azure AD account;
	// those accounts are not converted to LDAP.
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "imported": len(payload) - len(skipped), "skipped": skipped})
}

func (s *Server) handleGetAzureAD(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.store.GetAzureADConfig(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load azure ad config")
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
		writeError(w, r, http.StatusBadRequest, "failed to update azure ad config")
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
		writeError(w, r, http.StatusBadRequest, err.Error())
		return
	}
	s.recordAudit(r, models.AuditLog{User: s.usernameOrAnonymous(r), Action: "admin.azuread.test", ResourceType: "azuread", StatusCode: http.StatusOK})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleTestLDAPLogin runs the LDAP login steps for a username / password with the
// saved configuration and reports each step. Nothing is created or changed.
func (s *Server) handleTestLDAPLogin(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &payload) {
		return
	}
	if strings.TrimSpace(payload.Username) == "" {
		writeError(w, r, http.StatusBadRequest, "username is required")
		return
	}
	cfg, err := s.store.GetLDAPConfig(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load ldap config")
		return
	}
	steps := auth.LDAPTestLogin(*cfg, payload.Username, payload.Password)
	ok := len(steps) > 0 && steps[len(steps)-1].OK && steps[len(steps)-1].Name == "user bind"
	s.recordAudit(r, models.AuditLog{Action: "admin.ldap.test_login", ResourceType: "ldap", ResourceName: auditUsername(payload.Username), StatusCode: http.StatusOK, DetailsJSON: marshalJSON(map[string]bool{"ok": ok})})
	writeJSON(w, http.StatusOK, map[string]any{"ok": ok, "steps": steps})
}

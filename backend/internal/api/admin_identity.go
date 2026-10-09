package api

import (
	"net/http"

	"api-portal/backend/internal/auth"
	"api-portal/backend/internal/models"
)

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

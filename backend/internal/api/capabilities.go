package api

import (
	"net/http"
	"sort"

	"api-portal/backend/internal/rbac"
)

// capabilities tells the UI what to show. It is a convenience: every endpoint
// checks permissions itself.
type capabilities struct {
	// AdminSections are the admin console sections the user may open.
	AdminSections []string `json:"adminSections"`
	// ManagesAllAPIs: api.manage (or admin); otherwise ManagedAPIs lists ids.
	ManagesAllAPIs bool  `json:"managesAllApis"`
	ManagedAPIs    []int `json:"managedApis"`
	CanCreateAPI   bool  `json:"canCreateApi"`
	CanExportAudit bool  `json:"canExportAudit"`
}

func (s *Server) capabilitiesFor(engine *rbac.Engine) capabilities {
	c := capabilities{
		ManagesAllAPIs: engine.ManagesAllAPIs(),
		ManagedAPIs:    engine.ManagedAPIs(),
		CanCreateAPI:   engine.Has("api.create"),
		CanExportAudit: engine.Has("audit.export") && s.config.Features.AuditExport,
	}
	if c.ManagedAPIs == nil {
		c.ManagedAPIs = []int{}
	}
	sort.Ints(c.ManagedAPIs)
	sections := []struct {
		name string
		ok   bool
	}{
		{"apis", c.ManagesAllAPIs || c.CanCreateAPI || len(c.ManagedAPIs) > 0},
		{"users", engine.Has("user.view")},
		{"groups", engine.Has("group.manage")},
		{"roles", engine.Has("role.manage")},
		{"ldap", engine.Has("idp.manage") && s.config.Features.LDAP},
		{"azureAd", engine.Has("idp.manage") && s.config.Features.AzureAD},
		{"sessionSettings", engine.Has("settings.manage")},
		{"system", engine.Has("settings.manage")},
		{"sessions", engine.Has("session.manage")},
		{"audit", engine.Has("audit.view")},
	}
	c.AdminSections = []string{}
	for _, section := range sections {
		if section.ok {
			c.AdminSections = append(c.AdminSections, section.name)
		}
	}
	return c
}

func (s *Server) handleFeatures(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.config.Features)
}

// handlePermissionCatalog serves the grantable scopes, so the role editor needs no
// hard-coded list.
func (s *Server) handlePermissionCatalog(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"items": rbac.Catalog})
}

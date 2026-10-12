package api

import (
	"encoding/json"
	"net/http"
	"net/url"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"api-portal/backend/internal/openapi"
	"api-portal/backend/internal/rbac"
)

// attentionItem is one thing on the overview that someone should look at.
type attentionItem struct {
	Kind     string `json:"kind"`     // spec_error, spec_missing, spec_stale, encryption_key_in_database, ldap_skip_verify
	Severity string `json:"severity"` // warning, danger
	APIID    int    `json:"apiId,omitempty"`
	APIName  string `json:"apiName,omitempty"`
	// Detail is the spec error text: managers of that API only, like everywhere else.
	Detail string     `json:"detail,omitempty"`
	Since  *time.Time `json:"since,omitempty"`
}

type apiCounts struct {
	Total       int `json:"total"`
	Active      int `json:"active"`
	SpecErrors  int `json:"specErrors"`
	SpecMissing int `json:"specMissing"`
	Stale       int `json:"stale"`
}

type activityCounts struct {
	Invokes map[string]int `json:"invokes"` // success / denied / failed
	Denied  int            `json:"denied"`
	Failed  int            `json:"failed"`
	Logins  map[string]int `json:"logins"`
}

// staleAfter: a spec older than this is flagged. With background refresh on, two
// missed rounds (at least a day); without it, a week.
func (s *Server) staleAfter() time.Duration {
	if s.config.SpecRefreshInterval > 0 {
		return max(2*s.config.SpecRefreshInterval, 24*time.Hour)
	}
	return 7 * 24 * time.Hour
}

// handleAdminOverview is the admin console's first page. Each block is filled only
// for the permission that guards the matching section, so the overview never shows
// more than the sections themselves would.
func (s *Server) handleAdminOverview(w http.ResponseWriter, r *http.Request) {
	identity, _ := s.identityForRequest(r)
	engine := rbac.New(identity.User.IsAdmin, identity.Permissions)
	ctx := r.Context()
	now := time.Now().UTC()
	day := now.Add(-24 * time.Hour)
	out := map[string]any{"generatedAt": now}
	attention := []attentionItem{}

	if engine.ManagesAllAPIs() || len(engine.ManagedAPIs()) > 0 {
		apis, err := s.store.ListAPIDefinitions(ctx)
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, "failed to load apis")
			return
		}
		counts := apiCounts{}
		for _, api := range apis {
			if !engine.CanManageAPI(api.ID) {
				continue
			}
			counts.Total++
			if !api.IsActive {
				continue
			}
			counts.Active++
			state, detail := specState(api)
			switch {
			case state == "error":
				counts.SpecErrors++
				attention = append(attention, attentionItem{Kind: "spec_error", Severity: "danger", APIID: api.ID, APIName: api.Name, Detail: detail, Since: api.LastSpecRefreshAt})
			case state == "missing":
				counts.SpecMissing++
				attention = append(attention, attentionItem{Kind: "spec_missing", Severity: "warning", APIID: api.ID, APIName: api.Name})
			case now.Sub(*api.LastSpecRefreshAt) > s.staleAfter():
				counts.Stale++
				attention = append(attention, attentionItem{Kind: "spec_stale", Severity: "warning", APIID: api.ID, APIName: api.Name, Since: api.LastSpecRefreshAt})
			}
		}
		out["apis"] = counts
	}

	if engine.Has("user.view") {
		users, err := s.store.CountUsersSummary(ctx, day)
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, "failed to count users")
			return
		}
		out["users"] = users
	}
	if engine.Has("session.manage") {
		if sessions, err := s.activeSessions(r, 0); err == nil {
			out["activeSessions"] = len(sessions)
		}
	}

	if engine.Has("audit.view") {
		invokes, err := s.store.AuditOutcomes(ctx, "api.invoke.", day)
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, "failed to count activity")
			return
		}
		all, _ := s.store.AuditOutcomes(ctx, "", day)
		logins, _ := s.store.AuditOutcomes(ctx, "auth.login.", day)
		out["activity"] = activityCounts{Invokes: invokes, Denied: all["denied"], Failed: all["failed"], Logins: logins}
	}

	if identity.User.IsAdmin && s.store.KeyInDatabase() {
		attention = append(attention, attentionItem{Kind: "encryption_key_in_database", Severity: "danger"})
	}
	if engine.Has("idp.manage") && s.config.Features.LDAP {
		if cfg, err := s.store.GetLDAPConfig(ctx); err == nil && cfg.Enabled && cfg.SkipVerify {
			attention = append(attention, attentionItem{Kind: "ldap_skip_verify", Severity: "warning"})
		}
	}
	sort.SliceStable(attention, func(i, j int) bool {
		return attention[i].Severity == "danger" && attention[j].Severity != "danger"
	})
	out["attention"] = attention
	writeJSON(w, http.StatusOK, out)
}

// handleSystemInfo describes the running portal for the settings page. Nothing in
// it is secret: the encryption key is reported by where it comes from, not by value.
func (s *Server) handleSystemInfo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	size, _ := s.store.DatabaseSize(ctx)
	schema, _ := s.store.SchemaVersion(ctx)
	version := s.config.Version
	if version == "" {
		version = "dev"
	}
	keySource := "environment"
	if s.store.KeyInDatabase() {
		keySource = "database"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"version":             version,
		"goVersion":           runtime.Version(),
		"startedAt":           s.started,
		"databaseBytes":       size,
		"schemaVersion":       schema,
		"encryptionKeySource": keySource,
		"encryptionKeyId":     s.store.CurrentKeyID(),
		"specRefreshMinutes":  int(s.config.SpecRefreshInterval.Minutes()),
		"auditRetentionDays":  s.config.LogRetentionDays,
		"backupsEnabled":      s.config.BackupInterval > 0,
		"metricsEnabled":      s.config.MetricsEnabled,
		"timeZone":            s.timezone.String(),
		"features":            s.config.Features,
	})
}

// handleAPIImpact says what deleting an API also removes, for the confirm dialog.
func (s *Server) handleAPIImpact(w http.ResponseWriter, r *http.Request) {
	id, ok := s.managedAPIParam(w, r)
	if !ok {
		return
	}
	impact, err := s.store.APIImpact(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to count")
		return
	}
	writeJSON(w, http.StatusOK, impact)
}

// managedAPIParam reads {id} and checks the caller manages (or may delete) that API.
func (s *Server) managedAPIParam(w http.ResponseWriter, r *http.Request) (int, bool) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	engine := s.apiEngine(r)
	if err != nil || (!engine.CanManageAPI(id) && !engine.CanDeleteAPI(id)) {
		writeError(w, r, http.StatusForbidden, "you don't manage this API")
		return 0, false
	}
	if _, err := s.store.GetAPIDefinition(r.Context(), id); err != nil {
		writeError(w, r, http.StatusNotFound, "api not found")
		return 0, false
	}
	return id, true
}

// handleSpecPreview fetches a spec URL (through the same guarded client as a
// refresh) and summarizes it, so the API form can show what will be imported before
// anything is saved. Nothing is stored. The error text goes to API managers only,
// who need it to fix the URL.
func (s *Server) handleSpecPreview(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		URL string `json:"url"`
	}
	if !decodeJSON(w, r, &payload) {
		return
	}
	payload.URL = strings.TrimSpace(payload.URL)
	auditTarget(r, "api", "", "")
	auditDetail(r, "url", payload.URL)
	u, err := url.Parse(payload.URL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		writeError(w, r, http.StatusBadRequest, "the OpenAPI URL must be an absolute http(s) URL")
		return
	}
	fetched, err := s.openapi.Fetch(r.Context(), payload.URL)
	if err != nil {
		writeError(w, r, http.StatusBadGateway, "spec fetch failed: "+err.Error())
		return
	}
	var doc struct {
		OpenAPI string `json:"openapi"`
		Swagger string `json:"swagger"`
		Info    struct {
			Title string `json:"title"`
		} `json:"info"`
	}
	_ = json.Unmarshal(fetched.Spec, &doc)
	version, ops := openapi.ExtractOperations(fetched.Spec)
	if doc.OpenAPI == "" && doc.Swagger == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "the document has neither an openapi nor a swagger field: is this an OpenAPI spec?")
		return
	}
	tags := map[string]int{}
	for _, op := range ops {
		for _, tag := range op.Tags {
			tags[tag]++
		}
	}
	sample := []map[string]string{}
	for _, op := range ops {
		if len(sample) == 8 {
			break
		}
		sample = append(sample, map[string]string{"method": op.Method, "path": op.Path, "summary": op.Summary})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"format":         fetched.Format,
		"bytes":          fetched.Bytes,
		"openapi":        doc.OpenAPI + doc.Swagger,
		"title":          doc.Info.Title,
		"version":        version,
		"operationCount": len(ops),
		"tagCount":       len(tags),
		"sample":         sample,
	})
}

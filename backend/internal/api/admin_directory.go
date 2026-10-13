package api

import (
	"encoding/json"
	"net/http"
	"net/mail"
	"strconv"
	"strings"

	"api-portal/backend/internal/auth"
	"api-portal/backend/internal/models"
	"api-portal/backend/internal/rbac"
)

// Directory users in the Users section: LDAP import and Azure AD pre-registration.
// Both need user.manage (creating accounts is user management); LDAP import also
// works with idp.manage, as before. Neither changes the identity provider settings.

// requireAnyPermission admits holders of any one of the scopes.
func (s *Server) requireAnyPermission(scopes ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			identity, ok := s.identityForRequest(r)
			if !ok {
				writeError(w, r, http.StatusUnauthorized, "unauthorized")
				return
			}
			engine := rbac.New(identity.User.IsAdmin, identity.Permissions)
			for _, scope := range scopes {
				if engine.Has(scope) {
					next.ServeHTTP(w, r)
					return
				}
			}
			writeError(w, r, http.StatusForbidden, "forbidden")
		})
	}
}

// handleImportLDAP creates (or refreshes) LDAP accounts for directory users and
// optionally adds them to groups. Each username is looked up in the directory: the
// account gets the directory's username, name and e-mail, and a name that isn't in
// the directory is refused, so an account can't be prepared for someone who
// doesn't exist (yet). Adding to groups is a grant, checked like any other.
//
// Body: {"usernames": [...], "groupIds": [...]}; the 2.1 form (an array of
// {username, …}) is still accepted, without groups.
func (s *Server) handleImportLDAP(w http.ResponseWriter, r *http.Request) {
	actor, _ := s.identityForRequest(r)
	var raw json.RawMessage
	if !decodeJSON(w, r, &raw) {
		return
	}
	var payload struct {
		Usernames []string `json:"usernames"`
		GroupIDs  []int    `json:"groupIds"`
	}
	var legacy []models.LDAPUser
	if err := json.Unmarshal(raw, &legacy); err == nil {
		for _, u := range legacy {
			payload.Usernames = append(payload.Usernames, u.Username)
		}
	} else if err := json.Unmarshal(raw, &payload); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid body")
		return
	}
	auditTarget(r, "ldap", "", "")
	names := uniqueTrimmed(payload.Usernames)
	if len(names) == 0 || len(names) > 200 {
		writeError(w, r, http.StatusBadRequest, "usernames: 1 to 200 names")
		return
	}
	for _, id := range payload.GroupIDs {
		if _, err := s.store.GetGroup(r.Context(), id); err != nil {
			writeError(w, r, http.StatusBadRequest, "group "+strconv.Itoa(id)+" not found")
			return
		}
	}
	if len(payload.GroupIDs) > 0 && !s.allowGrant(w, r, actor, func() ([]string, error) { return s.store.ScopesForGroups(r.Context(), payload.GroupIDs) }) {
		return
	}
	cfg, err := s.store.GetLDAPConfig(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load ldap config")
		return
	}
	found, missing, err := auth.LookupLDAPUsers(*cfg, names)
	if err != nil {
		writeError(w, r, http.StatusBadGateway, "ldap lookup failed: "+err.Error())
		return
	}
	skipped, err := s.store.ImportLDAPUsers(r.Context(), found)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to import users")
		return
	}
	skippedSet := map[string]bool{}
	for _, name := range skipped {
		skippedSet[name] = true
	}
	var ids []int
	for _, u := range found {
		if skippedSet[u.Username] {
			continue
		}
		user, err := s.store.GetUserByUsername(r.Context(), u.Username)
		// Only administrators change administrators' groups.
		if err != nil || user.AuthSource != "ldap" || (user.IsAdmin && !actor.User.IsAdmin) {
			continue
		}
		ids = append(ids, user.ID)
	}
	added := 0
	for _, groupID := range payload.GroupIDs {
		n, err := s.store.AddGroupMembers(r.Context(), groupID, ids)
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, "users imported, but adding them to groups failed")
			return
		}
		added += len(n)
	}
	auditDetails(r, map[string]any{"requested": len(names), "imported": len(found) - len(skipped), "skipped": orEmptyStrings(skipped), "missing": orEmptyStrings(missing), "groupIds": payload.GroupIDs})
	// skipped: names that belong to a local or Azure AD account (never converted);
	// missing: names the directory doesn't know.
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":            true,
		"imported":      len(found) - len(skipped),
		"skipped":       orEmptyStrings(skipped),
		"missing":       orEmptyStrings(missing),
		"addedToGroups": added,
	})
}

// handlePreregisterAzureUser creates an Azure AD account before the person's
// first Microsoft sign-in, so it can be put in groups now. At that sign-in the
// account is bound to the Azure identity: by sign-in name (the UPN, if given here),
// else by e-mail when exactly one never-bound account has it (GetUnboundAzureUser).
// Local and LDAP accounts are never bound this way.
func (s *Server) handlePreregisterAzureUser(w http.ResponseWriter, r *http.Request) {
	actor, _ := s.identityForRequest(r)
	var payload struct {
		Email       string `json:"email"`
		UPN         string `json:"upn"`
		DisplayName string `json:"displayName"`
		GroupIDs    []int  `json:"groupIds"`
	}
	if !decodeJSON(w, r, &payload) {
		return
	}
	payload.Email = strings.TrimSpace(payload.Email)
	payload.UPN = strings.TrimSpace(payload.UPN)
	auditTarget(r, "user", "", payload.Email)
	if addr, err := mail.ParseAddress(payload.Email); err != nil || addr.Address != payload.Email {
		writeError(w, r, http.StatusBadRequest, "a valid e-mail address is required")
		return
	}
	if payload.UPN != "" && !strings.Contains(payload.UPN, "@") {
		writeError(w, r, http.StatusBadRequest, "the sign-in name is the user principal name, e.g. jdoe@corp.onmicrosoft.com")
		return
	}
	cfg, err := s.store.GetAzureADConfig(r.Context())
	if err != nil || !cfg.Enabled {
		writeError(w, r, http.StatusBadRequest, "Microsoft sign-in is not enabled")
		return
	}
	base := sanitizeUsername(firstNonBlank(payload.UPN, payload.Email))
	if base == "" {
		writeError(w, r, http.StatusBadRequest, "no usable sign-in name")
		return
	}
	// One person may have an LDAP or local account and an Azure AD one: they are
	// separate accounts. Only another Azure AD account is a duplicate.
	if existing, err := s.store.GetAzureUserByEmail(r.Context(), payload.Email); err == nil {
		writeError(w, r, http.StatusConflict, "an Azure AD account with this e-mail already exists: "+existing.Username)
		return
	}
	username := base
	if existing, err := s.store.GetUserByUsername(r.Context(), base); err == nil {
		if existing.AuthSource == "azuread" {
			writeError(w, r, http.StatusConflict, "an Azure AD account named "+strconv.Quote(base)+" already exists")
			return
		}
		// Taken by an LDAP or local account: the next free "<name>-N", as a first
		// Microsoft sign-in would choose (and bind to, see GetUnboundAzureUser).
		username = uniqueUsername(r.Context(), s.store, base)
	}
	sharesEmail := ""
	if other, err := s.store.GetUserByEmail(r.Context(), payload.Email); err == nil && other.AuthSource != "azuread" {
		sharesEmail = other.Username + " (" + other.AuthSource + ")"
	}
	for _, id := range payload.GroupIDs {
		if _, err := s.store.GetGroup(r.Context(), id); err != nil {
			writeError(w, r, http.StatusBadRequest, "group "+strconv.Itoa(id)+" not found")
			return
		}
	}
	if len(payload.GroupIDs) > 0 && !s.allowGrant(w, r, actor, func() ([]string, error) { return s.store.ScopesForGroups(r.Context(), payload.GroupIDs) }) {
		return
	}
	id, err := s.store.CreateUser(r.Context(), models.User{
		Username: username, DisplayName: strings.TrimSpace(payload.DisplayName), Email: payload.Email,
		AuthSource: "azuread", IsActive: true,
	})
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to create the account")
		return
	}
	for _, groupID := range payload.GroupIDs {
		if _, err := s.store.AddGroupMembers(r.Context(), groupID, []int{id}); err != nil {
			writeError(w, r, http.StatusInternalServerError, "account created, but adding it to groups failed")
			return
		}
	}
	auditTarget(r, "user", strconv.Itoa(id), username)
	auditDetails(r, map[string]any{"email": payload.Email, "upnGiven": payload.UPN != "", "groupIds": payload.GroupIDs, "sharesEmailWith": sharesEmail})
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "username": username, "sharesEmailWith": sharesEmail})
}

func uniqueTrimmed(values []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, v := range values {
		if v = strings.TrimSpace(v); v != "" && !seen[strings.ToLower(v)] {
			seen[strings.ToLower(v)] = true
			out = append(out, v)
		}
	}
	return out
}

func orEmptyStrings(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

func firstNonBlank(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

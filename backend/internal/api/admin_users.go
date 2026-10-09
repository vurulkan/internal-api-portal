package api

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"api-portal/backend/internal/auth"
	"api-portal/backend/internal/models"
	"api-portal/backend/internal/password"
)

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load users")
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
		writeError(w, r, http.StatusBadRequest, "username is required")
		return
	}
	if msg := s.passwords.Problem(payload.Password, payload.Username); msg != "" {
		writeError(w, r, http.StatusBadRequest, msg)
		return
	}
	if payload.IsAdmin && !actor.User.IsAdmin {
		s.denyAudit(r, "non-admin tried to create an administrator", marshalJSON(map[string]string{"username": payload.Username}))
		writeError(w, r, http.StatusForbidden, "only administrators can create administrator accounts")
		return
	}
	hash, err := auth.HashPassword(payload.Password)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to create user")
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
		writeError(w, r, http.StatusBadRequest, "failed to create user (is the username taken?)")
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
		writeError(w, r, http.StatusNotFound, "user not found")
		return
	}
	request.ID = id
	request.Username = strings.TrimSpace(request.Username)
	if target.AuthSource != "local" {
		// LDAP and Azure AD own these fields; changing them here would only make the
		// account diverge from the directory (and an LDAP login matches on username).
		request.Username, request.DisplayName, request.Email = target.Username, target.DisplayName, target.Email
	}
	if request.Username == "" {
		writeError(w, r, http.StatusBadRequest, "username is required")
		return
	}
	if (target.IsAdmin || request.IsAdmin) && !actor.User.IsAdmin {
		s.denyAudit(r, "non-admin tried to change an administrator account", marshalJSON(map[string]any{"userId": id}))
		writeError(w, r, http.StatusForbidden, "only administrators can manage administrator accounts")
		return
	}
	if msg := s.adminChangeProblem(r.Context(), actor, target, request.IsAdmin, request.IsActive); msg != "" {
		writeError(w, r, http.StatusConflict, msg)
		return
	}
	if request.Password != "" {
		if target.AuthSource != "local" {
			writeError(w, r, http.StatusBadRequest, "passwords can only be set for local users")
			return
		}
		if msg := s.passwords.Problem(request.Password, target.Username); msg != "" {
			writeError(w, r, http.StatusBadRequest, msg)
			return
		}
	}
	if err := s.store.UpdateUser(r.Context(), request.User); err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to update user")
		return
	}
	if request.Password != "" {
		hash, err := auth.HashPassword(request.Password)
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, "failed to update password")
			return
		}
		if err := s.store.UpdateUserPassword(r.Context(), id, hash, request.MustChangePassword); err != nil {
			writeError(w, r, http.StatusInternalServerError, "failed to update password")
			return
		}
	}
	// Losing access, admin rights or the password ends the user's sessions now
	// rather than at their next idle timeout.
	revoked := 0
	if (target.IsActive && !request.IsActive) || (target.IsAdmin && !request.IsAdmin) || request.Password != "" {
		revoked, _ = s.store.RevokeUserSessions(r.Context(), id, 0, time.Now().UTC())
	}
	s.recordAudit(r, models.AuditLog{Action: "admin.user.update", ResourceType: "user", ResourceID: strconv.Itoa(id), ResourceName: request.Username, StatusCode: http.StatusOK,
		DetailsJSON: marshalJSON(map[string]any{"isAdmin": request.IsAdmin, "isActive": request.IsActive, "passwordChanged": request.Password != "", "sessionsRevoked": revoked})})
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

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	actor, _ := s.identityForRequest(r)
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	target, err := s.store.GetUserByID(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "user not found")
		return
	}
	if target.IsAdmin && !actor.User.IsAdmin {
		s.denyAudit(r, "non-admin tried to delete an administrator", marshalJSON(map[string]any{"userId": id}))
		writeError(w, r, http.StatusForbidden, "only administrators can delete administrator accounts")
		return
	}
	if msg := s.adminChangeProblem(r.Context(), actor, target, false, false); msg != "" {
		writeError(w, r, http.StatusConflict, msg)
		return
	}
	if err := s.store.DeleteUser(r.Context(), id); err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to delete user")
		return
	}
	s.recordAudit(r, models.AuditLog{Action: "admin.user.delete", ResourceType: "user", ResourceID: strconv.Itoa(id), ResourceName: target.Username, StatusCode: http.StatusOK})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleGetUserGroups(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	ids, err := s.store.GetUserGroupIDs(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load user groups")
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
		writeError(w, r, http.StatusNotFound, "user not found")
		return
	}
	if target.IsAdmin && !actor.User.IsAdmin {
		s.denyAudit(r, "non-admin tried to change an administrator's groups", marshalJSON(map[string]any{"userId": id}))
		writeError(w, r, http.StatusForbidden, "only administrators can manage administrator accounts")
		return
	}
	current, err := s.store.GetUserGroupIDs(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load user groups")
		return
	}
	if !s.allowGrant(w, r, actor, func() ([]string, error) { return s.store.ScopesForGroups(r.Context(), addedIDs(current, payload)) }) {
		return
	}
	if err := s.store.SetUserGroups(r.Context(), id, payload); err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to update user groups")
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
		writeError(w, r, http.StatusInternalServerError, "failed to resolve permissions")
		return false
	}
	if missing := scopesBeyondActor(actor, granted); len(missing) > 0 {
		s.denyAudit(r, "grant exceeds the actor's own permissions", marshalJSON(map[string]any{"scopes": missing}))
		writeError(w, r, http.StatusForbidden, "you can only grant permissions you hold yourself; missing: "+strings.Join(missing, ", "))
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

// handleResetPassword gives a local user a generated temporary password that must
// be changed at the next sign-in, and ends their sessions. The password is returned
// once, in this response, and never logged or audited.
func (s *Server) handleResetPassword(w http.ResponseWriter, r *http.Request) {
	actor, _ := s.identityForRequest(r)
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	target, err := s.store.GetUserByID(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "user not found")
		return
	}
	if target.IsAdmin && !actor.User.IsAdmin {
		s.denyAudit(r, "non-admin tried to reset an administrator's password", marshalJSON(map[string]any{"userId": id}))
		writeError(w, r, http.StatusForbidden, "only administrators can reset administrator passwords")
		return
	}
	if target.AuthSource != "local" {
		writeError(w, r, http.StatusBadRequest, "only local users have a portal password; LDAP and Azure AD users change theirs in the directory")
		return
	}
	temporary, err := password.Generate(16)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "could not generate a password")
		return
	}
	hash, err := auth.HashPassword(temporary)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "could not set the password")
		return
	}
	if err := s.store.UpdateUserPassword(r.Context(), id, hash, true); err != nil {
		writeError(w, r, http.StatusInternalServerError, "could not set the password")
		return
	}
	revoked, _ := s.store.RevokeUserSessions(r.Context(), id, 0, time.Now().UTC())
	s.recordAudit(r, models.AuditLog{Action: "user.password_reset.success", ResourceType: "user", ResourceID: strconv.Itoa(id), ResourceName: target.Username, StatusCode: http.StatusOK, DetailsJSON: marshalJSON(map[string]int{"sessionsRevoked": revoked})})
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"temporaryPassword": temporary, "sessionsRevoked": revoked})
}

func (s *Server) handleRevokeUserSessions(w http.ResponseWriter, r *http.Request) {
	actor, _ := s.identityForRequest(r)
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	target, err := s.store.GetUserByID(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "user not found")
		return
	}
	if target.IsAdmin && !actor.User.IsAdmin {
		s.denyAudit(r, "non-admin tried to end an administrator's sessions", marshalJSON(map[string]any{"userId": id}))
		writeError(w, r, http.StatusForbidden, "only administrators can end administrator sessions")
		return
	}
	except := 0
	if id == actor.User.ID {
		except = currentSession(r).ID // keep the caller signed in
	}
	revoked, err := s.store.RevokeUserSessions(r.Context(), id, except, time.Now().UTC())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "could not end the sessions")
		return
	}
	s.recordAudit(r, models.AuditLog{Action: "session.revoke_user", ResourceType: "user", ResourceID: strconv.Itoa(id), ResourceName: target.Username, StatusCode: http.StatusOK, DetailsJSON: marshalJSON(map[string]int{"sessionsRevoked": revoked})})
	writeJSON(w, http.StatusOK, map[string]int{"sessionsRevoked": revoked})
}

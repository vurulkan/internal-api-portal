package api

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"api-portal/backend/internal/auth"
	"api-portal/backend/internal/models"
)

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		http.Error(w, "failed to load users", http.StatusInternalServerError)
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
		http.Error(w, "username is required", http.StatusBadRequest)
		return
	}
	if msg := passwordProblem(payload.Password); msg != "" {
		http.Error(w, msg, http.StatusBadRequest)
		return
	}
	if payload.IsAdmin && !actor.User.IsAdmin {
		s.denyAudit(r, "non-admin tried to create an administrator", marshalJSON(map[string]string{"username": payload.Username}))
		http.Error(w, "only administrators can create administrator accounts", http.StatusForbidden)
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
		http.Error(w, "failed to create user (is the username taken?)", http.StatusBadRequest)
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
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	request.ID = id
	request.Username = strings.TrimSpace(request.Username)
	if request.Username == "" {
		http.Error(w, "username is required", http.StatusBadRequest)
		return
	}
	if (target.IsAdmin || request.IsAdmin) && !actor.User.IsAdmin {
		s.denyAudit(r, "non-admin tried to change an administrator account", marshalJSON(map[string]any{"userId": id}))
		http.Error(w, "only administrators can manage administrator accounts", http.StatusForbidden)
		return
	}
	if msg := s.adminChangeProblem(r.Context(), actor, target, request.IsAdmin, request.IsActive); msg != "" {
		http.Error(w, msg, http.StatusConflict)
		return
	}
	if request.Password != "" {
		if target.AuthSource != "local" {
			http.Error(w, "passwords can only be set for local users", http.StatusBadRequest)
			return
		}
		if msg := passwordProblem(request.Password); msg != "" {
			http.Error(w, msg, http.StatusBadRequest)
			return
		}
	}
	if err := s.store.UpdateUser(r.Context(), request.User); err != nil {
		http.Error(w, "failed to update user", http.StatusBadRequest)
		return
	}
	if request.Password != "" {
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
	s.recordAudit(r, models.AuditLog{Action: "admin.user.update", ResourceType: "user", ResourceID: strconv.Itoa(id), ResourceName: request.Username, StatusCode: http.StatusOK,
		DetailsJSON: marshalJSON(map[string]any{"isAdmin": request.IsAdmin, "isActive": request.IsActive, "passwordChanged": request.Password != ""})})
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
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	if target.IsAdmin && !actor.User.IsAdmin {
		s.denyAudit(r, "non-admin tried to delete an administrator", marshalJSON(map[string]any{"userId": id}))
		http.Error(w, "only administrators can delete administrator accounts", http.StatusForbidden)
		return
	}
	if msg := s.adminChangeProblem(r.Context(), actor, target, false, false); msg != "" {
		http.Error(w, msg, http.StatusConflict)
		return
	}
	if err := s.store.DeleteUser(r.Context(), id); err != nil {
		http.Error(w, "failed to delete user", http.StatusBadRequest)
		return
	}
	s.recordAudit(r, models.AuditLog{Action: "admin.user.delete", ResourceType: "user", ResourceID: strconv.Itoa(id), ResourceName: target.Username, StatusCode: http.StatusOK})
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
	actor, _ := s.identityForRequest(r)
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	var payload []int
	if !decodeJSON(w, r, &payload) {
		return
	}
	target, err := s.store.GetUserByID(r.Context(), id)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	if target.IsAdmin && !actor.User.IsAdmin {
		s.denyAudit(r, "non-admin tried to change an administrator's groups", marshalJSON(map[string]any{"userId": id}))
		http.Error(w, "only administrators can manage administrator accounts", http.StatusForbidden)
		return
	}
	current, err := s.store.GetUserGroupIDs(r.Context(), id)
	if err != nil {
		http.Error(w, "failed to load user groups", http.StatusInternalServerError)
		return
	}
	if !s.allowGrant(w, r, actor, func() ([]string, error) { return s.store.ScopesForGroups(r.Context(), addedIDs(current, payload)) }) {
		return
	}
	if err := s.store.SetUserGroups(r.Context(), id, payload); err != nil {
		http.Error(w, "failed to update user groups", http.StatusBadRequest)
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
		http.Error(w, "failed to resolve permissions", http.StatusInternalServerError)
		return false
	}
	if missing := scopesBeyondActor(actor, granted); len(missing) > 0 {
		s.denyAudit(r, "grant exceeds the actor's own permissions", marshalJSON(map[string]any{"scopes": missing}))
		http.Error(w, "you can only grant permissions you hold yourself; missing: "+strings.Join(missing, ", "), http.StatusForbidden)
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

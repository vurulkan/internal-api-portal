package api

import (
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"api-portal/backend/internal/models"
)

// The admin lists carry what the tables show (group counts, members, where a role
// is used) so the console needs no request per row.

type adminUser struct {
	models.User
	GroupIDs []int `json:"groupIds"`
}

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load users")
		return
	}
	groups, err := s.store.UserGroupMap(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load users")
		return
	}
	out := make([]adminUser, 0, len(users))
	for _, user := range users {
		out = append(out, adminUser{User: user, GroupIDs: orEmpty(groups[user.ID])})
	}
	writeJSON(w, http.StatusOK, out)
}

type adminGroup struct {
	models.Group
	MemberIDs []int `json:"memberIds"`
	RoleIDs   []int `json:"roleIds"`
}

func (s *Server) handleListGroups(w http.ResponseWriter, r *http.Request) {
	groups, err := s.store.ListGroups(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load groups")
		return
	}
	members, err1 := s.store.GroupMemberMap(r.Context())
	roles, err2 := s.store.GroupRoleMap(r.Context())
	if err1 != nil || err2 != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load groups")
		return
	}
	out := make([]adminGroup, 0, len(groups))
	for _, group := range groups {
		out = append(out, adminGroup{Group: group, MemberIDs: orEmpty(members[group.ID]), RoleIDs: orEmpty(roles[group.ID])})
	}
	writeJSON(w, http.StatusOK, out)
}

type adminRole struct {
	models.Role
	PermissionCount int   `json:"permissionCount"`
	GroupIDs        []int `json:"groupIds"`
}

func (s *Server) handleListRoles(w http.ResponseWriter, r *http.Request) {
	roles, err := s.store.ListRoles(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load roles")
		return
	}
	counts, err1 := s.store.RolePermissionCounts(r.Context())
	groupRoles, err2 := s.store.GroupRoleMap(r.Context())
	if err1 != nil || err2 != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load roles")
		return
	}
	usedBy := map[int][]int{}
	for groupID, roleIDs := range groupRoles {
		for _, roleID := range roleIDs {
			usedBy[roleID] = append(usedBy[roleID], groupID)
		}
	}
	out := make([]adminRole, 0, len(roles))
	for _, role := range roles {
		ids := orEmpty(usedBy[role.ID])
		slices.Sort(ids)
		out = append(out, adminRole{Role: role, PermissionCount: counts[role.ID], GroupIDs: ids})
	}
	writeJSON(w, http.StatusOK, out)
}

// handleUserPermissions explains a user's effective permissions: every scope with
// the group / role it comes from. ?groupIds=1,2 previews another group set (the
// user editor shows what a change would grant before it is saved).
func (s *Server) handleUserPermissions(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	user, err := s.store.GetUserByID(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "user not found")
		return
	}
	var groupIDs []int
	if raw, ok := r.URL.Query()["groupIds"]; ok {
		for _, part := range strings.Split(strings.Join(raw, ","), ",") {
			if part = strings.TrimSpace(part); part == "" {
				continue
			}
			n, err := strconv.Atoi(part)
			if err != nil {
				writeError(w, r, http.StatusBadRequest, "groupIds must be a comma-separated list of ids")
				return
			}
			groupIDs = append(groupIDs, n)
		}
	} else if groupIDs, err = s.store.GetUserGroupIDs(r.Context(), id); err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load user groups")
		return
	}
	sources, err := s.store.PermissionSourcesForGroups(r.Context(), groupIDs)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to resolve permissions")
		return
	}
	scopes := []string{}
	seen := map[string]bool{}
	for _, src := range sources {
		if !seen[src.Scope] {
			seen[src.Scope] = true
			scopes = append(scopes, src.Scope)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"userId":   user.ID,
		"isAdmin":  user.IsAdmin,
		"groupIds": orEmpty(groupIDs),
		"scopes":   scopes,
		"sources":  sources,
	})
}

// handleGroupPermissions lists what a group's members get through the group, by
// source: its roles, the APIs it owns, and the API access lists it is on. Direct
// API access is not part of any role, so this is the one place that shows it all.
func (s *Server) handleGroupPermissions(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	if _, err := s.store.GetGroup(r.Context(), id); err != nil {
		writeError(w, r, http.StatusNotFound, "group not found")
		return
	}
	sources, err := s.store.PermissionSourcesForGroups(r.Context(), []int{id})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to resolve permissions")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"groupId": id, "sources": sources})
}

// handleBulkUserStatus activates or deactivates several users. The single-user
// rules hold for the whole batch (only admins change admins, nobody deactivates
// themselves or the last active admin); a batch that breaks one changes nothing.
func (s *Server) handleBulkUserStatus(w http.ResponseWriter, r *http.Request) {
	actor, _ := s.identityForRequest(r)
	var payload struct {
		UserIDs []int `json:"userIds"`
		Active  bool  `json:"active"`
	}
	if !decodeJSON(w, r, &payload) {
		return
	}
	auditTarget(r, "user", "", "")
	if len(payload.UserIDs) == 0 || len(payload.UserIDs) > 500 {
		writeError(w, r, http.StatusBadRequest, "userIds: 1 to 500 ids")
		return
	}
	adminsLeaving := 0
	for _, id := range payload.UserIDs {
		target, err := s.store.GetUserByID(r.Context(), id)
		if err != nil {
			writeError(w, r, http.StatusNotFound, "user "+strconv.Itoa(id)+" not found")
			return
		}
		if target.IsAdmin && !actor.User.IsAdmin {
			s.denyAudit(r, "non-admin tried to change an administrator account", marshalJSON(map[string]any{"userId": id}))
			writeError(w, r, http.StatusForbidden, "only administrators can manage administrator accounts")
			return
		}
		if !payload.Active && target.ID == actor.User.ID {
			writeError(w, r, http.StatusConflict, "you can't deactivate your own account")
			return
		}
		if !payload.Active && target.IsAdmin && target.IsActive {
			adminsLeaving++
		}
	}
	if adminsLeaving > 0 {
		count, err := s.store.CountActiveAdmins(r.Context())
		if err != nil || count-adminsLeaving < 1 {
			writeError(w, r, http.StatusConflict, "this would deactivate the last active administrator; promote another user first")
			return
		}
	}
	changed, err := s.store.SetUsersActive(r.Context(), payload.UserIDs, payload.Active)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to update users")
		return
	}
	revoked := 0
	if !payload.Active {
		for _, id := range changed {
			n, _ := s.store.RevokeUserSessions(r.Context(), id, 0, time.Now().UTC())
			revoked += n
		}
	}
	auditDetails(r, map[string]any{"userIds": changed, "active": payload.Active, "sessionsRevoked": revoked})
	writeJSON(w, http.StatusOK, map[string]any{"changed": orEmpty(changed), "sessionsRevoked": revoked})
}

// handleAddGroupMembers adds users to a group: like setting their groups, it is a
// grant (a delegated manager may only hand out what they hold) and only admins
// change administrators.
func (s *Server) handleAddGroupMembers(w http.ResponseWriter, r *http.Request) {
	actor, _ := s.identityForRequest(r)
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	auditTarget(r, "group", strconv.Itoa(id), "")
	group, err := s.store.GetGroup(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "group not found")
		return
	}
	auditTarget(r, "group", strconv.Itoa(id), group.Name)
	var payload struct {
		UserIDs []int `json:"userIds"`
	}
	if !decodeJSON(w, r, &payload) {
		return
	}
	if len(payload.UserIDs) == 0 || len(payload.UserIDs) > 500 {
		writeError(w, r, http.StatusBadRequest, "userIds: 1 to 500 ids")
		return
	}
	for _, userID := range payload.UserIDs {
		if !s.mayChangeMembership(w, r, actor, userID) {
			return
		}
	}
	if !s.allowGrant(w, r, actor, func() ([]string, error) { return s.store.ScopesForGroups(r.Context(), []int{id}) }) {
		return
	}
	added, err := s.store.AddGroupMembers(r.Context(), id, payload.UserIDs)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to add members")
		return
	}
	auditDetail(r, "userIds", added)
	writeJSON(w, http.StatusOK, map[string]any{"added": orEmpty(added)})
}

func (s *Server) handleRemoveGroupMember(w http.ResponseWriter, r *http.Request) {
	actor, _ := s.identityForRequest(r)
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	userID, _ := strconv.Atoi(chi.URLParam(r, "userId"))
	auditTarget(r, "group", strconv.Itoa(id), "")
	group, err := s.store.GetGroup(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "group not found")
		return
	}
	auditTarget(r, "group", strconv.Itoa(id), group.Name)
	if !s.mayChangeMembership(w, r, actor, userID) {
		return
	}
	removed, err := s.store.RemoveGroupMember(r.Context(), id, userID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to remove member")
		return
	}
	if !removed {
		writeError(w, r, http.StatusNotFound, "not a member of this group")
		return
	}
	auditDetail(r, "userId", userID)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) mayChangeMembership(w http.ResponseWriter, r *http.Request, actor *models.Identity, userID int) bool {
	target, err := s.store.GetUserByID(r.Context(), userID)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "user "+strconv.Itoa(userID)+" not found")
		return false
	}
	if target.IsAdmin && !actor.User.IsAdmin {
		s.denyAudit(r, "non-admin tried to change an administrator's groups", marshalJSON(map[string]any{"userId": userID}))
		writeError(w, r, http.StatusForbidden, "only administrators can manage administrator accounts")
		return false
	}
	return true
}

func orEmpty(ids []int) []int {
	if ids == nil {
		return []int{}
	}
	return ids
}

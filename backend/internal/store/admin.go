package store

import (
	"context"
	"database/sql"
	"strconv"
	"time"

	"api-portal/backend/internal/models"
)

// Aggregates for the admin console (2.0.0): who is in which group, what a role is
// used by, what deleting an API takes with it, and the overview counters.

// pairs runs a two-integer-column query into a map of the first to the seconds.
func (s *Store) pairs(ctx context.Context, query string, args ...any) (map[int][]int, error) {
	rows, err := s.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int][]int{}
	for rows.Next() {
		var key, value int
		if err := rows.Scan(&key, &value); err != nil {
			return nil, err
		}
		out[key] = append(out[key], value)
	}
	return out, rows.Err()
}

// UserGroupMap: user id → group ids.
func (s *Store) UserGroupMap(ctx context.Context) (map[int][]int, error) {
	return s.pairs(ctx, `SELECT user_id, group_id FROM user_groups ORDER BY user_id, group_id`)
}

// GroupMemberMap: group id → member user ids.
func (s *Store) GroupMemberMap(ctx context.Context) (map[int][]int, error) {
	return s.pairs(ctx, `SELECT group_id, user_id FROM user_groups ORDER BY group_id, user_id`)
}

// GroupRoleMap: group id → role ids.
func (s *Store) GroupRoleMap(ctx context.Context) (map[int][]int, error) {
	return s.pairs(ctx, `SELECT group_id, role_id FROM group_roles ORDER BY group_id, role_id`)
}

// RolePermissionCounts: role id → number of scopes.
func (s *Store) RolePermissionCounts(ctx context.Context) (map[int]int, error) {
	rows, err := s.conn.QueryContext(ctx, `SELECT role_id, COUNT(*) FROM permissions GROUP BY role_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int]int{}
	for rows.Next() {
		var id, n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}

// AddGroupMembers adds users to a group and returns the ids that weren't members yet.
func (s *Store) AddGroupMembers(ctx context.Context, groupID int, userIDs []int) ([]int, error) {
	var added []int
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		for _, id := range userIDs {
			res, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES (?, ?)`, id, groupID)
			if err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); n > 0 {
				added = append(added, id)
			}
		}
		return nil
	})
	return added, err
}

// RemoveGroupMember reports whether the user was a member.
func (s *Store) RemoveGroupMember(ctx context.Context, groupID, userID int) (bool, error) {
	res, err := s.conn.ExecContext(ctx, `DELETE FROM user_groups WHERE group_id = ? AND user_id = ?`, groupID, userID)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// APIImpact is what deleting an API removes besides the definition itself.
type APIImpact struct {
	AccessGrants   int  `json:"accessGrants"`
	RoleScopes     int  `json:"roleScopes"`
	Favorites      int  `json:"favorites"`
	Operations     int  `json:"operations"`
	HistoryEntries int  `json:"historyEntries"`
	HasOwnerGroup  bool `json:"hasOwnerGroup"`
}

func (s *Store) APIImpact(ctx context.Context, apiID int) (APIImpact, error) {
	var out APIImpact
	var owner sql.NullInt64
	prefix := "api:" + strconv.Itoa(apiID) + ":"
	err := s.conn.QueryRowContext(ctx, `SELECT
		(SELECT COUNT(*) FROM api_access WHERE api_id = ?),
		(SELECT COUNT(*) FROM permissions WHERE substr(scope, 1, ?) = ?),
		(SELECT COUNT(*) FROM user_favorites WHERE api_id = ?),
		(SELECT COUNT(*) FROM api_operations WHERE api_id = ?),
		(SELECT COUNT(*) FROM api_spec_history WHERE api_id = ?),
		(SELECT owner_group_id FROM api_definitions WHERE id = ?)`,
		apiID, len(prefix), prefix, apiID, apiID, apiID, apiID).
		Scan(&out.AccessGrants, &out.RoleScopes, &out.Favorites, &out.Operations, &out.HistoryEntries, &owner)
	out.HasOwnerGroup = owner.Valid
	return out, err
}

// UserCounts for the overview: accounts, active ones, and those signed in since.
type UserCounts struct {
	Total       int `json:"total"`
	Active      int `json:"active"`
	Admins      int `json:"admins"`
	SignedInDay int `json:"signedIn24h"`
}

func (s *Store) CountUsersSummary(ctx context.Context, since time.Time) (UserCounts, error) {
	var out UserCounts
	err := s.conn.QueryRowContext(ctx, `SELECT COUNT(*),
		COALESCE(SUM(is_active), 0),
		COALESCE(SUM(CASE WHEN is_admin = 1 AND is_active = 1 THEN 1 ELSE 0 END), 0),
		COALESCE(SUM(CASE WHEN last_login_at >= ? THEN 1 ELSE 0 END), 0)
		FROM users`, since.UTC()).Scan(&out.Total, &out.Active, &out.Admins, &out.SignedInDay)
	return out, err
}

// AuditOutcomes counts audit entries since a time by outcome, for actions starting
// with prefix ("" : all actions).
func (s *Store) AuditOutcomes(ctx context.Context, prefix string, since time.Time) (map[string]int, error) {
	where, args := auditWhere(models.AuditFilter{ActionPrefix: prefix, From: since})
	rows, err := s.conn.QueryContext(ctx, `SELECT outcome, COUNT(*)`+where+` GROUP BY outcome`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var outcome string
		var n int
		if err := rows.Scan(&outcome, &n); err != nil {
			return nil, err
		}
		out[outcome] = n
	}
	return out, rows.Err()
}

// DatabaseSize is the size of the main database file, in bytes.
func (s *Store) DatabaseSize(ctx context.Context) (int64, error) {
	var pages, size int64
	if err := s.conn.QueryRowContext(ctx, `PRAGMA page_count`).Scan(&pages); err != nil {
		return 0, err
	}
	if err := s.conn.QueryRowContext(ctx, `PRAGMA page_size`).Scan(&size); err != nil {
		return 0, err
	}
	return pages * size, nil
}

// SchemaVersion is the highest applied migration.
func (s *Store) SchemaVersion(ctx context.Context) (int, error) {
	var v sql.NullInt64
	err := s.conn.QueryRowContext(ctx, `SELECT MAX(version) FROM schema_migrations`).Scan(&v)
	return int(v.Int64), err
}

// PermissionSource says where one of a user's scopes comes from.
type PermissionSource struct {
	Scope     string `json:"scope"`
	Via       string `json:"via"` // role, owner (the API's owner group), access (an API access grant)
	GroupID   int    `json:"groupId"`
	GroupName string `json:"groupName"`
	RoleID    int    `json:"roleId,omitempty"`
	RoleName  string `json:"roleName,omitempty"`
}

// PermissionSourcesForGroups lists every scope the groups grant, with its origin:
// the same three paths ResolvePermissions follows.
func (s *Store) PermissionSourcesForGroups(ctx context.Context, groupIDs []int) ([]PermissionSource, error) {
	out := []PermissionSource{}
	if len(groupIDs) == 0 {
		return out, nil
	}
	in := placeholders(len(groupIDs))
	args := append(append(append([]any{}, intArgs(groupIDs)...), intArgs(groupIDs)...), intArgs(groupIDs)...)
	rows, err := s.conn.QueryContext(ctx, `
		SELECT p.scope, 'role', g.id, g.name, r.id, r.name FROM permissions p
			INNER JOIN roles r ON r.id = p.role_id
			INNER JOIN group_roles gr ON gr.role_id = r.id
			INNER JOIN "groups" g ON g.id = gr.group_id
			WHERE g.id IN (`+in+`)
		UNION ALL SELECT 'api:' || a.id || ':manage', 'owner', g.id, g.name, 0, '' FROM api_definitions a
			INNER JOIN "groups" g ON g.id = a.owner_group_id
			WHERE g.id IN (`+in+`)
		UNION ALL SELECT 'api:' || aa.api_id || ':' || aa.level, 'access', g.id, g.name, 0, '' FROM api_access aa
			INNER JOIN "groups" g ON g.id = aa.group_id
			WHERE g.id IN (`+in+`)
		ORDER BY 1, 3, 5`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var src PermissionSource
		if err := rows.Scan(&src.Scope, &src.Via, &src.GroupID, &src.GroupName, &src.RoleID, &src.RoleName); err != nil {
			return nil, err
		}
		out = append(out, src)
	}
	return out, rows.Err()
}

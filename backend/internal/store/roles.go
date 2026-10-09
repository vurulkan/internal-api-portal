package store

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"api-portal/backend/internal/models"
)

func (s *Store) ListRoles(ctx context.Context) ([]models.Role, error) {
	rows, err := s.conn.QueryContext(ctx, `SELECT id, name, description, created_at FROM roles ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var roles []models.Role
	for rows.Next() {
		var role models.Role
		if err := rows.Scan(&role.ID, &role.Name, &role.Description, &role.CreatedAt); err != nil {
			return nil, err
		}
		roles = append(roles, role)
	}
	return roles, nil
}

func (s *Store) CreateRole(ctx context.Context, name, description string) (int, error) {
	result, err := s.conn.ExecContext(ctx, `INSERT INTO roles (name, description, created_at) VALUES (?, ?, ?)`, name, description, time.Now().UTC())
	if err != nil {
		return 0, err
	}
	id, _ := result.LastInsertId()
	return int(id), nil
}

func (s *Store) UpdateRole(ctx context.Context, role models.Role) error {
	_, err := s.conn.ExecContext(ctx, `UPDATE roles SET name = ?, description = ? WHERE id = ?`, role.Name, role.Description, role.ID)
	return err
}

func (s *Store) DeleteRole(ctx context.Context, id int) error {
	return s.withTx(ctx, func(tx *sql.Tx) error {
		for _, stmt := range []string{
			`DELETE FROM permissions WHERE role_id = ?`,
			`DELETE FROM group_roles WHERE role_id = ?`,
			`DELETE FROM roles WHERE id = ?`,
		} {
			if _, err := tx.ExecContext(ctx, stmt, id); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Store) SetGroupRoles(ctx context.Context, groupID int, roleIDs []int) error {
	return s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM group_roles WHERE group_id = ?`, groupID); err != nil {
			return err
		}
		for _, roleID := range roleIDs {
			if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO group_roles (group_id, role_id) VALUES (?, ?)`, groupID, roleID); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Store) GetGroupRoleIDs(ctx context.Context, groupID int) ([]int, error) {
	rows, err := s.conn.QueryContext(ctx, `SELECT role_id FROM group_roles WHERE group_id = ? ORDER BY role_id`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

func (s *Store) ListRolePermissions(ctx context.Context, roleID int) ([]models.Permission, error) {
	rows, err := s.conn.QueryContext(ctx, `SELECT id, role_id, scope, description, created_at FROM permissions WHERE role_id = ? ORDER BY scope`, roleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var permissions []models.Permission
	for rows.Next() {
		var permission models.Permission
		if err := rows.Scan(&permission.ID, &permission.RoleID, &permission.Scope, &permission.Description, &permission.CreatedAt); err != nil {
			return nil, err
		}
		permissions = append(permissions, permission)
	}
	return permissions, nil
}

func (s *Store) AddRolePermission(ctx context.Context, roleID int, scope, description string) error {
	_, err := s.conn.ExecContext(ctx, `INSERT INTO permissions (role_id, scope, description, created_at) VALUES (?, ?, ?, ?)`, roleID, strings.ToLower(scope), description, time.Now().UTC())
	return err
}

func (s *Store) ReplaceRolePermissions(ctx context.Context, roleID int, scopes []string) error {
	tx, err := s.conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM permissions WHERE role_id = ?`, roleID); err != nil {
		return err
	}
	now := time.Now().UTC()
	seen := map[string]struct{}{}
	for _, scope := range scopes {
		scope = strings.ToLower(strings.TrimSpace(scope))
		if scope == "" {
			continue
		}
		if _, ok := seen[scope]; ok {
			continue
		}
		seen[scope] = struct{}{}
		if _, err := tx.ExecContext(ctx, `INSERT INTO permissions (role_id, scope, description, created_at) VALUES (?, ?, '', ?)`, roleID, scope, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) DeletePermission(ctx context.Context, permissionID int) error {
	_, err := s.conn.ExecContext(ctx, `DELETE FROM permissions WHERE id = ?`, permissionID)
	return err
}

// ScopesForGroups returns the distinct scopes the given groups grant through their roles.
func (s *Store) ScopesForGroups(ctx context.Context, groupIDs []int) ([]string, error) {
	if len(groupIDs) == 0 {
		return nil, nil
	}
	query := `SELECT DISTINCT p.scope FROM permissions p INNER JOIN group_roles gr ON gr.role_id = p.role_id WHERE gr.group_id IN (` + placeholders(len(groupIDs)) + `)`
	return s.scopes(ctx, query, intArgs(groupIDs)...)
}

// ScopesForRoles returns the distinct scopes the given roles grant.
func (s *Store) ScopesForRoles(ctx context.Context, roleIDs []int) ([]string, error) {
	if len(roleIDs) == 0 {
		return nil, nil
	}
	query := `SELECT DISTINCT scope FROM permissions WHERE role_id IN (` + placeholders(len(roleIDs)) + `)`
	return s.scopes(ctx, query, intArgs(roleIDs)...)
}

func (s *Store) scopes(ctx context.Context, query string, args ...any) ([]string, error) {
	rows, err := s.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var scope string
		if err := rows.Scan(&scope); err != nil {
			return nil, err
		}
		out = append(out, scope)
	}
	return out, rows.Err()
}

func (s *Store) ResolvePermissions(ctx context.Context, userID int) ([]string, error) {
	rows, err := s.conn.QueryContext(ctx, `
		SELECT DISTINCT p.scope
		FROM permissions p
		INNER JOIN group_roles gr ON gr.role_id = p.role_id
		INNER JOIN user_groups ug ON ug.group_id = gr.group_id
		WHERE ug.user_id = ?
		ORDER BY p.scope`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var scopes []string
	for rows.Next() {
		var scope string
		if err := rows.Scan(&scope); err != nil {
			return nil, err
		}
		scopes = append(scopes, scope)
	}
	return scopes, nil
}

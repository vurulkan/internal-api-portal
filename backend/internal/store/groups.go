package store

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"api-portal/backend/internal/models"
)

func (s *Store) ListGroups(ctx context.Context) ([]models.Group, error) {
	rows, err := s.conn.QueryContext(ctx, `SELECT id, name, description, created_at, azure_group_id, ldap_group_dn FROM "groups" ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var groups []models.Group
	for rows.Next() {
		var group models.Group
		if err := rows.Scan(&group.ID, &group.Name, &group.Description, &group.CreatedAt, &group.AzureGroupID, &group.LDAPGroupDN); err != nil {
			return nil, err
		}
		groups = append(groups, group)
	}
	return groups, nil
}

func (s *Store) GetGroup(ctx context.Context, id int) (*models.Group, error) {
	var group models.Group
	err := s.conn.QueryRowContext(ctx, `SELECT id, name, description, created_at, azure_group_id, ldap_group_dn FROM "groups" WHERE id = ?`, id).
		Scan(&group.ID, &group.Name, &group.Description, &group.CreatedAt, &group.AzureGroupID, &group.LDAPGroupDN)
	return &group, err
}

func (s *Store) CreateGroup(ctx context.Context, name, description string) (int, error) {
	return s.CreateGroupWithMapping(ctx, models.Group{Name: name, Description: description})
}

func (s *Store) CreateGroupWithMapping(ctx context.Context, g models.Group) (int, error) {
	result, err := s.conn.ExecContext(ctx, `INSERT INTO "groups" (name, description, created_at, azure_group_id, ldap_group_dn) VALUES (?, ?, ?, ?, ?)`,
		g.Name, g.Description, time.Now().UTC(), strings.TrimSpace(g.AzureGroupID), strings.TrimSpace(g.LDAPGroupDN))
	if err != nil {
		return 0, err
	}
	id, _ := result.LastInsertId()
	return int(id), nil
}

func (s *Store) UpdateGroup(ctx context.Context, g models.Group) error {
	_, err := s.conn.ExecContext(ctx, `UPDATE "groups" SET name = ?, description = ?, azure_group_id = ?, ldap_group_dn = ? WHERE id = ?`,
		g.Name, g.Description, strings.TrimSpace(g.AzureGroupID), strings.TrimSpace(g.LDAPGroupDN), g.ID)
	return err
}

// SyncDirectoryGroups mirrors directory group membership into portal groups for a
// user signing in through source ("azuread" or "ldap"): for every portal group
// mapped to a directory group of that source, the user is added when isMember says
// so and removed otherwise. Unmapped groups are left alone. Returns the names of
// the groups joined and left.
func (s *Store) SyncDirectoryGroups(ctx context.Context, userID int, source string, isMember func(models.Group) bool) (added, removed []string, err error) {
	column := "azure_group_id"
	if source == "ldap" {
		column = "ldap_group_dn"
	}
	groups, err := s.ListGroups(ctx)
	if err != nil {
		return nil, nil, err
	}
	current, err := s.GetUserGroupIDs(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	have := map[int]bool{}
	for _, id := range current {
		have[id] = true
	}
	err = s.withTx(ctx, func(tx *sql.Tx) error {
		for _, g := range groups {
			mapped := (column == "azure_group_id" && g.AzureGroupID != "") || (column == "ldap_group_dn" && g.LDAPGroupDN != "")
			if !mapped {
				continue
			}
			member := isMember(g)
			switch {
			case member && !have[g.ID]:
				if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES (?, ?)`, userID, g.ID); err != nil {
					return err
				}
				added = append(added, g.Name)
			case !member && have[g.ID]:
				if _, err := tx.ExecContext(ctx, `DELETE FROM user_groups WHERE user_id = ? AND group_id = ?`, userID, g.ID); err != nil {
					return err
				}
				removed = append(removed, g.Name)
			}
		}
		return nil
	})
	return added, removed, err
}

func (s *Store) DeleteGroup(ctx context.Context, id int) error {
	return s.withTx(ctx, func(tx *sql.Tx) error {
		for _, stmt := range []string{
			`DELETE FROM group_roles WHERE group_id = ?`,
			`DELETE FROM user_groups WHERE group_id = ?`,
			`DELETE FROM "groups" WHERE id = ?`,
		} {
			if _, err := tx.ExecContext(ctx, stmt, id); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Store) SetUserGroups(ctx context.Context, userID int, groupIDs []int) error {
	return s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM user_groups WHERE user_id = ?`, userID); err != nil {
			return err
		}
		for _, groupID := range groupIDs {
			if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES (?, ?)`, userID, groupID); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Store) GetUserGroupIDs(ctx context.Context, userID int) ([]int, error) {
	rows, err := s.conn.QueryContext(ctx, `SELECT group_id FROM user_groups WHERE user_id = ? ORDER BY group_id`, userID)
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

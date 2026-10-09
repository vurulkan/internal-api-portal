package store

import (
	"context"
	"database/sql"
	"time"

	"api-portal/backend/internal/models"
)

func (s *Store) ListGroups(ctx context.Context) ([]models.Group, error) {
	rows, err := s.conn.QueryContext(ctx, `SELECT id, name, description, created_at FROM groups ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var groups []models.Group
	for rows.Next() {
		var group models.Group
		if err := rows.Scan(&group.ID, &group.Name, &group.Description, &group.CreatedAt); err != nil {
			return nil, err
		}
		groups = append(groups, group)
	}
	return groups, nil
}

func (s *Store) CreateGroup(ctx context.Context, name, description string) (int, error) {
	result, err := s.conn.ExecContext(ctx, `INSERT INTO groups (name, description, created_at) VALUES (?, ?, ?)`, name, description, time.Now().UTC())
	if err != nil {
		return 0, err
	}
	id, _ := result.LastInsertId()
	return int(id), nil
}

func (s *Store) UpdateGroup(ctx context.Context, id int, name, description string) error {
	_, err := s.conn.ExecContext(ctx, `UPDATE groups SET name = ?, description = ? WHERE id = ?`, name, description, id)
	return err
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

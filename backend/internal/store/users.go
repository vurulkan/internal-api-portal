package store

import (
	"context"
	"database/sql"
	"time"

	"api-portal/backend/internal/models"
)

const userColumns = `id, username, display_name, email, password_hash, auth_source, must_change_password, is_active, is_admin, external_id, created_at, updated_at`

func (s *Store) GetUserByUsername(ctx context.Context, username string) (*models.User, error) {
	row := s.conn.QueryRowContext(ctx, `SELECT `+userColumns+` FROM users WHERE username = ?`, username)
	return scanUser(row)
}

func (s *Store) GetUserByEmail(ctx context.Context, email string) (*models.User, error) {
	row := s.conn.QueryRowContext(ctx, `SELECT `+userColumns+` FROM users WHERE email = ?`, email)
	return scanUser(row)
}

// GetAzureUserByExternalID finds the Azure AD account bound to a tenant:object id.
func (s *Store) GetAzureUserByExternalID(ctx context.Context, externalID string) (*models.User, error) {
	row := s.conn.QueryRowContext(ctx, `SELECT `+userColumns+` FROM users WHERE auth_source = 'azuread' AND external_id = ?`, externalID)
	return scanUser(row)
}

// GetUnboundAzureUser finds an Azure AD account created before external ids were
// stored (matched on e-mail, else on the username it was created with) so it can be
// bound once. Local and LDAP accounts are never returned.
func (s *Store) GetUnboundAzureUser(ctx context.Context, email, username string) (*models.User, error) {
	row := s.conn.QueryRowContext(ctx, `SELECT `+userColumns+` FROM users
		WHERE auth_source = 'azuread' AND external_id = ''
		  AND ((? <> '' AND lower(email) = lower(?)) OR (? <> '' AND username = ?))
		ORDER BY id LIMIT 1`, email, email, username, username)
	return scanUser(row)
}

func (s *Store) SetUserExternalID(ctx context.Context, userID int, externalID string) error {
	_, err := s.conn.ExecContext(ctx, `UPDATE users SET external_id = ?, updated_at = ? WHERE id = ?`, externalID, time.Now().UTC(), userID)
	return err
}

func (s *Store) CountActiveAdmins(ctx context.Context) (int, error) {
	var count int
	err := s.conn.QueryRowContext(ctx, `SELECT COUNT(1) FROM users WHERE is_admin = 1 AND is_active = 1`).Scan(&count)
	return count, err
}

func (s *Store) GetUserByID(ctx context.Context, id int) (*models.User, error) {
	row := s.conn.QueryRowContext(ctx, `SELECT `+userColumns+` FROM users WHERE id = ?`, id)
	return scanUser(row)
}

func (s *Store) ListUsers(ctx context.Context) ([]models.User, error) {
	rows, err := s.conn.QueryContext(ctx, `SELECT `+userColumns+` FROM users ORDER BY username`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []models.User
	for rows.Next() {
		user, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, *user)
	}
	return users, nil
}

func (s *Store) CreateUser(ctx context.Context, user models.User) (int, error) {
	now := time.Now().UTC()
	result, err := s.conn.ExecContext(ctx, `INSERT INTO users (username, display_name, email, password_hash, auth_source, must_change_password, is_active, is_admin, external_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		user.Username, user.DisplayName, user.Email, user.PasswordHash, defaultString(user.AuthSource, "local"), boolInt(user.MustChangePassword), boolInt(user.IsActive), boolInt(user.IsAdmin), user.ExternalID, now, now)
	if err != nil {
		return 0, err
	}
	id, _ := result.LastInsertId()
	return int(id), nil
}

func (s *Store) UpdateUser(ctx context.Context, user models.User) error {
	// auth_source is deliberately not updatable: switching an LDAP / Azure AD account
	// to "local" would let whoever sets its password log in as that person.
	_, err := s.conn.ExecContext(ctx, `UPDATE users SET username = ?, display_name = ?, email = ?, must_change_password = ?, is_active = ?, is_admin = ?, updated_at = ? WHERE id = ?`,
		user.Username, user.DisplayName, user.Email, boolInt(user.MustChangePassword), boolInt(user.IsActive), boolInt(user.IsAdmin), time.Now().UTC(), user.ID)
	return err
}

func (s *Store) UpdateUserPassword(ctx context.Context, userID int, passwordHash string, mustChange bool) error {
	_, err := s.conn.ExecContext(ctx, `UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = ? WHERE id = ?`, passwordHash, boolInt(mustChange), time.Now().UTC(), userID)
	return err
}

func (s *Store) DeleteUser(ctx context.Context, id int) error {
	return s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM user_groups WHERE user_id = ?`, id); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, id)
		return err
	})
}

// ImportLDAPUsers creates or refreshes LDAP accounts, all or nothing. An existing
// local or Azure AD account with the same username is left alone and reported in
// skipped: importing used to silently turn such accounts into LDAP accounts.
func (s *Store) ImportLDAPUsers(ctx context.Context, users []models.LDAPUser) (skipped []string, err error) {
	now := time.Now().UTC()
	err = s.withTx(ctx, func(tx *sql.Tx) error {
		for _, user := range users {
			result, err := tx.ExecContext(ctx, `INSERT INTO users (username, display_name, email, password_hash, auth_source, must_change_password, is_active, is_admin, created_at, updated_at)
				VALUES (?, ?, ?, '', 'ldap', 0, 1, 0, ?, ?)
				ON CONFLICT(username) DO UPDATE SET display_name = excluded.display_name, email = excluded.email, updated_at = excluded.updated_at
				WHERE users.auth_source = 'ldap'`,
				user.Username, user.DisplayName, user.Email, now, now)
			if err != nil {
				return err
			}
			if n, _ := result.RowsAffected(); n == 0 {
				skipped = append(skipped, user.Username)
			}
		}
		return nil
	})
	return skipped, err
}

func scanUser(scanner interface{ Scan(...any) error }) (*models.User, error) {
	var user models.User
	var mustChange, isActive, isAdmin int
	if err := scanner.Scan(&user.ID, &user.Username, &user.DisplayName, &user.Email, &user.PasswordHash, &user.AuthSource, &mustChange, &isActive, &isAdmin, &user.ExternalID, &user.CreatedAt, &user.UpdatedAt); err != nil {
		return nil, err
	}
	user.MustChangePassword = mustChange == 1
	user.IsActive = isActive == 1
	user.IsAdmin = isAdmin == 1
	return &user, nil
}

package store

import (
	"context"
	"database/sql"
	"time"

	"api-portal/backend/internal/models"
)

const userColumns = `id, username, display_name, email, password_hash, auth_source, must_change_password, is_active, is_admin, external_id, created_at, updated_at, last_login_at`

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

// GetUnboundAzureUser finds the Azure AD account to bind at a first Microsoft
// sign-in: a pre-registered (or pre-1.1.0) account that has never been bound to an
// Azure identity. Only Azure AD accounts are considered, never local or LDAP ones.
// The sign-in name (preferred_username, usually the UPN) is tried first; the e-mail
// claim only when no account has that name, and only when exactly one unbound
// account has that address (the e-mail claim isn't reliable enough to choose
// between accounts).
func (s *Store) GetUnboundAzureUser(ctx context.Context, email, username string) (*models.User, error) {
	if username != "" {
		row := s.conn.QueryRowContext(ctx, `SELECT `+userColumns+` FROM users
			WHERE auth_source = 'azuread' AND external_id = '' AND username = ?`, username)
		if user, err := scanUser(row); err == nil {
			return user, nil
		}
	}
	if email == "" {
		return nil, sql.ErrNoRows
	}
	rows, err := s.conn.QueryContext(ctx, `SELECT `+userColumns+` FROM users
		WHERE auth_source = 'azuread' AND external_id = '' AND lower(email) = lower(?) LIMIT 2`, email)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var found []*models.User
	for rows.Next() {
		user, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		found = append(found, user)
	}
	if len(found) != 1 {
		return nil, sql.ErrNoRows
	}
	return found[0], nil
}

func (s *Store) SetUserExternalID(ctx context.Context, userID int, externalID string) error {
	_, err := s.conn.ExecContext(ctx, `UPDATE users SET external_id = ?, updated_at = ? WHERE id = ?`, externalID, time.Now().UTC(), userID)
	return err
}

// RecordLogin stamps a successful sign-in.
func (s *Store) RecordLogin(ctx context.Context, userID int, at time.Time) error {
	_, err := s.conn.ExecContext(ctx, `UPDATE users SET last_login_at = ? WHERE id = ?`, at.UTC(), userID)
	return err
}

// SetUsersActive activates or deactivates several accounts at once and returns the
// ids it changed (already in that state: left out).
func (s *Store) SetUsersActive(ctx context.Context, ids []int, active bool) ([]int, error) {
	var changed []int
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		now := time.Now().UTC()
		for _, id := range ids {
			res, err := tx.ExecContext(ctx, `UPDATE users SET is_active = ?, updated_at = ? WHERE id = ? AND is_active <> ?`, boolInt(active), now, id, boolInt(active))
			if err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); n > 0 {
				changed = append(changed, id)
			}
		}
		return nil
	})
	return changed, err
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
	var lastLogin sql.NullTime
	if err := scanner.Scan(&user.ID, &user.Username, &user.DisplayName, &user.Email, &user.PasswordHash, &user.AuthSource, &mustChange, &isActive, &isAdmin, &user.ExternalID, &user.CreatedAt, &user.UpdatedAt, &lastLogin); err != nil {
		return nil, err
	}
	if lastLogin.Valid {
		t := lastLogin.Time.UTC()
		user.LastLoginAt = &t
	}
	user.MustChangePassword = mustChange == 1
	user.IsActive = isActive == 1
	user.IsAdmin = isAdmin == 1
	return &user, nil
}

func (s *Store) CountUsers(ctx context.Context) (int, error) {
	var count int
	err := s.conn.QueryRowContext(ctx, `SELECT COUNT(1) FROM users`).Scan(&count)
	return count, err
}

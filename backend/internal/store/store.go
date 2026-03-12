package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"api-portal/backend/internal/models"
)

type Store struct {
	conn *sql.DB
	key  []byte
}

func New(conn *sql.DB) (*Store, error) {
	key, err := ensureKey(context.Background(), conn)
	if err != nil {
		return nil, err
	}
	return &Store{conn: conn, key: key}, nil
}

func (s *Store) SigningKey() []byte {
	return s.key
}

func ensureKey(ctx context.Context, conn *sql.DB) ([]byte, error) {
	var key []byte
	err := conn.QueryRowContext(ctx, `SELECT signing_key FROM app_secrets WHERE id = 1`).Scan(&key)
	if err == nil && len(key) > 0 {
		return key, nil
	}
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	key = make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	if _, err := conn.ExecContext(ctx, `INSERT OR REPLACE INTO app_secrets (id, signing_key) VALUES (1, ?)`, key); err != nil {
		return nil, err
	}
	return key, nil
}

func (s *Store) EnsureDefaultAdmin(ctx context.Context, passwordHash string, sessionMinutes int) error {
	var count int
	if err := s.conn.QueryRowContext(ctx, `SELECT COUNT(1) FROM users`).Scan(&count); err != nil {
		return err
	}
	now := time.Now().UTC()
	if _, err := s.conn.ExecContext(ctx, `INSERT OR REPLACE INTO session_settings (id, session_minutes) VALUES (1, ?)`, sessionMinutes); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	_, err := s.conn.ExecContext(ctx, `INSERT INTO users (username, display_name, email, password_hash, auth_source, must_change_password, is_active, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, 'local', 1, 1, 1, ?, ?)`, "admin", "Administrator", "", passwordHash, now, now)
	return err
}

func (s *Store) GetUserByUsername(ctx context.Context, username string) (*models.User, error) {
	row := s.conn.QueryRowContext(ctx, `SELECT id, username, display_name, email, password_hash, auth_source, must_change_password, is_active, is_admin, created_at, updated_at FROM users WHERE username = ?`, username)
	return scanUser(row)
}

func (s *Store) GetUserByID(ctx context.Context, id int) (*models.User, error) {
	row := s.conn.QueryRowContext(ctx, `SELECT id, username, display_name, email, password_hash, auth_source, must_change_password, is_active, is_admin, created_at, updated_at FROM users WHERE id = ?`, id)
	return scanUser(row)
}

func (s *Store) ListUsers(ctx context.Context) ([]models.User, error) {
	rows, err := s.conn.QueryContext(ctx, `SELECT id, username, display_name, email, password_hash, auth_source, must_change_password, is_active, is_admin, created_at, updated_at FROM users ORDER BY username`)
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
	result, err := s.conn.ExecContext(ctx, `INSERT INTO users (username, display_name, email, password_hash, auth_source, must_change_password, is_active, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		user.Username, user.DisplayName, user.Email, user.PasswordHash, defaultString(user.AuthSource, "local"), boolInt(user.MustChangePassword), boolInt(user.IsActive), boolInt(user.IsAdmin), now, now)
	if err != nil {
		return 0, err
	}
	id, _ := result.LastInsertId()
	return int(id), nil
}

func (s *Store) UpdateUser(ctx context.Context, user models.User) error {
	_, err := s.conn.ExecContext(ctx, `UPDATE users SET username = ?, display_name = ?, email = ?, auth_source = ?, must_change_password = ?, is_active = ?, is_admin = ?, updated_at = ? WHERE id = ?`,
		user.Username, user.DisplayName, user.Email, defaultString(user.AuthSource, "local"), boolInt(user.MustChangePassword), boolInt(user.IsActive), boolInt(user.IsAdmin), time.Now().UTC(), user.ID)
	return err
}

func (s *Store) UpdateUserPassword(ctx context.Context, userID int, passwordHash string, mustChange bool) error {
	_, err := s.conn.ExecContext(ctx, `UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = ? WHERE id = ?`, passwordHash, boolInt(mustChange), time.Now().UTC(), userID)
	return err
}

func (s *Store) DeleteUser(ctx context.Context, id int) error {
	if _, err := s.conn.ExecContext(ctx, `DELETE FROM user_groups WHERE user_id = ?`, id); err != nil {
		return err
	}
	_, err := s.conn.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, id)
	return err
}

func (s *Store) ImportLDAPUsers(ctx context.Context, users []models.LDAPUser) error {
	now := time.Now().UTC()
	for _, user := range users {
		if _, err := s.conn.ExecContext(ctx, `INSERT INTO users (username, display_name, email, password_hash, auth_source, must_change_password, is_active, is_admin, created_at, updated_at)
			VALUES (?, ?, ?, '', 'ldap', 0, 1, 0, ?, ?)
			ON CONFLICT(username) DO UPDATE SET display_name = excluded.display_name, email = excluded.email, auth_source = 'ldap', updated_at = excluded.updated_at`,
			user.Username, user.DisplayName, user.Email, now, now); err != nil {
			return err
		}
	}
	return nil
}

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
	if _, err := s.conn.ExecContext(ctx, `DELETE FROM group_roles WHERE group_id = ?`, id); err != nil {
		return err
	}
	if _, err := s.conn.ExecContext(ctx, `DELETE FROM user_groups WHERE group_id = ?`, id); err != nil {
		return err
	}
	_, err := s.conn.ExecContext(ctx, `DELETE FROM groups WHERE id = ?`, id)
	return err
}

func (s *Store) SetUserGroups(ctx context.Context, userID int, groupIDs []int) error {
	if _, err := s.conn.ExecContext(ctx, `DELETE FROM user_groups WHERE user_id = ?`, userID); err != nil {
		return err
	}
	for _, groupID := range groupIDs {
		if _, err := s.conn.ExecContext(ctx, `INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)`, userID, groupID); err != nil {
			return err
		}
	}
	return nil
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
	if _, err := s.conn.ExecContext(ctx, `DELETE FROM permissions WHERE role_id = ?`, id); err != nil {
		return err
	}
	if _, err := s.conn.ExecContext(ctx, `DELETE FROM group_roles WHERE role_id = ?`, id); err != nil {
		return err
	}
	_, err := s.conn.ExecContext(ctx, `DELETE FROM roles WHERE id = ?`, id)
	return err
}

func (s *Store) SetGroupRoles(ctx context.Context, groupID int, roleIDs []int) error {
	if _, err := s.conn.ExecContext(ctx, `DELETE FROM group_roles WHERE group_id = ?`, groupID); err != nil {
		return err
	}
	for _, roleID := range roleIDs {
		if _, err := s.conn.ExecContext(ctx, `INSERT INTO group_roles (group_id, role_id) VALUES (?, ?)`, groupID, roleID); err != nil {
			return err
		}
	}
	return nil
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

func (s *Store) GetLDAPConfig(ctx context.Context) (*models.LDAPConfig, error) {
	var cfg models.LDAPConfig
	var enabled, useSSL, startTLS, skipVerify int
	var bindPasswordEnc string
	var userBaseDNSRaw string
	err := s.conn.QueryRowContext(ctx, `SELECT enabled, url, host, port, use_ssl, start_tls, skip_verify, timeout_seconds, bind_dn, bind_password_enc, user_base_dn, user_base_dns, user_filter, username_attribute, display_name_attribute, email_attribute FROM ldap_config WHERE id = 1`).
		Scan(&enabled, &cfg.URL, &cfg.Host, &cfg.Port, &useSSL, &startTLS, &skipVerify, &cfg.TimeoutSeconds, &cfg.BindDN, &bindPasswordEnc, &cfg.UserBaseDN, &userBaseDNSRaw, &cfg.UserFilter, &cfg.UsernameAttribute, &cfg.DisplayNameAttr, &cfg.EmailAttr)
	if err != nil {
		return nil, err
	}
	cfg.Enabled = enabled == 1
	cfg.UseSSL = useSSL == 1
	cfg.StartTLS = startTLS == 1
	cfg.SkipVerify = skipVerify == 1
	cfg.PasswordConfigured = bindPasswordEnc != ""
	_ = json.Unmarshal([]byte(userBaseDNSRaw), &cfg.UserBaseDNs)
	if bindPasswordEnc != "" {
		cfg.BindPassword, _ = decrypt(s.key, bindPasswordEnc)
	}
	return &cfg, nil
}

func (s *Store) UpdateLDAPConfig(ctx context.Context, cfg models.LDAPConfig) error {
	raw, _ := json.Marshal(cfg.UserBaseDNs)
	password := cfg.BindPassword
	if password == "" {
		existing, err := s.GetLDAPConfig(ctx)
		if err == nil {
			password = existing.BindPassword
		}
	}
	encoded, err := encrypt(s.key, password)
	if err != nil {
		return err
	}
	_, err = s.conn.ExecContext(ctx, `UPDATE ldap_config SET enabled = ?, url = ?, host = ?, port = ?, use_ssl = ?, start_tls = ?, skip_verify = ?, timeout_seconds = ?, bind_dn = ?, bind_password_enc = ?, user_base_dn = ?, user_base_dns = ?, user_filter = ?, username_attribute = ?, display_name_attribute = ?, email_attribute = ? WHERE id = 1`,
		boolInt(cfg.Enabled), cfg.URL, cfg.Host, cfg.Port, boolInt(cfg.UseSSL), boolInt(cfg.StartTLS), boolInt(cfg.SkipVerify), cfg.TimeoutSeconds, cfg.BindDN, encoded, cfg.UserBaseDN, string(raw), cfg.UserFilter, cfg.UsernameAttribute, cfg.DisplayNameAttr, cfg.EmailAttr)
	return err
}

func (s *Store) GetSessionSettings(ctx context.Context) (*models.SessionSettings, error) {
	var session models.SessionSettings
	err := s.conn.QueryRowContext(ctx, `SELECT session_minutes FROM session_settings WHERE id = 1`).Scan(&session.SessionMinutes)
	return &session, err
}

func (s *Store) UpdateSessionSettings(ctx context.Context, session models.SessionSettings) error {
	_, err := s.conn.ExecContext(ctx, `UPDATE session_settings SET session_minutes = ? WHERE id = 1`, session.SessionMinutes)
	return err
}

func (s *Store) GetSystemSettings(ctx context.Context) (*models.SystemSettings, error) {
	var settings models.SystemSettings
	err := s.conn.QueryRowContext(ctx, `SELECT brand_title, logo_data_url FROM system_settings WHERE id = 1`).Scan(&settings.BrandTitle, &settings.LogoDataURL)
	return &settings, err
}

func (s *Store) UpdateSystemSettings(ctx context.Context, settings models.SystemSettings) error {
	_, err := s.conn.ExecContext(ctx, `UPDATE system_settings SET brand_title = ?, logo_data_url = ? WHERE id = 1`, settings.BrandTitle, settings.LogoDataURL)
	return err
}

func (s *Store) ListAPIDefinitions(ctx context.Context) ([]models.APIDefinition, error) {
	rows, err := s.conn.QueryContext(ctx, `SELECT id, name, slug, description, internal_openapi_url, internal_base_url, is_active, try_it_enabled, allowed_methods, allowed_path_prefixes, owner_team, tags, created_at, updated_at, last_spec_refresh_at, last_spec_status FROM api_definitions ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var apis []models.APIDefinition
	for rows.Next() {
		api, err := scanAPI(rows)
		if err != nil {
			return nil, err
		}
		apis = append(apis, *api)
	}
	return apis, nil
}

func (s *Store) GetAPIDefinition(ctx context.Context, id int) (*models.APIDefinition, error) {
	row := s.conn.QueryRowContext(ctx, `SELECT id, name, slug, description, internal_openapi_url, internal_base_url, is_active, try_it_enabled, allowed_methods, allowed_path_prefixes, owner_team, tags, created_at, updated_at, last_spec_refresh_at, last_spec_status FROM api_definitions WHERE id = ?`, id)
	return scanAPI(row)
}

func (s *Store) CreateAPIDefinition(ctx context.Context, api models.APIDefinition) (int, error) {
	now := time.Now().UTC()
	methods, _ := json.Marshal(api.AllowedMethods)
	prefixes, _ := json.Marshal(api.AllowedPathPrefixes)
	tags, _ := json.Marshal(api.Tags)
	result, err := s.conn.ExecContext(ctx, `INSERT INTO api_definitions (name, slug, description, internal_openapi_url, internal_base_url, is_active, try_it_enabled, allowed_methods, allowed_path_prefixes, owner_team, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		api.Name, api.Slug, api.Description, api.InternalOpenAPIURL, api.InternalBaseURL, boolInt(api.IsActive), boolInt(api.TryItEnabled), string(methods), string(prefixes), api.OwnerTeam, string(tags), now, now)
	if err != nil {
		return 0, err
	}
	id, _ := result.LastInsertId()
	return int(id), nil
}

func (s *Store) UpdateAPIDefinition(ctx context.Context, api models.APIDefinition) error {
	methods, _ := json.Marshal(api.AllowedMethods)
	prefixes, _ := json.Marshal(api.AllowedPathPrefixes)
	tags, _ := json.Marshal(api.Tags)
	_, err := s.conn.ExecContext(ctx, `UPDATE api_definitions SET name = ?, slug = ?, description = ?, internal_openapi_url = ?, internal_base_url = ?, is_active = ?, try_it_enabled = ?, allowed_methods = ?, allowed_path_prefixes = ?, owner_team = ?, tags = ?, updated_at = ? WHERE id = ?`,
		api.Name, api.Slug, api.Description, api.InternalOpenAPIURL, api.InternalBaseURL, boolInt(api.IsActive), boolInt(api.TryItEnabled), string(methods), string(prefixes), api.OwnerTeam, string(tags), time.Now().UTC(), api.ID)
	return err
}

func (s *Store) DeleteAPIDefinition(ctx context.Context, id int) error {
	if _, err := s.conn.ExecContext(ctx, `DELETE FROM api_spec_cache WHERE api_id = ?`, id); err != nil {
		return err
	}
	_, err := s.conn.ExecContext(ctx, `DELETE FROM api_definitions WHERE id = ?`, id)
	return err
}

func (s *Store) SaveSpecCache(ctx context.Context, apiID int, cache models.APISpecCache) error {
	_, err := s.conn.ExecContext(ctx, `INSERT INTO api_spec_cache (api_id, spec_json, etag, fetched_at, last_error, source_format) VALUES (?, ?, ?, ?, '', ?)
		ON CONFLICT(api_id) DO UPDATE SET spec_json = excluded.spec_json, etag = excluded.etag, fetched_at = excluded.fetched_at, last_error = '', source_format = excluded.source_format`,
		apiID, string(cache.SpecJSON), cache.ETag, cache.FetchedAt, cache.SourceFormat)
	if err != nil {
		return err
	}
	_, err = s.conn.ExecContext(ctx, `UPDATE api_definitions SET last_spec_refresh_at = ?, last_spec_status = 'ok', updated_at = updated_at WHERE id = ?`, cache.FetchedAt, apiID)
	return err
}

func (s *Store) GetSpecCache(ctx context.Context, apiID int) (*models.APISpecCache, error) {
	var cache models.APISpecCache
	var fetchedAt sql.NullTime
	var raw string
	err := s.conn.QueryRowContext(ctx, `SELECT api_id, spec_json, etag, fetched_at, last_error, source_format FROM api_spec_cache WHERE api_id = ?`, apiID).
		Scan(&cache.APIID, &raw, &cache.ETag, &fetchedAt, &cache.LastError, &cache.SourceFormat)
	if err != nil {
		return nil, err
	}
	cache.SpecJSON = json.RawMessage(raw)
	if fetchedAt.Valid {
		cache.FetchedAt = fetchedAt.Time
	}
	return &cache, nil
}

func (s *Store) MarkSpecRefreshFailure(ctx context.Context, apiID int, message string) error {
	_, err := s.conn.ExecContext(ctx, `UPDATE api_definitions SET last_spec_status = ?, last_spec_refresh_at = COALESCE(last_spec_refresh_at, ?) WHERE id = ?`, "error: "+message, time.Now().UTC(), apiID)
	if err != nil {
		return err
	}
	_, err = s.conn.ExecContext(ctx, `INSERT INTO api_spec_cache (api_id, last_error) VALUES (?, ?) ON CONFLICT(api_id) DO UPDATE SET last_error = excluded.last_error`, apiID, message)
	return err
}

func (s *Store) AddAuditLog(ctx context.Context, entry models.AuditLog) error {
	_, err := s.conn.ExecContext(ctx, `INSERT INTO audit_logs (timestamp, user, action, resource_type, resource_id, resource_name, source_ip, status_code, duration_ms, request_bytes, response_bytes, blocked, error_message, sanitized_headers, details_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		entry.Timestamp, entry.User, entry.Action, entry.ResourceType, entry.ResourceID, entry.ResourceName, entry.SourceIP, entry.StatusCode, entry.DurationMs, entry.RequestBytes, entry.ResponseBytes, boolInt(entry.Blocked), entry.ErrorMessage, entry.SanitizedHeader, entry.DetailsJSON)
	return err
}

func (s *Store) ListAuditLogs(ctx context.Context, limit, offset int, action, username string) ([]models.AuditLog, int, error) {
	baseQuery := ` FROM audit_logs WHERE 1=1`
	args := []any{}
	if action != "" {
		baseQuery += ` AND action = ?`
		args = append(args, action)
	}
	if username != "" {
		baseQuery += ` AND user = ?`
		args = append(args, username)
	}
	var total int
	if err := s.conn.QueryRowContext(ctx, `SELECT COUNT(*)`+baseQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	query := `SELECT id, timestamp, user, action, resource_type, resource_id, resource_name, source_ip, status_code, duration_ms, request_bytes, response_bytes, blocked, error_message, sanitized_headers, details_json` + baseQuery
	query += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`
	args = append(args, limit, offset)
	rows, err := s.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var logs []models.AuditLog
	for rows.Next() {
		var entry models.AuditLog
		var blocked int
		if err := rows.Scan(&entry.ID, &entry.Timestamp, &entry.User, &entry.Action, &entry.ResourceType, &entry.ResourceID, &entry.ResourceName, &entry.SourceIP, &entry.StatusCode, &entry.DurationMs, &entry.RequestBytes, &entry.ResponseBytes, &blocked, &entry.ErrorMessage, &entry.SanitizedHeader, &entry.DetailsJSON); err != nil {
			return nil, 0, err
		}
		entry.Blocked = blocked == 1
		logs = append(logs, entry)
	}
	return logs, total, nil
}

func (s *Store) PurgeAuditLogs(ctx context.Context, cutoff time.Time) error {
	_, err := s.conn.ExecContext(ctx, `DELETE FROM audit_logs WHERE timestamp < ?`, cutoff)
	return err
}

func scanUser(scanner interface{ Scan(...any) error }) (*models.User, error) {
	var user models.User
	var mustChange, isActive, isAdmin int
	if err := scanner.Scan(&user.ID, &user.Username, &user.DisplayName, &user.Email, &user.PasswordHash, &user.AuthSource, &mustChange, &isActive, &isAdmin, &user.CreatedAt, &user.UpdatedAt); err != nil {
		return nil, err
	}
	user.MustChangePassword = mustChange == 1
	user.IsActive = isActive == 1
	user.IsAdmin = isAdmin == 1
	return &user, nil
}

func scanAPI(scanner interface{ Scan(...any) error }) (*models.APIDefinition, error) {
	var api models.APIDefinition
	var isActive, tryIt int
	var methods, prefixes, tags string
	var lastRefresh sql.NullTime
	if err := scanner.Scan(&api.ID, &api.Name, &api.Slug, &api.Description, &api.InternalOpenAPIURL, &api.InternalBaseURL, &isActive, &tryIt, &methods, &prefixes, &api.OwnerTeam, &tags, &api.CreatedAt, &api.UpdatedAt, &lastRefresh, &api.LastSpecStatus); err != nil {
		return nil, err
	}
	api.IsActive = isActive == 1
	api.TryItEnabled = tryIt == 1
	_ = json.Unmarshal([]byte(methods), &api.AllowedMethods)
	_ = json.Unmarshal([]byte(prefixes), &api.AllowedPathPrefixes)
	_ = json.Unmarshal([]byte(tags), &api.Tags)
	if lastRefresh.Valid {
		api.LastSpecRefreshAt = &lastRefresh.Time
	}
	return &api, nil
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

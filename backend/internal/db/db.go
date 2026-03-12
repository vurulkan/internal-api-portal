package db

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

type DB struct {
	Conn *sql.DB
}

func Open(path string) (*DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return nil, err
	}
	conn, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	conn.SetMaxOpenConns(1)
	conn.SetMaxIdleConns(1)
	conn.SetConnMaxLifetime(5 * time.Minute)
	if err := migrate(context.Background(), conn); err != nil {
		return nil, err
	}
	return &DB{Conn: conn}, nil
}

func migrate(ctx context.Context, conn *sql.DB) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS app_secrets (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			signing_key BLOB NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			display_name TEXT NOT NULL DEFAULT '',
			email TEXT NOT NULL DEFAULT '',
			password_hash TEXT NOT NULL DEFAULT '',
			auth_source TEXT NOT NULL DEFAULT 'local',
			must_change_password INTEGER NOT NULL DEFAULT 1,
			is_active INTEGER NOT NULL DEFAULT 1,
			is_admin INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME NOT NULL,
			updated_at DATETIME NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS groups (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			description TEXT NOT NULL DEFAULT '',
			created_at DATETIME NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS roles (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			description TEXT NOT NULL DEFAULT '',
			created_at DATETIME NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS permissions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			role_id INTEGER NOT NULL,
			scope TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			created_at DATETIME NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS user_groups (
			user_id INTEGER NOT NULL,
			group_id INTEGER NOT NULL,
			PRIMARY KEY (user_id, group_id)
		);`,
		`CREATE TABLE IF NOT EXISTS group_roles (
			group_id INTEGER NOT NULL,
			role_id INTEGER NOT NULL,
			PRIMARY KEY (group_id, role_id)
		);`,
		`CREATE TABLE IF NOT EXISTS ldap_config (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			enabled INTEGER NOT NULL DEFAULT 0,
			url TEXT NOT NULL DEFAULT '',
			host TEXT NOT NULL DEFAULT '',
			port INTEGER NOT NULL DEFAULT 389,
			use_ssl INTEGER NOT NULL DEFAULT 0,
			start_tls INTEGER NOT NULL DEFAULT 0,
			skip_verify INTEGER NOT NULL DEFAULT 0,
			timeout_seconds INTEGER NOT NULL DEFAULT 10,
			bind_dn TEXT NOT NULL DEFAULT '',
			bind_password_enc TEXT NOT NULL DEFAULT '',
			user_base_dn TEXT NOT NULL DEFAULT '',
			user_base_dns TEXT NOT NULL DEFAULT '[]',
			user_filter TEXT NOT NULL DEFAULT '',
			username_attribute TEXT NOT NULL DEFAULT 'uid',
			display_name_attribute TEXT NOT NULL DEFAULT 'displayName',
			email_attribute TEXT NOT NULL DEFAULT 'mail'
		);`,
		`CREATE TABLE IF NOT EXISTS session_settings (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			session_minutes INTEGER NOT NULL DEFAULT 60
		);`,
		`CREATE TABLE IF NOT EXISTS system_settings (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			brand_title TEXT NOT NULL DEFAULT 'Internal API Portal',
			logo_data_url TEXT NOT NULL DEFAULT ''
		);`,
		`CREATE TABLE IF NOT EXISTS api_definitions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			slug TEXT NOT NULL UNIQUE,
			description TEXT NOT NULL DEFAULT '',
			internal_openapi_url TEXT NOT NULL,
			internal_base_url TEXT NOT NULL,
			is_active INTEGER NOT NULL DEFAULT 1,
			try_it_enabled INTEGER NOT NULL DEFAULT 1,
			allowed_methods TEXT NOT NULL DEFAULT '[]',
			allowed_path_prefixes TEXT NOT NULL DEFAULT '[]',
			owner_team TEXT NOT NULL DEFAULT '',
			tags TEXT NOT NULL DEFAULT '[]',
			last_spec_refresh_at DATETIME,
			last_spec_status TEXT NOT NULL DEFAULT '',
			created_at DATETIME NOT NULL,
			updated_at DATETIME NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS api_spec_cache (
			api_id INTEGER PRIMARY KEY,
			spec_json TEXT NOT NULL DEFAULT '',
			etag TEXT NOT NULL DEFAULT '',
			fetched_at DATETIME,
			last_error TEXT NOT NULL DEFAULT '',
			source_format TEXT NOT NULL DEFAULT 'json'
		);`,
		`CREATE TABLE IF NOT EXISTS audit_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp DATETIME NOT NULL,
			user TEXT NOT NULL,
			action TEXT NOT NULL,
			resource_type TEXT NOT NULL,
			resource_id TEXT NOT NULL DEFAULT '',
			resource_name TEXT NOT NULL DEFAULT '',
			source_ip TEXT NOT NULL DEFAULT '',
			status_code INTEGER NOT NULL DEFAULT 0,
			duration_ms INTEGER NOT NULL DEFAULT 0,
			request_bytes INTEGER NOT NULL DEFAULT 0,
			response_bytes INTEGER NOT NULL DEFAULT 0,
			blocked INTEGER NOT NULL DEFAULT 0,
			error_message TEXT NOT NULL DEFAULT '',
			sanitized_headers TEXT NOT NULL DEFAULT '',
			details_json TEXT NOT NULL DEFAULT ''
		);`,
	}
	for _, stmt := range stmts {
		if _, err := conn.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
	}
	if _, err := conn.ExecContext(ctx, `INSERT OR IGNORE INTO ldap_config (id) VALUES (1)`); err != nil {
		return err
	}
	if _, err := conn.ExecContext(ctx, `INSERT OR IGNORE INTO session_settings (id, session_minutes) VALUES (1, 60)`); err != nil {
		return err
	}
	if _, err := conn.ExecContext(ctx, `INSERT OR IGNORE INTO system_settings (id) VALUES (1)`); err != nil {
		return err
	}
	return nil
}

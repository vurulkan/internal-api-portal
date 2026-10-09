package db

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type DB struct {
	Conn *sql.DB
}

// Open opens (creating if needed) the SQLite database and applies pending migrations.
// Pragmas go in the DSN so every pooled connection gets them, including ones opened
// after ConnMaxLifetime recycles the first: WAL (readers don't block the writer),
// busy_timeout (wait instead of failing with SQLITE_BUSY) and foreign_keys.
func Open(path string) (*DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return nil, err
	}
	dsn := "file:" + (&url.URL{Path: path}).EscapedPath() +
		"?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)"
	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	conn.SetMaxOpenConns(1)
	conn.SetMaxIdleConns(1)
	conn.SetConnMaxLifetime(5 * time.Minute)
	if err := Migrate(context.Background(), conn); err != nil {
		conn.Close()
		return nil, err
	}
	return &DB{Conn: conn}, nil
}

// baselineSchema is the schema as of 1.0.x. Later changes are separate migrations;
// never edit these statements, add a migration instead.
var baselineSchema = []string{
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
	`CREATE TABLE IF NOT EXISTS azure_ad_config (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		enabled INTEGER NOT NULL DEFAULT 0,
		tenant_id TEXT NOT NULL DEFAULT '',
		client_id TEXT NOT NULL DEFAULT '',
		client_secret_enc TEXT NOT NULL DEFAULT '',
		redirect_url TEXT NOT NULL DEFAULT ''
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

// migration is one schema step. Steps run in order, each in its own transaction,
// and are recorded in schema_migrations so they run once. foreignKeysOff is for
// table rebuilds: SQLite can't change constraints in place, and the pragma can only
// be toggled outside a transaction.
type migration struct {
	version        int
	name           string
	foreignKeysOff bool
	run            func(ctx context.Context, tx *sql.Tx) error
}

var migrations = []migration{
	{1, "baseline (1.0.x schema)", false, func(ctx context.Context, tx *sql.Tx) error {
		if err := execAll(ctx, tx, baselineSchema...); err != nil {
			return err
		}
		return execAll(ctx, tx,
			`INSERT OR IGNORE INTO ldap_config (id) VALUES (1)`,
			`INSERT OR IGNORE INTO session_settings (id, session_minutes) VALUES (1, 60)`,
			`INSERT OR IGNORE INTO azure_ad_config (id) VALUES (1)`,
			`INSERT OR IGNORE INTO system_settings (id) VALUES (1)`,
		)
	}},
	{2, "users.external_id (Azure AD identity, 1.1.0)", false, func(ctx context.Context, tx *sql.Tx) error {
		return addColumn(ctx, tx, `ALTER TABLE users ADD COLUMN external_id TEXT NOT NULL DEFAULT ''`)
	}},
	{3, "audit_logs.request_id", false, func(ctx context.Context, tx *sql.Tx) error {
		return addColumn(ctx, tx, `ALTER TABLE audit_logs ADD COLUMN request_id TEXT NOT NULL DEFAULT ''`)
	}},
	{4, "foreign keys on relation tables", true, rebuildWithForeignKeys},
	{5, "indexes", false, func(ctx context.Context, tx *sql.Tx) error {
		return execAll(ctx, tx,
			`CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp)`,
			`CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user)`,
			`CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)`,
			`CREATE INDEX IF NOT EXISTS idx_user_groups_group ON user_groups(group_id)`,
			`CREATE INDEX IF NOT EXISTS idx_group_roles_role ON group_roles(role_id)`,
			`CREATE INDEX IF NOT EXISTS idx_permissions_role ON permissions(role_id)`,
			`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
			`CREATE INDEX IF NOT EXISTS idx_users_external_id ON users(external_id) WHERE external_id <> ''`,
		)
	}},
}

// Migrate applies every pending migration.
func Migrate(ctx context.Context, conn *sql.DB) error {
	return migrateTo(ctx, conn, migrations[len(migrations)-1].version)
}

func migrateTo(ctx context.Context, db *sql.DB, target int) error {
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		applied_at DATETIME NOT NULL
	)`); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	applied := map[int]bool{}
	rows, err := conn.QueryContext(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			rows.Close()
			return err
		}
		applied[v] = true
	}
	rows.Close()

	for _, m := range migrations {
		if m.version > target || applied[m.version] {
			continue
		}
		if err := apply(ctx, conn, m); err != nil {
			return fmt.Errorf("migration %d (%s): %w", m.version, m.name, err)
		}
		slog.Info("db.migration.applied", "migration", m.version, "name", m.name)
	}
	return nil
}

func apply(ctx context.Context, conn *sql.Conn, m migration) error {
	if m.foreignKeysOff {
		if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); err != nil {
			return err
		}
		defer conn.ExecContext(context.Background(), `PRAGMA foreign_keys = ON`)
	}
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := m.run(ctx, tx); err != nil {
		return err
	}
	if m.foreignKeysOff {
		// The rebuild must leave no violations behind before it is committed.
		var violations int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM pragma_foreign_key_check`).Scan(&violations); err != nil {
			return err
		}
		if violations > 0 {
			return fmt.Errorf("%d foreign key violations after rebuild", violations)
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`, m.version, m.name, time.Now().UTC()); err != nil {
		return err
	}
	return tx.Commit()
}

// rebuildWithForeignKeys recreates the relation tables with ON DELETE CASCADE
// references. Rows pointing at deleted users, groups, roles or APIs (possible in
// 1.0.x, which had no constraints and no transactions) are dropped and counted.
func rebuildWithForeignKeys(ctx context.Context, tx *sql.Tx) error {
	tables := []struct {
		name, create, keep string
	}{
		{"user_groups",
			`CREATE TABLE user_groups_new (
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				group_id INTEGER NOT NULL REFERENCES "groups"(id) ON DELETE CASCADE,
				PRIMARY KEY (user_id, group_id)
			)`,
			`user_id IN (SELECT id FROM users) AND group_id IN (SELECT id FROM "groups")`},
		{"group_roles",
			`CREATE TABLE group_roles_new (
				group_id INTEGER NOT NULL REFERENCES "groups"(id) ON DELETE CASCADE,
				role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
				PRIMARY KEY (group_id, role_id)
			)`,
			`group_id IN (SELECT id FROM "groups") AND role_id IN (SELECT id FROM roles)`},
		{"permissions",
			`CREATE TABLE permissions_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
				scope TEXT NOT NULL,
				description TEXT NOT NULL DEFAULT '',
				created_at DATETIME NOT NULL
			)`,
			`role_id IN (SELECT id FROM roles)`},
		{"api_spec_cache",
			`CREATE TABLE api_spec_cache_new (
				api_id INTEGER PRIMARY KEY REFERENCES api_definitions(id) ON DELETE CASCADE,
				spec_json TEXT NOT NULL DEFAULT '',
				etag TEXT NOT NULL DEFAULT '',
				fetched_at DATETIME,
				last_error TEXT NOT NULL DEFAULT '',
				source_format TEXT NOT NULL DEFAULT 'json'
			)`,
			`api_id IN (SELECT id FROM api_definitions)`},
	}
	for _, t := range tables {
		var orphans int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM `+t.name+` WHERE NOT (`+t.keep+`)`).Scan(&orphans); err != nil {
			return err
		}
		if orphans > 0 {
			slog.Warn("db.migration.orphans_dropped", "table", t.name, "rows", orphans)
		}
		if err := execAll(ctx, tx,
			t.create,
			`INSERT INTO `+t.name+`_new SELECT * FROM `+t.name+` WHERE `+t.keep,
			`DROP TABLE `+t.name,
			`ALTER TABLE `+t.name+`_new RENAME TO `+t.name,
		); err != nil {
			return err
		}
	}
	return nil
}

func execAll(ctx context.Context, tx *sql.Tx, stmts ...string) error {
	for _, stmt := range stmts {
		if _, err := tx.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("%w (in %q)", err, firstLine(stmt))
		}
	}
	return nil
}

// addColumn runs an ALTER TABLE ADD COLUMN; on databases where 1.1.0 already added
// the column without recording a migration it is a no-op.
func addColumn(ctx context.Context, tx *sql.Tx, stmt string) error {
	if _, err := tx.ExecContext(ctx, stmt); err != nil && !strings.Contains(err.Error(), "duplicate column name") {
		return err
	}
	return nil
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

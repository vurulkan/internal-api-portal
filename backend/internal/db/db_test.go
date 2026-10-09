package db

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// openRaw opens the file without running migrations, with the same pragmas Open uses.
func openRaw(t *testing.T, path string) *sql.DB {
	t.Helper()
	conn, err := sql.Open("sqlite", "file:"+path+"?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	conn.SetMaxOpenConns(1)
	t.Cleanup(func() { conn.Close() })
	return conn
}

func exec(t *testing.T, conn *sql.DB, stmt string, args ...any) {
	t.Helper()
	if _, err := conn.Exec(stmt, args...); err != nil {
		t.Fatalf("%s: %v", stmt, err)
	}
}

func count(t *testing.T, conn *sql.DB, query string, args ...any) int {
	t.Helper()
	var n int
	if err := conn.QueryRow(query, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return n
}

// TestUpgradeFrom1_0Schema builds a 1.0.x database (baseline schema, no
// schema_migrations, orphaned relation rows, as 1.0.x could leave behind), then
// opens it with the current code.
func TestUpgradeFrom1_0Schema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	legacy := openRaw(t, path)
	for _, stmt := range baselineSchema {
		exec(t, legacy, stmt)
	}
	now := time.Now().UTC()
	exec(t, legacy, `INSERT INTO users (id, username, created_at, updated_at) VALUES (1, 'alice', ?, ?), (2, 'bob', ?, ?)`, now, now, now, now)
	exec(t, legacy, `INSERT INTO "groups" (id, name, created_at) VALUES (10, 'devs', ?)`, now)
	exec(t, legacy, `INSERT INTO roles (id, name, created_at) VALUES (20, 'viewer', ?)`, now)
	exec(t, legacy, `INSERT INTO permissions (role_id, scope, created_at) VALUES (20, 'api.view', ?), (99, 'orphan.scope', ?)`, now, now)
	exec(t, legacy, `INSERT INTO user_groups (user_id, group_id) VALUES (1, 10), (2, 10), (3, 10), (1, 77)`)
	exec(t, legacy, `INSERT INTO group_roles (group_id, role_id) VALUES (10, 20), (10, 88)`)
	legacy.Close()

	database, err := Open(path)
	if err != nil {
		t.Fatalf("open legacy db: %v", err)
	}
	conn := database.Conn
	defer conn.Close()

	if got := count(t, conn, `SELECT COUNT(*) FROM schema_migrations`); got != len(migrations) {
		t.Fatalf("schema_migrations rows = %d, want %d", got, len(migrations))
	}
	// Valid rows kept, orphans dropped.
	if got := count(t, conn, `SELECT COUNT(*) FROM user_groups`); got != 2 {
		t.Errorf("user_groups = %d, want 2", got)
	}
	if got := count(t, conn, `SELECT COUNT(*) FROM group_roles`); got != 1 {
		t.Errorf("group_roles = %d, want 1", got)
	}
	if got := count(t, conn, `SELECT COUNT(*) FROM permissions`); got != 1 {
		t.Errorf("permissions = %d, want 1", got)
	}
	// New columns exist.
	count(t, conn, `SELECT COUNT(*) FROM users WHERE external_id = ''`)
	count(t, conn, `SELECT COUNT(*) FROM audit_logs WHERE request_id = ''`)

	// Foreign keys are enforced and cascade.
	if _, err := conn.Exec(`INSERT INTO user_groups (user_id, group_id) VALUES (1, 12345)`); err == nil {
		t.Error("insert with a missing group succeeded; foreign keys not enforced")
	}
	exec(t, conn, `DELETE FROM users WHERE id = 1`)
	if got := count(t, conn, `SELECT COUNT(*) FROM user_groups WHERE user_id = 1`); got != 0 {
		t.Errorf("user_groups rows of a deleted user = %d, want 0 (cascade)", got)
	}
	var journal string
	if err := conn.QueryRow(`PRAGMA journal_mode`).Scan(&journal); err != nil || journal != "wal" {
		t.Errorf("journal_mode = %q (%v), want wal", journal, err)
	}
}

// TestUpgradeFrom1_1Schema covers a 1.1.0 database: users.external_id was added
// without a schema_migrations table.
func TestUpgradeFrom1_1Schema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	legacy := openRaw(t, path)
	for _, stmt := range baselineSchema {
		exec(t, legacy, stmt)
	}
	exec(t, legacy, `ALTER TABLE users ADD COLUMN external_id TEXT NOT NULL DEFAULT ''`)
	legacy.Close()

	database, err := Open(path)
	if err != nil {
		t.Fatalf("open 1.1.0 db: %v", err)
	}
	database.Conn.Close()
}

func TestMigrationsAreIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	for i := 0; i < 3; i++ {
		database, err := Open(path)
		if err != nil {
			t.Fatalf("open #%d: %v", i, err)
		}
		if err := Migrate(context.Background(), database.Conn); err != nil {
			t.Fatalf("migrate #%d: %v", i, err)
		}
		database.Conn.Close()
	}
}

func TestMigrationVersionsAreOrdered(t *testing.T) {
	for i := 1; i < len(migrations); i++ {
		if migrations[i].version <= migrations[i-1].version {
			t.Fatalf("migration %d listed after %d", migrations[i].version, migrations[i-1].version)
		}
	}
}

func TestBackupIsConsistentAndPruned(t *testing.T) {
	dir := t.TempDir()
	database, err := Open(filepath.Join(dir, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Conn.Close()
	exec(t, database.Conn, `INSERT INTO "groups" (name, created_at) VALUES ('devs', ?)`, time.Now().UTC())

	backups := filepath.Join(dir, "backups")
	path, err := Backup(context.Background(), database.Conn, backups, 2)
	if err != nil {
		t.Fatalf("backup: %v", err)
	}
	copyDB := openRaw(t, path)
	if got := count(t, copyDB, `SELECT COUNT(*) FROM "groups"`); got != 1 {
		t.Fatalf("backup has %d groups, want 1", got)
	}
	// Older copies beyond keep are removed.
	for _, name := range []string{"app-20200101-000000.db", "app-20200102-000000.db"} {
		if err := os.WriteFile(filepath.Join(backups, name), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := pruneBackups(backups, 2); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(backups)
	if len(entries) != 2 || entries[0].Name() != "app-20200102-000000.db" {
		t.Fatalf("after prune: %v", entries)
	}
}

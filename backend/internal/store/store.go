package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"strings"
	"time"
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

// Ping checks that the database answers a query (used by /readyz).
func (s *Store) Ping(ctx context.Context) error {
	var one int
	return s.conn.QueryRowContext(ctx, `SELECT 1`).Scan(&one)
}

// withTx runs fn in a transaction: committed when fn returns nil, rolled back otherwise.
func (s *Store) withTx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := s.conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
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
	if count > 0 {
		return nil
	}
	// First boot only: seed the session length from SESSION_MINUTES. Afterwards the
	// value set in Admin → Session wins (it used to be reset on every restart).
	if _, err := s.conn.ExecContext(ctx, `UPDATE session_settings SET session_minutes = ? WHERE id = 1`, sessionMinutes); err != nil {
		return err
	}
	_, err := s.conn.ExecContext(ctx, `INSERT INTO users (username, display_name, email, password_hash, auth_source, must_change_password, is_active, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, 'local', 1, 1, 1, ?, ?)`, "admin", "Administrator", "", passwordHash, now, now)
	return err
}

func placeholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

func intArgs(values []int) []any {
	out := make([]any, len(values))
	for i, v := range values {
		out[i] = v
	}
	return out
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

package store

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

type Store struct {
	conn *sql.DB
	keys *Keyring
}

// Keys configures encryption at rest; both may be empty (legacy mode, see crypto.go).
type Keys struct {
	Current  []byte
	Previous [][]byte
}

func New(conn *sql.DB, keys Keys) (*Store, error) {
	keyring, err := newKeyring(context.Background(), conn, keys.Current, keys.Previous)
	if err != nil {
		return nil, err
	}
	return &Store{conn: conn, keys: keyring}, nil
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

// EnsureBootstrapAdmin creates the first administrator when there are no users and
// reports whether it did. The account must change its password at first sign-in.
func (s *Store) EnsureBootstrapAdmin(ctx context.Context, username, passwordHash string, sessionMinutes int) (bool, error) {
	var count int
	if err := s.conn.QueryRowContext(ctx, `SELECT COUNT(1) FROM users`).Scan(&count); err != nil {
		return false, err
	}
	if count > 0 {
		return false, nil
	}
	now := time.Now().UTC()
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		// First boot only: seed the idle timeout from SESSION_MINUTES. Afterwards the
		// value set in Admin → Session wins.
		if _, err := tx.ExecContext(ctx, `UPDATE session_settings SET session_minutes = ? WHERE id = 1`, sessionMinutes); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO users (username, display_name, email, password_hash, auth_source, must_change_password, is_active, is_admin, created_at, updated_at) VALUES (?, ?, '', ?, 'local', 1, 1, 1, ?, ?)`,
			username, "Administrator", passwordHash, now, now)
		return err
	})
	return err == nil, err
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

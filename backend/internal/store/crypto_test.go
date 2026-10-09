package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"api-portal/backend/internal/db"
	"api-portal/backend/internal/models"
)

func newKey(t *testing.T) []byte {
	t.Helper()
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	return key
}

func openDB(t *testing.T, path string) *sql.DB {
	t.Helper()
	database, err := db.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Conn.Close() })
	return database.Conn
}

func rawSecret(t *testing.T, conn *sql.DB) string {
	t.Helper()
	var v string
	if err := conn.QueryRow(`SELECT bind_password_enc FROM ldap_config WHERE id = 1`).Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func setBindPassword(t *testing.T, s *Store, pw string) {
	t.Helper()
	if err := s.UpdateLDAPConfig(context.Background(), models.LDAPConfig{BindPassword: pw}); err != nil {
		t.Fatal(err)
	}
}

func bindPassword(t *testing.T, s *Store) string {
	t.Helper()
	cfg, err := s.GetLDAPConfig(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return cfg.BindPassword
}

// From legacy mode (key in the database) to an external key: values are
// re-encrypted, the database key is deleted, and the database alone can no longer
// decrypt anything.
func TestMoveToExternalKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	conn := openDB(t, path)
	ctx := context.Background()

	legacy, err := New(conn, Keys{})
	if err != nil {
		t.Fatal(err)
	}
	if !legacy.KeyInDatabase() {
		t.Fatal("no external key, but KeyInDatabase() = false")
	}
	// A pre-1.4.0 value: no key-id prefix.
	old, _ := seal(legacy.keys.legacy, "bind-secret")
	if _, err := conn.Exec(`UPDATE ldap_config SET bind_password_enc = ? WHERE id = 1`, old); err != nil {
		t.Fatal(err)
	}
	if got := bindPassword(t, legacy); got != "bind-secret" {
		t.Fatalf("legacy value read as %q", got)
	}

	key := newKey(t)
	external, err := New(conn, Keys{Current: key})
	if err != nil {
		t.Fatal(err)
	}
	result, err := external.Rekey(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if result.Reencrypted != 1 || !result.LegacyKeyRemoved {
		t.Fatalf("rekey result: %+v", result)
	}
	if v := rawSecret(t, conn); !strings.HasPrefix(v, "k1:"+KeyID(key)+":") {
		t.Fatalf("stored value %q is not under the new key", v)
	}
	var keysLeft int
	_ = conn.QueryRow(`SELECT COUNT(*) FROM app_secrets`).Scan(&keysLeft)
	if keysLeft != 0 {
		t.Fatal("database key not removed")
	}
	if got := bindPassword(t, external); got != "bind-secret" {
		t.Fatalf("read back %q", got)
	}

	// "Stolen database": opened without the key, the secret can't be decrypted.
	thief, err := New(conn, Keys{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := thief.keys.decrypt(rawSecret(t, conn)); !errors.Is(err, ErrUnknownKey) {
		t.Fatalf("decrypt without the key: %v", err)
	}

	// A second rekey is a no-op.
	if again, _ := external.Rekey(ctx); again.Reencrypted != 0 {
		t.Fatalf("second rekey: %+v", again)
	}
}

func TestKeyRotation(t *testing.T) {
	conn := openDB(t, filepath.Join(t.TempDir(), "app.db"))
	ctx := context.Background()
	oldKey, newKeyBytes := newKey(t), newKey(t)

	s1, _ := New(conn, Keys{Current: oldKey})
	setBindPassword(t, s1, "rotate-me")

	// New key without the old one listed: the value can't be read, rekey fails.
	s2, _ := New(conn, Keys{Current: newKeyBytes})
	if _, err := s2.Rekey(ctx); err == nil {
		t.Fatal("rekey without the previous key succeeded")
	}
	// With the old key as previous: re-encrypted under the new key.
	s3, _ := New(conn, Keys{Current: newKeyBytes, Previous: [][]byte{oldKey}})
	if r, err := s3.Rekey(ctx); err != nil || r.Reencrypted != 1 {
		t.Fatalf("rotation rekey: %+v %v", r, err)
	}
	s4, _ := New(conn, Keys{Current: newKeyBytes})
	if got := bindPassword(t, s4); got != "rotate-me" {
		t.Fatalf("after rotation: %q", got)
	}
}

func TestParseKey(t *testing.T) {
	if _, err := ParseKey("dG9vLXNob3J0"); err == nil {
		t.Error("short key accepted")
	}
	if k, err := ParseKey(strings.Repeat("ab", 32)); err != nil || len(k) != 32 {
		t.Errorf("hex key: %v", err)
	}
	if k, err := ParseKey(""); err != nil || k != nil {
		t.Errorf("empty key: %v %v", k, err)
	}
}

func TestBootstrapAdminOnlyOnEmptyDatabase(t *testing.T) {
	conn := openDB(t, filepath.Join(t.TempDir(), "app.db"))
	s, _ := New(conn, Keys{})
	ctx := context.Background()
	if created, err := s.EnsureBootstrapAdmin(ctx, "root", "hash", 30); err != nil || !created {
		t.Fatalf("first call: %v %v", created, err)
	}
	if created, _ := s.EnsureBootstrapAdmin(ctx, "root2", "hash", 30); created {
		t.Fatal("second admin created on a non-empty database")
	}
	u, _ := s.GetUserByUsername(ctx, "root")
	if !u.IsAdmin || !u.MustChangePassword {
		t.Fatalf("bootstrap admin: %+v", u)
	}
}

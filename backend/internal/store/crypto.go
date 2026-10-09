package store

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"
)

// Secrets at rest (LDAP bind password, Azure AD client secret) are encrypted with
// AES-256-GCM. Ciphertexts are stored as "k1:<key id>:<base64(nonce|ciphertext)>",
// so each value says which key encrypted it; values without the prefix were
// written by 1.3.0 or older with the key in app_secrets.
//
// Where the key comes from:
//   - DATA_ENCRYPTION_KEY(_FILE): the key lives outside the database (a Kubernetes
//     Secret), so a copy of the database alone can't decrypt anything. Startup
//     re-encrypts every value with it and then deletes the old key from the database.
//   - not configured: the key stays in app_secrets, as before (legacy mode; the
//     admin UI shows a warning).
//
// DATA_ENCRYPTION_KEY_PREVIOUS(_FILE) keeps an old key readable during rotation.

const cipherPrefix = "k1:"

// ErrUnknownKey means a value was encrypted with a key that isn't configured.
var ErrUnknownKey = errors.New("value encrypted with a key that is not configured")

type Keyring struct {
	current   []byte
	currentID string
	keys      map[string][]byte // by key id, includes current
	// legacy is the app_secrets key, used for unprefixed values.
	legacy []byte
	// external is true when current came from DATA_ENCRYPTION_KEY.
	external bool
}

// KeyID is the first 8 hex characters of SHA-256(key): enough to tell keys apart,
// useless for recovering one.
func KeyID(key []byte) string {
	sum := sha256.Sum256(key)
	return hex.EncodeToString(sum[:4])
}

// ParseKey accepts a base64 (standard or URL, padded or not) or 64-hex-character
// encoding of a 32-byte key.
func ParseKey(raw string) ([]byte, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	if len(raw) == 64 {
		if key, err := hex.DecodeString(raw); err == nil {
			return key, nil
		}
	}
	for _, enc := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		if key, err := enc.DecodeString(raw); err == nil {
			if len(key) != 32 {
				return nil, fmt.Errorf("encryption key must be 32 bytes, got %d", len(key))
			}
			return key, nil
		}
	}
	return nil, errors.New("encryption key is neither base64 nor hex")
}

func newKeyring(ctx context.Context, conn *sql.DB, current []byte, previous [][]byte) (*Keyring, error) {
	legacy, err := loadLegacyKey(ctx, conn)
	if err != nil {
		return nil, err
	}
	k := &Keyring{keys: map[string][]byte{}, legacy: legacy}
	if len(current) > 0 {
		k.current, k.external = current, true
	} else {
		if legacy == nil {
			if legacy, err = createLegacyKey(ctx, conn); err != nil {
				return nil, err
			}
			k.legacy = legacy
		}
		k.current = legacy
	}
	k.currentID = KeyID(k.current)
	k.keys[k.currentID] = k.current
	for _, key := range previous {
		if len(key) > 0 {
			k.keys[KeyID(key)] = key
		}
	}
	if k.legacy != nil {
		k.keys[KeyID(k.legacy)] = k.legacy
	}
	return k, nil
}

func loadLegacyKey(ctx context.Context, conn *sql.DB) ([]byte, error) {
	var key []byte
	err := conn.QueryRowContext(ctx, `SELECT signing_key FROM app_secrets WHERE id = 1`).Scan(&key)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && len(key) == 0) {
		return nil, nil
	}
	return key, err
}

func createLegacyKey(ctx context.Context, conn *sql.DB) ([]byte, error) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	if _, err := conn.ExecContext(ctx, `INSERT OR REPLACE INTO app_secrets (id, signing_key) VALUES (1, ?)`, key); err != nil {
		return nil, err
	}
	return key, nil
}

func (k *Keyring) encrypt(plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	data, err := seal(k.current, plaintext)
	if err != nil {
		return "", err
	}
	return cipherPrefix + k.currentID + ":" + data, nil
}

func (k *Keyring) decrypt(encoded string) (string, error) {
	if encoded == "" {
		return "", nil
	}
	key, data := k.legacy, encoded
	if strings.HasPrefix(encoded, cipherPrefix) {
		parts := strings.SplitN(strings.TrimPrefix(encoded, cipherPrefix), ":", 2)
		if len(parts) != 2 {
			return "", errors.New("malformed ciphertext")
		}
		var ok bool
		if key, ok = k.keys[parts[0]]; !ok {
			return "", fmt.Errorf("%w (key id %s)", ErrUnknownKey, parts[0])
		}
		data = parts[1]
	}
	if key == nil {
		return "", ErrUnknownKey
	}
	return open(key, data)
}

// needsRekey reports whether the value isn't encrypted with the current key.
func (k *Keyring) needsRekey(encoded string) bool {
	return encoded != "" && !strings.HasPrefix(encoded, cipherPrefix+k.currentID+":")
}

func seal(key []byte, plaintext string) (string, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(plaintext), nil)), nil
}

func open(key []byte, encoded string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	gcm, err := newGCM(key)
	if err != nil {
		return "", err
	}
	if len(data) < gcm.NonceSize() {
		return "", errors.New("ciphertext too short")
	}
	plaintext, err := gcm.Open(nil, data[:gcm.NonceSize()], data[gcm.NonceSize():], nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

func newGCM(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// RekeyResult describes what Rekey changed.
type RekeyResult struct {
	Reencrypted      int
	LegacyKeyRemoved bool
}

// encryptedColumns lists every column holding a Keyring ciphertext.
var encryptedColumns = []struct{ table, column string }{
	{"ldap_config", "bind_password_enc"},
	{"azure_ad_config", "client_secret_enc"},
}

// Rekey re-encrypts values that aren't under the current key, in one transaction.
// With an external key, the legacy key is then removed from the database (the
// point of DATA_ENCRYPTION_KEY: the database alone no longer holds a key).
func (s *Store) Rekey(ctx context.Context) (RekeyResult, error) {
	var result RekeyResult
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		for _, col := range encryptedColumns {
			var value string
			if err := tx.QueryRowContext(ctx, `SELECT `+col.column+` FROM `+col.table+` WHERE id = 1`).Scan(&value); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					continue
				}
				return err
			}
			if !s.keys.needsRekey(value) {
				continue
			}
			plaintext, err := s.keys.decrypt(value)
			if err != nil {
				return fmt.Errorf("%s.%s: %w", col.table, col.column, err)
			}
			encrypted, err := s.keys.encrypt(plaintext)
			if err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE `+col.table+` SET `+col.column+` = ? WHERE id = 1`, encrypted); err != nil {
				return err
			}
			result.Reencrypted++
		}
		if s.keys.external && s.keys.legacy != nil {
			if _, err := tx.ExecContext(ctx, `DELETE FROM app_secrets`); err != nil {
				return err
			}
			result.LegacyKeyRemoved = true
		}
		return nil
	})
	if err == nil && result.LegacyKeyRemoved {
		// Values are all under the external key now; unprefixed ones can't exist.
		delete(s.keys.keys, KeyID(s.keys.legacy))
		s.keys.legacy = nil
	}
	return result, err
}

// KeyInDatabase reports legacy mode: the encryption key is stored next to the data.
func (s *Store) KeyInDatabase() bool { return !s.keys.external }

// KeyID of the key new values are encrypted with.
func (s *Store) CurrentKeyID() string { return s.keys.currentID }

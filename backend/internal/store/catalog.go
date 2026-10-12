package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode"

	"api-portal/backend/internal/models"
)

// recentLimit is how many recently viewed APIs are kept per user.
const recentLimit = 10

// ReplaceAPIOperations stores the operations parsed from an API's spec (replacing
// the previous ones) with the spec's version. The FTS index follows via triggers.
func (s *Store) ReplaceAPIOperations(ctx context.Context, apiID int, version string, ops []models.APIOperation) error {
	return s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM api_operations WHERE api_id = ?`, apiID); err != nil {
			return err
		}
		stmt, err := tx.PrepareContext(ctx, `INSERT INTO api_operations (api_id, method, path, operation_id, summary, tags, deprecated) VALUES (?, ?, ?, ?, ?, ?, ?)`)
		if err != nil {
			return err
		}
		defer stmt.Close()
		for _, op := range ops {
			tags, _ := json.Marshal(nonNil(op.Tags))
			if _, err := stmt.ExecContext(ctx, apiID, op.Method, op.Path, op.OperationID, op.Summary, string(tags), boolInt(op.Deprecated)); err != nil {
				return err
			}
		}
		_, err = tx.ExecContext(ctx, `UPDATE api_definitions SET spec_version = ?, operation_count = ? WHERE id = ?`, version, len(ops), apiID)
		return err
	})
}

// APIsMissingOperationIndex lists APIs with a cached spec whose operations were
// never indexed (specs fetched before 2.0.0).
func (s *Store) APIsMissingOperationIndex(ctx context.Context) ([]int, error) {
	rows, err := s.conn.QueryContext(ctx, `SELECT d.id FROM api_definitions d JOIN api_spec_cache c ON c.api_id = d.id
		WHERE d.operation_count IS NULL AND length(c.spec_json) > 0`)
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
	return ids, rows.Err()
}

// ftsQuery turns user input into an FTS5 query: every word must match as a
// prefix ("charg" finds "charges", "/v1/orders" finds both words). Each word is
// quoted, so FTS syntax in the input (AND, *, :, quotes) is matched literally.
func ftsQuery(input string) string {
	words := strings.FieldsFunc(input, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_' })
	var terms []string
	for _, w := range words {
		if len(terms) == 8 {
			break
		}
		terms = append(terms, `"`+strings.ReplaceAll(w, `"`, `""`)+`"*`)
	}
	return strings.Join(terms, " AND ")
}

// SearchOperations finds operations of the given APIs (the caller passes only
// the APIs the user may see), best match first.
func (s *Store) SearchOperations(ctx context.Context, query string, apiIDs []int, limit int) ([]models.APIOperation, error) {
	match := ftsQuery(query)
	if match == "" || len(apiIDs) == 0 {
		return []models.APIOperation{}, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(apiIDs)), ",")
	args := []any{match}
	for _, id := range apiIDs {
		args = append(args, id)
	}
	args = append(args, limit)
	// Column weights: path and operationId count most, then the summary.
	rows, err := s.conn.QueryContext(ctx, fmt.Sprintf(`SELECT o.api_id, o.method, o.path, o.operation_id, o.summary, o.tags, o.deprecated
		FROM api_operations_fts f JOIN api_operations o ON o.id = f.rowid
		WHERE api_operations_fts MATCH ? AND o.api_id IN (%s)
		ORDER BY bm25(api_operations_fts, 1.0, 6.0, 5.0, 3.0, 1.0), o.path
		LIMIT ?`, placeholders), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.APIOperation{}
	for rows.Next() {
		var op models.APIOperation
		var tags string
		var deprecated int
		if err := rows.Scan(&op.APIID, &op.Method, &op.Path, &op.OperationID, &op.Summary, &tags, &deprecated); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(tags), &op.Tags)
		op.Deprecated = deprecated == 1
		out = append(out, op)
	}
	return out, rows.Err()
}

func (s *Store) SetFavorite(ctx context.Context, userID, apiID int, favorite bool) error {
	if !favorite {
		_, err := s.conn.ExecContext(ctx, `DELETE FROM user_favorites WHERE user_id = ? AND api_id = ?`, userID, apiID)
		return err
	}
	_, err := s.conn.ExecContext(ctx, `INSERT INTO user_favorites (user_id, api_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`, userID, apiID, time.Now().UTC())
	return err
}

func (s *Store) Favorites(ctx context.Context, userID int) (map[int]bool, error) {
	rows, err := s.conn.QueryContext(ctx, `SELECT api_id FROM user_favorites WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int]bool{}
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

// RecordAPIView remembers that the user opened the API, keeping the last recentLimit.
func (s *Store) RecordAPIView(ctx context.Context, userID, apiID int) error {
	return s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO user_recent_apis (user_id, api_id, viewed_at) VALUES (?, ?, ?)
			ON CONFLICT(user_id, api_id) DO UPDATE SET viewed_at = excluded.viewed_at`, userID, apiID, time.Now().UTC()); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM user_recent_apis WHERE user_id = ? AND api_id NOT IN (
			SELECT api_id FROM user_recent_apis WHERE user_id = ? ORDER BY viewed_at DESC LIMIT ?)`, userID, userID, recentLimit)
		return err
	})
}

func (s *Store) RecentAPIViews(ctx context.Context, userID int) (map[int]time.Time, error) {
	rows, err := s.conn.QueryContext(ctx, `SELECT api_id, viewed_at FROM user_recent_apis WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int]time.Time{}
	for rows.Next() {
		var id int
		var at time.Time
		if err := rows.Scan(&id, &at); err != nil {
			return nil, err
		}
		out[id] = at
	}
	return out, rows.Err()
}

func nonNil(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

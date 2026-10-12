package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode"

	"api-portal/backend/internal/models"
)

// recentLimit is how many recently viewed APIs are kept per user.
const recentLimit = 10

const (
	historyKeep    = 50  // spec history entries kept per API
	historyListCap = 200 // operations listed per entry (the counts are exact)
)

// ReplaceAPIOperations stores the operations parsed from an API's spec (replacing
// the previous ones) with the spec's version. The FTS index follows via triggers.
func (s *Store) ReplaceAPIOperations(ctx context.Context, apiID int, version string, ops []models.APIOperation) error {
	return s.withTx(ctx, func(tx *sql.Tx) error { return replaceOperations(ctx, tx, apiID, version, ops) })
}

func replaceOperations(ctx context.Context, tx *sql.Tx, apiID int, version string, ops []models.APIOperation) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM api_operations WHERE api_id = ?`, apiID); err != nil {
		return err
	}
	stmt, err := tx.PrepareContext(ctx, `INSERT INTO api_operations (api_id, method, path, operation_id, summary, tags, deprecated, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, op := range ops {
		tags, _ := json.Marshal(nonNil(op.Tags))
		if _, err := stmt.ExecContext(ctx, apiID, op.Method, op.Path, op.OperationID, op.Summary, string(tags), boolInt(op.Deprecated), op.Fingerprint); err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, `UPDATE api_definitions SET spec_version = ?, operation_count = ? WHERE id = ?`, version, len(ops), apiID)
	return err
}

// ApplySpecIndex indexes a freshly fetched spec. An unchanged spec (same hash)
// changes nothing; otherwise the operations are replaced and the difference
// (added / removed / changed operations) goes into the spec history.
func (s *Store) ApplySpecIndex(ctx context.Context, apiID int, hash, version string, ops []models.APIOperation) error {
	return s.withTx(ctx, func(tx *sql.Tx) error {
		var current string
		var count sql.NullInt64
		if err := tx.QueryRowContext(ctx, `SELECT spec_hash, operation_count FROM api_definitions WHERE id = ?`, apiID).Scan(&current, &count); err != nil {
			return err
		}
		if current == hash && count.Valid {
			return nil
		}
		old := map[string]string{}
		rows, err := tx.QueryContext(ctx, `SELECT method, path, fingerprint FROM api_operations WHERE api_id = ?`, apiID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var method, path, fp string
			if err := rows.Scan(&method, &path, &fp); err != nil {
				rows.Close()
				return err
			}
			old[method+" "+path] = fp
		}
		rows.Close()
		var previous int
		_ = tx.QueryRowContext(ctx, `SELECT count(*) FROM api_spec_history WHERE api_id = ? AND kind != 'failed'`, apiID).Scan(&previous)
		kind := "changed"
		if previous == 0 || current == "" {
			// First index, or one from before fingerprints existed: no meaningful diff.
			kind = "initial"
		}
		var added, removed, changed []string
		seen := map[string]bool{}
		for _, op := range ops {
			key := op.Method + " " + op.Path
			seen[key] = true
			fp, existed := old[key]
			switch {
			case !existed:
				added = append(added, key)
			case fp != "" && fp != op.Fingerprint:
				changed = append(changed, key)
			}
		}
		for key := range old {
			if !seen[key] {
				removed = append(removed, key)
			}
		}
		sort.Strings(removed)
		if err := replaceOperations(ctx, tx, apiID, version, ops); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE api_definitions SET spec_hash = ? WHERE id = ?`, hash, apiID); err != nil {
			return err
		}
		if kind == "changed" && len(added)+len(removed)+len(changed) == 0 {
			// Formatting or metadata only: nothing an API user would notice.
			return nil
		}
		if kind == "initial" {
			added, removed, changed = nil, nil, nil
		}
		return insertHistory(ctx, tx, apiID, models.SpecChange{
			At: time.Now().UTC(), Kind: kind, Version: version, OperationCount: len(ops),
			AddedCount: len(added), RemovedCount: len(removed), ChangedCount: len(changed),
			Added: capList(added), Removed: capList(removed), Changed: capList(changed),
		}, hash)
	})
}

func capList(values []string) []string {
	if len(values) > historyListCap {
		return values[:historyListCap]
	}
	return nonNil(values)
}

func insertHistory(ctx context.Context, tx *sql.Tx, apiID int, c models.SpecChange, hash string) error {
	added, _ := json.Marshal(nonNil(c.Added))
	removed, _ := json.Marshal(nonNil(c.Removed))
	changed, _ := json.Marshal(nonNil(c.Changed))
	if _, err := tx.ExecContext(ctx, `INSERT INTO api_spec_history (api_id, at, kind, spec_hash, version, operation_count, added_count, removed_count, changed_count, added, removed, changed, error)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, apiID, c.At, c.Kind, hash, c.Version, c.OperationCount, c.AddedCount, c.RemovedCount, c.ChangedCount, string(added), string(removed), string(changed), c.Error); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `DELETE FROM api_spec_history WHERE api_id = ? AND id NOT IN (
		SELECT id FROM api_spec_history WHERE api_id = ? ORDER BY at DESC, id DESC LIMIT ?)`, apiID, apiID, historyKeep)
	return err
}

// recordSpecFailure adds a failed refresh to the history, unless the last entry
// is already the same failure (a scheduled refresh repeats it every interval).
func recordSpecFailure(ctx context.Context, tx *sql.Tx, apiID int, message string) error {
	var kind, last string
	err := tx.QueryRowContext(ctx, `SELECT kind, error FROM api_spec_history WHERE api_id = ? ORDER BY at DESC, id DESC LIMIT 1`, apiID).Scan(&kind, &last)
	if err == nil && kind == "failed" && last == message {
		return nil
	}
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	return insertHistory(ctx, tx, apiID, models.SpecChange{At: time.Now().UTC(), Kind: "failed", Error: message}, "")
}

// SpecHistory lists an API's spec changes and failures, newest first.
func (s *Store) SpecHistory(ctx context.Context, apiID int) ([]models.SpecChange, error) {
	rows, err := s.conn.QueryContext(ctx, `SELECT at, kind, version, operation_count, added_count, removed_count, changed_count, added, removed, changed, error
		FROM api_spec_history WHERE api_id = ? ORDER BY at DESC, id DESC`, apiID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.SpecChange{}
	for rows.Next() {
		var c models.SpecChange
		var added, removed, changed string
		if err := rows.Scan(&c.At, &c.Kind, &c.Version, &c.OperationCount, &c.AddedCount, &c.RemovedCount, &c.ChangedCount, &added, &removed, &changed, &c.Error); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(added), &c.Added)
		_ = json.Unmarshal([]byte(removed), &c.Removed)
		_ = json.Unmarshal([]byte(changed), &c.Changed)
		out = append(out, c)
	}
	return out, rows.Err()
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

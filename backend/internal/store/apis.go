package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"api-portal/backend/internal/models"
)

const apiColumns = `id, name, slug, description, internal_openapi_url, internal_base_url, is_active, try_it_enabled, allowed_methods, allowed_path_prefixes, owner_team, tags, created_at, updated_at, last_spec_refresh_at, last_spec_status, owner_group_id, allowed_request_headers, forward_all_x_headers, inject_headers_enc, rate_limit_per_minute, timeout_seconds`

func (s *Store) ListAPIDefinitions(ctx context.Context) ([]models.APIDefinition, error) {
	rows, err := s.conn.QueryContext(ctx, `SELECT `+apiColumns+` FROM api_definitions ORDER BY name`)
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
	row := s.conn.QueryRowContext(ctx, `SELECT `+apiColumns+` FROM api_definitions WHERE id = ?`, id)
	return scanAPI(row)
}

func (s *Store) CreateAPIDefinition(ctx context.Context, api models.APIDefinition) (int, error) {
	now := time.Now().UTC()
	inject, err := s.encodeInjectHeaders(api.InjectHeaders, nil)
	if err != nil {
		return 0, err
	}
	result, err := s.conn.ExecContext(ctx, `INSERT INTO api_definitions (name, slug, description, internal_openapi_url, internal_base_url, is_active, try_it_enabled, allowed_methods, allowed_path_prefixes, owner_team, tags, created_at, updated_at, owner_group_id, allowed_request_headers, forward_all_x_headers, inject_headers_enc, rate_limit_per_minute, timeout_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		api.Name, api.Slug, api.Description, api.InternalOpenAPIURL, api.InternalBaseURL, boolInt(api.IsActive), boolInt(api.TryItEnabled), jsonList(api.AllowedMethods), jsonList(api.AllowedPathPrefixes), api.OwnerTeam, jsonList(api.Tags), now, now,
		api.OwnerGroupID, jsonList(api.AllowedRequestHeaders), boolInt(api.ForwardAllXHeaders), inject, api.RateLimitPerMinute, api.TimeoutSeconds)
	if err != nil {
		return 0, err
	}
	id, _ := result.LastInsertId()
	return int(id), nil
}

// UpdateAPIDefinition saves every field. For injected headers, a header sent with
// an empty value keeps its stored value; headers left out are removed.
func (s *Store) UpdateAPIDefinition(ctx context.Context, api models.APIDefinition) error {
	existing, err := s.GetAPIInjectHeaders(ctx, api.ID)
	if err != nil {
		return err
	}
	inject, err := s.encodeInjectHeaders(api.InjectHeaders, existing)
	if err != nil {
		return err
	}
	_, err = s.conn.ExecContext(ctx, `UPDATE api_definitions SET name = ?, slug = ?, description = ?, internal_openapi_url = ?, internal_base_url = ?, is_active = ?, try_it_enabled = ?, allowed_methods = ?, allowed_path_prefixes = ?, owner_team = ?, tags = ?, updated_at = ?, owner_group_id = ?, allowed_request_headers = ?, forward_all_x_headers = ?, inject_headers_enc = ?, rate_limit_per_minute = ?, timeout_seconds = ? WHERE id = ?`,
		api.Name, api.Slug, api.Description, api.InternalOpenAPIURL, api.InternalBaseURL, boolInt(api.IsActive), boolInt(api.TryItEnabled), jsonList(api.AllowedMethods), jsonList(api.AllowedPathPrefixes), api.OwnerTeam, jsonList(api.Tags), time.Now().UTC(),
		api.OwnerGroupID, jsonList(api.AllowedRequestHeaders), boolInt(api.ForwardAllXHeaders), inject, api.RateLimitPerMinute, api.TimeoutSeconds, api.ID)
	return err
}

// GetAPIInjectHeaders returns the decrypted headers the proxy adds for this API.
func (s *Store) GetAPIInjectHeaders(ctx context.Context, apiID int) (map[string]string, error) {
	var enc string
	if err := s.conn.QueryRowContext(ctx, `SELECT inject_headers_enc FROM api_definitions WHERE id = ?`, apiID).Scan(&enc); err != nil {
		return nil, err
	}
	out := map[string]string{}
	if enc == "" {
		return out, nil
	}
	plain, err := s.keys.decrypt(enc)
	if err != nil {
		return nil, err
	}
	err = json.Unmarshal([]byte(plain), &out)
	return out, err
}

func (s *Store) encodeInjectHeaders(headers []models.HeaderValue, existing map[string]string) (string, error) {
	out := map[string]string{}
	for _, h := range headers {
		name := http.CanonicalHeaderKey(strings.TrimSpace(h.Name))
		if name == "" {
			continue
		}
		value := h.Value
		if value == "" {
			value = existing[name]
		}
		if value != "" {
			out[name] = value
		}
	}
	if len(out) == 0 {
		return "", nil
	}
	raw, _ := json.Marshal(out)
	return s.keys.encrypt(string(raw))
}

// ListAPIAccess returns the groups granted view / invoke on an API.
func (s *Store) ListAPIAccess(ctx context.Context, apiID int) ([]models.APIAccess, error) {
	rows, err := s.conn.QueryContext(ctx, `SELECT aa.group_id, g.name, aa.level FROM api_access aa INNER JOIN "groups" g ON g.id = aa.group_id WHERE aa.api_id = ? ORDER BY g.name`, apiID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.APIAccess{}
	for rows.Next() {
		var a models.APIAccess
		if err := rows.Scan(&a.GroupID, &a.GroupName, &a.Level); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// SetAPIAccess replaces an API's group grants.
func (s *Store) SetAPIAccess(ctx context.Context, apiID int, access []models.APIAccess) error {
	return s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM api_access WHERE api_id = ?`, apiID); err != nil {
			return err
		}
		for _, a := range access {
			if _, err := tx.ExecContext(ctx, `INSERT OR REPLACE INTO api_access (api_id, group_id, level) VALUES (?, ?, ?)`, apiID, a.GroupID, a.Level); err != nil {
				return err
			}
		}
		return nil
	})
}

func jsonList(values []string) string {
	if values == nil {
		values = []string{}
	}
	raw, _ := json.Marshal(values)
	return string(raw)
}

// DeleteAPIDefinition removes the API, its cached spec and the API-scoped
// permissions (api:<id>:view|invoke|manage) that pointed at it.
func (s *Store) DeleteAPIDefinition(ctx context.Context, id int) error {
	return s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM api_spec_cache WHERE api_id = ?`, id); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM permissions WHERE scope LIKE ?`, fmt.Sprintf("api:%d:%%", id)); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM api_definitions WHERE id = ?`, id)
		return err
	})
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
	// Only annotate an existing cache row. Inserting one here used to leave an empty
	// spec_json behind that was then served (200, empty body) and never re-fetched.
	_, err = s.conn.ExecContext(ctx, `UPDATE api_spec_cache SET last_error = ? WHERE api_id = ?`, message, apiID)
	return err
}

func scanAPI(scanner interface{ Scan(...any) error }) (*models.APIDefinition, error) {
	var api models.APIDefinition
	var isActive, tryIt, forwardAll int
	var methods, prefixes, tags, allowedHeaders, injectEnc string
	var lastRefresh sql.NullTime
	var ownerGroup sql.NullInt64
	if err := scanner.Scan(&api.ID, &api.Name, &api.Slug, &api.Description, &api.InternalOpenAPIURL, &api.InternalBaseURL, &isActive, &tryIt, &methods, &prefixes, &api.OwnerTeam, &tags, &api.CreatedAt, &api.UpdatedAt, &lastRefresh, &api.LastSpecStatus,
		&ownerGroup, &allowedHeaders, &forwardAll, &injectEnc, &api.RateLimitPerMinute, &api.TimeoutSeconds); err != nil {
		return nil, err
	}
	api.IsActive = isActive == 1
	api.TryItEnabled = tryIt == 1
	api.ForwardAllXHeaders = forwardAll == 1
	_ = json.Unmarshal([]byte(methods), &api.AllowedMethods)
	_ = json.Unmarshal([]byte(prefixes), &api.AllowedPathPrefixes)
	_ = json.Unmarshal([]byte(tags), &api.Tags)
	_ = json.Unmarshal([]byte(allowedHeaders), &api.AllowedRequestHeaders)
	if lastRefresh.Valid {
		api.LastSpecRefreshAt = &lastRefresh.Time
	}
	if ownerGroup.Valid {
		id := int(ownerGroup.Int64)
		api.OwnerGroupID = &id
	}
	api.InjectHeaderNames = []string{}
	return &api, nil
}

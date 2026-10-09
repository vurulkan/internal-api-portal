package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"api-portal/backend/internal/models"
)

func (s *Store) ListAPIDefinitions(ctx context.Context) ([]models.APIDefinition, error) {
	rows, err := s.conn.QueryContext(ctx, `SELECT id, name, slug, description, internal_openapi_url, internal_base_url, is_active, try_it_enabled, allowed_methods, allowed_path_prefixes, owner_team, tags, created_at, updated_at, last_spec_refresh_at, last_spec_status FROM api_definitions ORDER BY name`)
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
	row := s.conn.QueryRowContext(ctx, `SELECT id, name, slug, description, internal_openapi_url, internal_base_url, is_active, try_it_enabled, allowed_methods, allowed_path_prefixes, owner_team, tags, created_at, updated_at, last_spec_refresh_at, last_spec_status FROM api_definitions WHERE id = ?`, id)
	return scanAPI(row)
}

func (s *Store) CreateAPIDefinition(ctx context.Context, api models.APIDefinition) (int, error) {
	now := time.Now().UTC()
	methods, _ := json.Marshal(api.AllowedMethods)
	prefixes, _ := json.Marshal(api.AllowedPathPrefixes)
	tags, _ := json.Marshal(api.Tags)
	result, err := s.conn.ExecContext(ctx, `INSERT INTO api_definitions (name, slug, description, internal_openapi_url, internal_base_url, is_active, try_it_enabled, allowed_methods, allowed_path_prefixes, owner_team, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		api.Name, api.Slug, api.Description, api.InternalOpenAPIURL, api.InternalBaseURL, boolInt(api.IsActive), boolInt(api.TryItEnabled), string(methods), string(prefixes), api.OwnerTeam, string(tags), now, now)
	if err != nil {
		return 0, err
	}
	id, _ := result.LastInsertId()
	return int(id), nil
}

func (s *Store) UpdateAPIDefinition(ctx context.Context, api models.APIDefinition) error {
	methods, _ := json.Marshal(api.AllowedMethods)
	prefixes, _ := json.Marshal(api.AllowedPathPrefixes)
	tags, _ := json.Marshal(api.Tags)
	_, err := s.conn.ExecContext(ctx, `UPDATE api_definitions SET name = ?, slug = ?, description = ?, internal_openapi_url = ?, internal_base_url = ?, is_active = ?, try_it_enabled = ?, allowed_methods = ?, allowed_path_prefixes = ?, owner_team = ?, tags = ?, updated_at = ? WHERE id = ?`,
		api.Name, api.Slug, api.Description, api.InternalOpenAPIURL, api.InternalBaseURL, boolInt(api.IsActive), boolInt(api.TryItEnabled), string(methods), string(prefixes), api.OwnerTeam, string(tags), time.Now().UTC(), api.ID)
	return err
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
	var isActive, tryIt int
	var methods, prefixes, tags string
	var lastRefresh sql.NullTime
	if err := scanner.Scan(&api.ID, &api.Name, &api.Slug, &api.Description, &api.InternalOpenAPIURL, &api.InternalBaseURL, &isActive, &tryIt, &methods, &prefixes, &api.OwnerTeam, &tags, &api.CreatedAt, &api.UpdatedAt, &lastRefresh, &api.LastSpecStatus); err != nil {
		return nil, err
	}
	api.IsActive = isActive == 1
	api.TryItEnabled = tryIt == 1
	_ = json.Unmarshal([]byte(methods), &api.AllowedMethods)
	_ = json.Unmarshal([]byte(prefixes), &api.AllowedPathPrefixes)
	_ = json.Unmarshal([]byte(tags), &api.Tags)
	if lastRefresh.Valid {
		api.LastSpecRefreshAt = &lastRefresh.Time
	}
	return &api, nil
}

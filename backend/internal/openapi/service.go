package openapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"sigs.k8s.io/yaml"

	"api-portal/backend/internal/models"
	"api-portal/backend/internal/store"
)

type Service struct {
	store  *store.Store
	client *http.Client
}

// New takes the HTTP client used to fetch specs (dialing through netguard). Redirects
// are followed only to the same host, at most three times: a spec URL behind a
// trailing-slash or http→https redirect keeps working, but an upstream can't send
// the portal to another host.
func New(store *store.Store, client *http.Client) *Service {
	guarded := *client
	guarded.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return fmt.Errorf("spec fetch: too many redirects")
		}
		if !strings.EqualFold(req.URL.Hostname(), via[0].URL.Hostname()) {
			return fmt.Errorf("spec fetch: redirect to another host (%s) refused", req.URL.Hostname())
		}
		return nil
	}
	return &Service{store: store, client: &guarded}
}

func (s *Service) Refresh(ctx context.Context, api models.APIDefinition) (*models.APISpecCache, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, api.InternalOpenAPIURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		_ = s.store.MarkSpecRefreshFailure(ctx, api.ID, err.Error())
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		err := fmt.Errorf("spec fetch failed with status %d", resp.StatusCode)
		_ = s.store.MarkSpecRefreshFailure(ctx, api.ID, err.Error())
		return nil, err
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024))
	if err != nil {
		return nil, err
	}
	format := "json"
	sanitized, err := sanitize(body)
	if err != nil {
		if converted, yamlErr := yaml.YAMLToJSON(body); yamlErr == nil {
			format = "yaml"
			sanitized, err = sanitize(converted)
		}
	}
	if err != nil {
		_ = s.store.MarkSpecRefreshFailure(ctx, api.ID, err.Error())
		return nil, err
	}
	cache := models.APISpecCache{
		APIID:        api.ID,
		SpecJSON:     sanitized,
		ETag:         resp.Header.Get("ETag"),
		FetchedAt:    time.Now().UTC(),
		SourceFormat: format,
	}
	if err := s.store.SaveSpecCache(ctx, api.ID, cache); err != nil {
		return nil, err
	}
	return &cache, nil
}

func sanitize(body []byte) (json.RawMessage, error) {
	var doc map[string]any
	if err := json.Unmarshal(body, &doc); err != nil {
		return nil, err
	}
	delete(doc, "host")
	delete(doc, "basePath")
	delete(doc, "schemes")
	doc["servers"] = []any{}
	if info, ok := doc["info"].(map[string]any); ok {
		if description, ok := info["description"].(string); ok {
			info["description"] = strings.ReplaceAll(description, "http://", "")
		}
	}
	out, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	return out, nil
}

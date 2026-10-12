package openapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"sort"
	"strconv"
	"strings"

	"api-portal/backend/internal/models"
)

var methods = []string{"get", "put", "post", "delete", "options", "head", "patch", "trace"}

// ExtractOperations lists the operations of an OpenAPI 2 / 3 document and its
// info.version. Malformed parts are skipped, not fatal: the index is best effort.
func ExtractOperations(spec json.RawMessage) (string, []models.APIOperation) {
	var doc struct {
		Info struct {
			Version any `json:"version"`
		} `json:"info"`
		Paths map[string]map[string]json.RawMessage `json:"paths"`
	}
	if err := json.Unmarshal(spec, &doc); err != nil {
		return "", nil
	}
	version := ""
	switch v := doc.Info.Version.(type) {
	case string:
		version = v
	case float64:
		// "version: 2.1" in YAML arrives as a number.
		version = strconv.FormatFloat(v, 'f', -1, 64)
	}
	ops := []models.APIOperation{}
	for path, item := range doc.Paths {
		for _, method := range methods {
			raw, ok := item[method]
			if !ok {
				continue
			}
			var op struct {
				OperationID string   `json:"operationId"`
				Summary     string   `json:"summary"`
				Description string   `json:"description"`
				Tags        []string `json:"tags"`
				Deprecated  bool     `json:"deprecated"`
			}
			if err := json.Unmarshal(raw, &op); err != nil {
				continue
			}
			summary := op.Summary
			if summary == "" {
				// First line of the description, shortened.
				summary = strings.TrimSpace(strings.SplitN(op.Description, "\n", 2)[0])
			}
			ops = append(ops, models.APIOperation{
				Method:      strings.ToUpper(method),
				Path:        path,
				OperationID: limit(op.OperationID, 200),
				Summary:     limit(summary, 300),
				Tags:        op.Tags,
				Deprecated:  op.Deprecated,
			})
		}
	}
	sort.Slice(ops, func(i, j int) bool {
		if ops[i].Path != ops[j].Path {
			return ops[i].Path < ops[j].Path
		}
		return ops[i].Method < ops[j].Method
	})
	return limit(version, 64), ops
}

func limit(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}

// index stores the operations of a freshly cached spec.
func (s *Service) index(ctx context.Context, apiID int, spec json.RawMessage) {
	version, ops := ExtractOperations(spec)
	if err := s.store.ReplaceAPIOperations(ctx, apiID, version, ops); err != nil {
		slog.ErrorContext(ctx, "spec.index_failed", "portal.api_id", apiID, "error", err.Error())
	}
}

// IndexMissing indexes cached specs that predate the operation index (2.0.0).
func (s *Service) IndexMissing(ctx context.Context) {
	ids, err := s.store.APIsMissingOperationIndex(ctx)
	if err != nil {
		slog.ErrorContext(ctx, "spec.index_failed", "error", err.Error())
		return
	}
	for _, id := range ids {
		cache, err := s.store.GetSpecCache(ctx, id)
		if err != nil {
			continue
		}
		s.index(ctx, id, cache.SpecJSON)
	}
	if len(ids) > 0 {
		slog.InfoContext(ctx, "spec.index_backfilled", "portal.apis", len(ids))
	}
}

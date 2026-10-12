package api

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"api-portal/backend/internal/models"
)

// Specs are fetched right after an API is saved and then every
// SPEC_REFRESH_INTERVAL (default 6h; 0 turns both off), so the catalog's
// version, operation count and search index stay current without anyone
// opening the API first.

const specRefreshTimeout = 60 * time.Second

// refreshInBackground fetches one API's spec without holding up the request.
func (s *Server) refreshInBackground(apiDef models.APIDefinition) {
	if s.config.SpecRefreshInterval <= 0 {
		return
	}
	s.background.Add(1)
	go func() {
		defer s.background.Done()
		ctx, cancel := context.WithTimeout(context.Background(), specRefreshTimeout)
		defer cancel()
		if _, err := s.refreshSpec(ctx, apiDef); err != nil {
			slog.WarnContext(ctx, "spec.refresh_failed", "portal.api_id", apiDef.ID, "portal.api", apiDef.Name, "error", err.Error())
		}
	}()
}

// StartSpecRefresh refreshes every active API's spec once a minute after start,
// then every interval, four at a time.
func (s *Server) StartSpecRefresh(ctx context.Context) {
	interval := s.config.SpecRefreshInterval
	if interval <= 0 {
		return
	}
	go func() {
		timer := time.NewTimer(time.Minute)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
			}
			s.refreshAllSpecs(ctx)
			timer.Reset(interval)
		}
	}()
}

func (s *Server) refreshAllSpecs(ctx context.Context) {
	apis, err := s.store.ListAPIDefinitions(ctx)
	if err != nil {
		slog.ErrorContext(ctx, "spec.refresh_failed", "error", err.Error())
		return
	}
	start := time.Now()
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	failed := 0
	var mu sync.Mutex
	for _, apiDef := range apis {
		if !apiDef.IsActive {
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(apiDef models.APIDefinition) {
			defer wg.Done()
			defer func() { <-sem }()
			one, cancel := context.WithTimeout(ctx, specRefreshTimeout)
			defer cancel()
			if _, err := s.refreshSpec(one, apiDef); err != nil {
				mu.Lock()
				failed++
				mu.Unlock()
				slog.WarnContext(ctx, "spec.refresh_failed", "portal.api_id", apiDef.ID, "portal.api", apiDef.Name, "error", err.Error())
			}
		}(apiDef)
	}
	wg.Wait()
	slog.InfoContext(ctx, "spec.refresh_finished", "portal.apis", len(apis), "portal.failed", failed, "event.duration", time.Since(start))
}

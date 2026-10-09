package audit

import (
	"context"
	"log/slog"
	"time"

	"api-portal/backend/internal/models"
	"api-portal/backend/internal/store"
)

type Logger struct {
	store *store.Store
}

func New(store *store.Store) *Logger {
	return &Logger{store: store}
}

// Record stores the entry and mirrors it as an "audit" log line, so log pipelines
// see audit events next to the request log (same request_id). A failed write is
// logged instead of being silently dropped.
func (l *Logger) Record(ctx context.Context, entry models.AuditLog) {
	entry.Timestamp = time.Now().UTC()
	level := slog.LevelInfo
	if entry.Blocked || entry.StatusCode >= 400 {
		level = slog.LevelWarn
	}
	slog.Log(ctx, level, "audit",
		"action", entry.Action,
		"user", entry.User,
		"resource_type", entry.ResourceType,
		"resource_id", entry.ResourceID,
		"status", entry.StatusCode,
		"blocked", entry.Blocked,
		"ip", entry.SourceIP,
		"request_id", entry.RequestID,
	)
	if err := l.store.AddAuditLog(context.WithoutCancel(ctx), entry); err != nil {
		slog.ErrorContext(ctx, "audit.write_failed", "action", entry.Action, "error", err.Error(), "request_id", entry.RequestID)
	}
}

// StartRetention deletes entries older than retentionDays now and then every
// interval (it used to wait a full interval before the first purge).
func (l *Logger) StartRetention(ctx context.Context, retentionDays int, interval time.Duration) {
	if retentionDays <= 0 {
		return
	}
	purge := func() {
		cutoff := time.Now().UTC().Add(-time.Duration(retentionDays) * 24 * time.Hour)
		if err := l.store.PurgeAuditLogs(context.Background(), cutoff); err != nil {
			slog.Error("audit.purge_failed", "error", err.Error())
		}
	}
	go func() {
		purge()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				purge()
			}
		}
	}()
}

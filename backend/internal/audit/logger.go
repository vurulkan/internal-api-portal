package audit

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	"api-portal/backend/internal/logging"
	"api-portal/backend/internal/models"
	"api-portal/backend/internal/store"
)

type Logger struct {
	store *store.Store
	// mirror writes every entry to the log as event.dataset portal.audit.
	mirror bool
}

func New(store *store.Store, mirror bool) *Logger {
	return &Logger{store: store, mirror: mirror}
}

// Record stores the entry and, when mirroring is on, writes the same record to
// the log: the log line carries every field of the stored entry, so the pod logs
// (shipped to Elasticsearch) are a complete audit trail on their own. A failed
// database write is logged instead of being silently dropped.
func (l *Logger) Record(ctx context.Context, entry models.AuditLog) {
	entry.Timestamp = time.Now().UTC()
	if l.mirror {
		LogEntry(ctx, entry)
	}
	if err := l.store.AddAuditLog(context.WithoutCancel(ctx), entry); err != nil {
		slog.ErrorContext(ctx, "audit.write_failed", "audit_action", entry.Action, "error", err.Error())
	}
}

// LogEntry writes one audit entry as an ECS log line.
func LogEntry(ctx context.Context, e models.AuditLog) {
	action, outcome := splitAction(e.Action, e.Outcome)
	level := slog.LevelInfo
	if outcome != "success" {
		level = slog.LevelWarn
	}
	ecsOutcome := "success"
	if outcome == "denied" || outcome == "failed" {
		ecsOutcome = "failure"
	}
	category, types := classify(action, outcome)

	attrs := []slog.Attr{
		slog.Time("@timestamp", e.Timestamp),
		slog.String("event.dataset", logging.DatasetAudit),
		slog.String("event.kind", "event"),
		slog.String("event.action", action),
		slog.String("event.outcome", ecsOutcome),
		slog.Any("event.category", category),
		slog.Any("event.type", types),
		slog.String("portal.audit.action", e.Action),
		slog.String("portal.audit.outcome", outcome),
		slog.Bool("portal.audit.blocked", e.Blocked),
		slog.String("user.name", e.User),
		slog.String("source.ip", e.SourceIP),
		slog.String("http.request.id", e.RequestID),
		slog.Int("http.response.status_code", e.StatusCode),
	}
	add := func(a slog.Attr) { attrs = append(attrs, a) }
	if e.ActorSource != "" {
		add(slog.String("user.domain", e.ActorSource))
	}
	if e.UserAgent != "" {
		add(slog.String("user_agent.original", e.UserAgent))
	}
	if e.DurationMs > 0 {
		add(slog.Duration("event.duration", time.Duration(e.DurationMs)*time.Millisecond))
	}
	if e.PortalStatusCode != 0 && e.PortalStatusCode != e.StatusCode {
		add(slog.Int("portal.http.status_code", e.PortalStatusCode))
	}
	if e.ResourceType != "" {
		add(slog.String("portal.target.type", e.ResourceType))
	}
	if e.ResourceID != "" {
		add(slog.String("portal.target.id", e.ResourceID))
	}
	if e.ResourceName != "" {
		add(slog.String("portal.target.name", e.ResourceName))
	}
	if e.Changes != "" {
		add(slog.Any("portal.changes", strings.Split(e.Changes, ",")))
	}
	if e.ErrorMessage != "" {
		add(slog.String("event.reason", e.ErrorMessage))
		if outcome == "failed" {
			add(slog.String("error.message", e.ErrorMessage))
		}
	}
	details := map[string]any{}
	if e.DetailsJSON != "" {
		if err := json.Unmarshal([]byte(e.DetailsJSON), &details); err != nil {
			details = map[string]any{"value": e.DetailsJSON}
		}
		details = logging.Redact(details)
		add(slog.Any("portal.details", details))
	}
	if action == "api.invoke" {
		// The upstream request, in ECS terms.
		if method, ok := details["method"].(string); ok && method != "" {
			add(slog.String("http.request.method", method))
		}
		if path, ok := details["path"].(string); ok && path != "" {
			add(slog.String("url.path", path))
		}
		if names, ok := details["queryParams"].([]any); ok && len(names) > 0 {
			add(slog.Any("portal.invoke.query_params", names))
		}
		add(slog.Int64("portal.invoke.request_bytes", e.RequestBytes))
		add(slog.Int64("portal.invoke.response_bytes", e.ResponseBytes))
		if names := headerNames(e.SanitizedHeader); len(names) > 0 {
			add(slog.Any("portal.invoke.headers", names))
		}
	}
	slog.LogAttrs(ctx, level, message(e, action, outcome), attrs...)
}

// message is the human-readable line ("olivia api.invoke denied api Payments API").
func message(e models.AuditLog, action, outcome string) string {
	target := e.ResourceName
	if target == "" {
		target = e.ResourceID
	}
	msg := fmt.Sprintf("%s %s %s", orDash(e.User), action, outcome)
	if e.ResourceType != "" || target != "" {
		msg += " " + strings.TrimSpace(e.ResourceType+" "+target)
	}
	return msg
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

// splitAction separates "user.update.success" into "user.update" and "success".
func splitAction(full, outcome string) (string, string) {
	for _, o := range []string{"success", "denied", "failed"} {
		if strings.HasSuffix(full, "."+o) {
			return strings.TrimSuffix(full, "."+o), o
		}
	}
	if outcome == "" {
		outcome = "success"
	}
	return full, outcome
}

// classify maps an action to ECS event.category / event.type.
func classify(action, outcome string) ([]string, []string) {
	domain, verb, _ := strings.Cut(action, ".")
	category := "configuration"
	switch domain {
	case "auth":
		category = "authentication"
	case "user", "group", "role":
		category = "iam"
	case "session":
		category = "session"
	case "audit":
		category = "database"
	case "api":
		if verb == "invoke" || verb == "view" || verb == "spec_view" || verb == "spec" {
			category = "web"
		}
	}
	var types []string
	switch {
	case strings.HasPrefix(verb, "login"):
		types = []string{"start"}
	case verb == "logout" || strings.HasPrefix(verb, "revoke") || strings.HasSuffix(verb, "revoke") || strings.HasSuffix(verb, "sessions_revoke"):
		types = []string{"end"}
	case strings.HasPrefix(verb, "create"):
		types = []string{"creation"}
	case strings.HasPrefix(verb, "delete") || strings.HasSuffix(verb, "_delete"):
		types = []string{"deletion"}
	case verb == "invoke" || verb == "view" || verb == "spec_view" || verb == "export":
		types = []string{"access"}
	case strings.Contains(verb, "test") || verb == "ldap_search":
		types = []string{"info"}
	default:
		types = []string{"change"}
	}
	switch domain {
	case "user":
		types = append([]string{"user"}, types...)
	case "group":
		types = append([]string{"group"}, types...)
	case "role":
		types = append([]string{"admin"}, types...)
	}
	switch outcome {
	case "denied":
		types = append(types, "denied")
	case "failed":
		types = append(types, "error")
	}
	return []string{category}, types
}

func headerNames(sanitized string) []string {
	if sanitized == "" {
		return nil
	}
	var headers map[string]string
	if json.Unmarshal([]byte(sanitized), &headers) != nil {
		return nil
	}
	names := make([]string, 0, len(headers))
	for name := range headers {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
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

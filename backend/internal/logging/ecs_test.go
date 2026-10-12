package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func decode(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		if line == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			t.Fatalf("not JSON: %q", line)
		}
		out = append(out, m)
	}
	return out
}

func get(m map[string]any, path string) any {
	return getPath(m, path)
}

func TestECSHandlerShape(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	defer slog.SetDefault(prev)
	logger := SetupWriter(&buf, Options{Format: "json", Service: "portal", Version: "1.6.0", Environment: "test"})

	ctx := WithRequestID(context.Background(), "req-1")
	logger.InfoContext(ctx, "db.migration.applied", "migration", 8, "error", errors.New("boom"), "user", "alice", "event.duration", 3*time.Millisecond)
	logger.Warn("x", "password", "hunter2", "portal.token", "tok", "bindPassword", "b")
	logger.Info("audit line", "event.dataset", DatasetAudit, "event.action", "user.update")

	lines := decode(t, &buf)
	if len(lines) != 3 {
		t.Fatalf("got %d lines", len(lines))
	}
	first := lines[0]
	ts, _ := first["@timestamp"].(string)
	if _, err := time.Parse(time.RFC3339Nano, ts); err != nil || len(ts) != len(TimestampLayout) || !strings.HasSuffix(ts, "Z") {
		t.Errorf("@timestamp not UTC: %q", ts)
	}
	checks := map[string]any{
		"log.level": "info", "message": "db.migration.applied", "ecs.version": ECSVersion,
		"service.name": "portal", "service.version": "1.6.0", "service.environment": "test",
		"event.dataset": DatasetApp, "event.action": "db.migration.applied", "event.kind": "event",
		"http.request.id": "req-1", "error.message": "boom", "user.name": "alice",
		"portal.migration": float64(8), "event.duration": float64(3_000_000),
	}
	for path, want := range checks {
		if got := get(first, path); got != want {
			t.Errorf("%s = %#v, want %#v", path, got, want)
		}
	}
	second := lines[1]
	for _, path := range []string{"portal.password", "portal.token", "portal.bindPassword"} {
		if got := get(second, path); got != "[REDACTED]" {
			t.Errorf("%s = %v, want redacted", path, got)
		}
	}
	if strings.Contains(buf.String(), "hunter2") {
		t.Error("a password value reached the log")
	}
	if get(lines[2], "event.dataset") != DatasetAudit || get(lines[2], "event.action") != "user.update" {
		t.Errorf("explicit dataset / action overridden: %v", lines[2])
	}
}

func TestTextFormatRedactsToo(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	defer slog.SetDefault(prev)
	SetupWriter(&buf, Options{Format: "text"}).Info("x", "password", "hunter2", "user", "alice")
	if strings.Contains(buf.String(), "hunter2") || !strings.Contains(buf.String(), "user=alice") {
		t.Fatalf("text output: %s", buf.String())
	}
}

func TestRedact(t *testing.T) {
	out := Redact(map[string]any{"Authorization": "Bearer x", "nested": map[string]any{"client_secret": "s", "ok": 1}, "path": "/a"})
	if out["Authorization"] != "[REDACTED]" || out["nested"].(map[string]any)["client_secret"] != "[REDACTED]" || out["path"] != "/a" {
		t.Fatalf("Redact: %v", out)
	}
}

package api

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"
)

// With 10,000 audit entries the audit page, its filters and the overview's 24-hour
// counts answer within 100 ms (checked without the race detector, which slows
// SQLite down ~40x; CI runs it in the performance budget step).
func TestAuditListIsFastWith10kEntries(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	ctx := context.Background()
	tx, err := e.dbConn.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	actions := []string{"api.invoke.success", "api.invoke.denied", "user.update.success", "auth.login.success", "role.permissions_set.failed"}
	for i := 0; i < 10000; i++ {
		action := actions[i%len(actions)]
		outcome := map[bool]string{true: "success", false: "denied"}[i%5 != 1]
		if i%5 == 4 {
			outcome = "failed"
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO audit_logs (timestamp, user, action, resource_type, resource_id, resource_name, source_ip, status_code, duration_ms, request_bytes, response_bytes, blocked, error_message, sanitized_headers, details_json, request_id, outcome, actor_source, changes, user_agent)
			VALUES (?, ?, ?, 'api', ?, 'Payments API', '10.0.0.1', 200, 12, 0, 0, 0, '', '', '', ?, ?, 'local', '', 'test')`,
			now.Add(-time.Duration(i)*time.Minute), fmt.Sprintf("user%d", i%40), action, fmt.Sprint(i%7), fmt.Sprintf("req-%d", i), outcome); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	root := e.login("root")
	from := now.Add(-24 * time.Hour).Format(time.RFC3339)
	for _, path := range []string{
		"/api/admin/audit-logs?limit=100",
		"/api/admin/audit-logs?limit=100&offset=5000",
		"/api/admin/audit-logs?limit=100&action=api.invoke&outcome=denied&from=" + from,
		"/api/admin/audit-logs?limit=100&user=user7",
		"/api/admin/overview",
	} {
		start := time.Now()
		e.expect(http.MethodGet, path, root, nil, http.StatusOK)
		took := time.Since(start)
		t.Logf("%s: %s", path, took)
		if took > 100*time.Millisecond && !raceEnabled {
			t.Errorf("%s took %s, budget 100 ms", path, took)
		}
	}
}

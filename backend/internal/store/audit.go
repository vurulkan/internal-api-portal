package store

import (
	"context"
	"time"

	"api-portal/backend/internal/models"
)

const auditColumns = `id, timestamp, user, action, resource_type, resource_id, resource_name, source_ip, status_code, duration_ms, request_bytes, response_bytes, blocked, error_message, sanitized_headers, details_json, request_id, outcome, actor_source, changes`

func (s *Store) AddAuditLog(ctx context.Context, entry models.AuditLog) error {
	_, err := s.conn.ExecContext(ctx, `INSERT INTO audit_logs (timestamp, user, action, resource_type, resource_id, resource_name, source_ip, status_code, duration_ms, request_bytes, response_bytes, blocked, error_message, sanitized_headers, details_json, request_id, outcome, actor_source, changes)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		entry.Timestamp, entry.User, entry.Action, entry.ResourceType, entry.ResourceID, entry.ResourceName, entry.SourceIP, entry.StatusCode, entry.DurationMs, entry.RequestBytes, entry.ResponseBytes, boolInt(entry.Blocked), entry.ErrorMessage, entry.SanitizedHeader, entry.DetailsJSON, entry.RequestID, entry.Outcome, entry.ActorSource, entry.Changes)
	return err
}

func auditWhere(f models.AuditFilter) (string, []any) {
	where := ` FROM audit_logs WHERE 1=1`
	var args []any
	if !f.From.IsZero() {
		where += ` AND timestamp >= ?`
		args = append(args, f.From.UTC())
	}
	if !f.To.IsZero() {
		where += ` AND timestamp < ?`
		args = append(args, f.To.UTC())
	}
	if f.User != "" {
		where += ` AND user = ?`
		args = append(args, f.User)
	}
	if f.ActionPrefix != "" {
		// Prefix match: "user." finds every user action, "api.invoke" all its outcomes.
		where += ` AND action LIKE ? ESCAPE '\'`
		args = append(args, escapeLike(f.ActionPrefix)+"%")
	}
	if f.Outcome != "" {
		where += ` AND outcome = ?`
		args = append(args, f.Outcome)
	}
	if f.TargetType != "" {
		where += ` AND resource_type = ?`
		args = append(args, f.TargetType)
	}
	if f.TargetID != "" {
		where += ` AND resource_id = ?`
		args = append(args, f.TargetID)
	}
	return where, args
}

func escapeLike(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if r == '%' || r == '_' || r == '\\' {
			out = append(out, '\\')
		}
		out = append(out, r)
	}
	return string(out)
}

func (s *Store) ListAuditLogs(ctx context.Context, filter models.AuditFilter, limit, offset int) ([]models.AuditLog, int, error) {
	where, args := auditWhere(filter)
	var total int
	if err := s.conn.QueryRowContext(ctx, `SELECT COUNT(*)`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.conn.QueryContext(ctx, `SELECT `+auditColumns+where+` ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`, append(args, limit, offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	logs := []models.AuditLog{}
	for rows.Next() {
		entry, err := scanAudit(rows)
		if err != nil {
			return nil, 0, err
		}
		logs = append(logs, *entry)
	}
	return logs, total, rows.Err()
}

// EachAuditLog streams matching entries, newest first, up to max (0: no limit),
// and reports whether more matched than were returned.
func (s *Store) EachAuditLog(ctx context.Context, filter models.AuditFilter, max int, fn func(models.AuditLog) error) (truncated bool, err error) {
	where, args := auditWhere(filter)
	query := `SELECT ` + auditColumns + where + ` ORDER BY timestamp DESC, id DESC`
	if max > 0 {
		query += ` LIMIT ?`
		args = append(args, max+1)
	}
	rows, err := s.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		if max > 0 && n == max {
			return true, nil
		}
		entry, err := scanAudit(rows)
		if err != nil {
			return false, err
		}
		if err := fn(*entry); err != nil {
			return false, err
		}
		n++
	}
	return false, rows.Err()
}

func scanAudit(scanner interface{ Scan(...any) error }) (*models.AuditLog, error) {
	var entry models.AuditLog
	var blocked int
	err := scanner.Scan(&entry.ID, &entry.Timestamp, &entry.User, &entry.Action, &entry.ResourceType, &entry.ResourceID, &entry.ResourceName, &entry.SourceIP, &entry.StatusCode, &entry.DurationMs, &entry.RequestBytes, &entry.ResponseBytes, &blocked, &entry.ErrorMessage, &entry.SanitizedHeader, &entry.DetailsJSON, &entry.RequestID, &entry.Outcome, &entry.ActorSource, &entry.Changes)
	entry.Blocked = blocked == 1
	return &entry, err
}

func (s *Store) PurgeAuditLogs(ctx context.Context, cutoff time.Time) error {
	_, err := s.conn.ExecContext(ctx, `DELETE FROM audit_logs WHERE timestamp < ?`, cutoff)
	return err
}

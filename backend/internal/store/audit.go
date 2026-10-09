package store

import (
	"context"
	"time"

	"api-portal/backend/internal/models"
)

func (s *Store) AddAuditLog(ctx context.Context, entry models.AuditLog) error {
	_, err := s.conn.ExecContext(ctx, `INSERT INTO audit_logs (timestamp, user, action, resource_type, resource_id, resource_name, source_ip, status_code, duration_ms, request_bytes, response_bytes, blocked, error_message, sanitized_headers, details_json, request_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		entry.Timestamp, entry.User, entry.Action, entry.ResourceType, entry.ResourceID, entry.ResourceName, entry.SourceIP, entry.StatusCode, entry.DurationMs, entry.RequestBytes, entry.ResponseBytes, boolInt(entry.Blocked), entry.ErrorMessage, entry.SanitizedHeader, entry.DetailsJSON, entry.RequestID)
	return err
}

func (s *Store) ListAuditLogs(ctx context.Context, limit, offset int, action, username string) ([]models.AuditLog, int, error) {
	baseQuery := ` FROM audit_logs WHERE 1=1`
	args := []any{}
	if action != "" {
		baseQuery += ` AND action = ?`
		args = append(args, action)
	}
	if username != "" {
		baseQuery += ` AND user = ?`
		args = append(args, username)
	}
	var total int
	if err := s.conn.QueryRowContext(ctx, `SELECT COUNT(*)`+baseQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	query := `SELECT id, timestamp, user, action, resource_type, resource_id, resource_name, source_ip, status_code, duration_ms, request_bytes, response_bytes, blocked, error_message, sanitized_headers, details_json, request_id` + baseQuery
	query += ` ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`
	args = append(args, limit, offset)
	rows, err := s.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var logs []models.AuditLog
	for rows.Next() {
		var entry models.AuditLog
		var blocked int
		if err := rows.Scan(&entry.ID, &entry.Timestamp, &entry.User, &entry.Action, &entry.ResourceType, &entry.ResourceID, &entry.ResourceName, &entry.SourceIP, &entry.StatusCode, &entry.DurationMs, &entry.RequestBytes, &entry.ResponseBytes, &blocked, &entry.ErrorMessage, &entry.SanitizedHeader, &entry.DetailsJSON, &entry.RequestID); err != nil {
			return nil, 0, err
		}
		entry.Blocked = blocked == 1
		logs = append(logs, entry)
	}
	return logs, total, nil
}

func (s *Store) PurgeAuditLogs(ctx context.Context, cutoff time.Time) error {
	_, err := s.conn.ExecContext(ctx, `DELETE FROM audit_logs WHERE timestamp < ?`, cutoff)
	return err
}

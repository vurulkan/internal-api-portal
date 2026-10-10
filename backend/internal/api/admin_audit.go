package api

import (
	"encoding/csv"
	"net/http"
	"strconv"
	"strings"
	"time"

	"api-portal/backend/internal/models"
)

// auditFilter reads the filters both the list and the export accept:
// from, to (RFC 3339 or YYYY-MM-DD), user, action (prefix), outcome, targetType,
// targetId, apiId (shorthand for targetType=api&targetId=<id>).
func auditFilter(r *http.Request) (models.AuditFilter, string) {
	q := r.URL.Query()
	var f models.AuditFilter
	parse := func(name string) (time.Time, bool) {
		raw := strings.TrimSpace(q.Get(name))
		if raw == "" {
			return time.Time{}, true
		}
		for _, layout := range []string{time.RFC3339, "2006-01-02"} {
			if t, err := time.Parse(layout, raw); err == nil {
				return t, true
			}
		}
		return time.Time{}, false
	}
	var ok bool
	if f.From, ok = parse("from"); !ok {
		return f, "from must be RFC 3339 or YYYY-MM-DD"
	}
	if f.To, ok = parse("to"); !ok {
		return f, "to must be RFC 3339 or YYYY-MM-DD"
	}
	f.User = strings.TrimSpace(q.Get("user"))
	f.ActionPrefix = strings.TrimSpace(q.Get("action"))
	f.Outcome = strings.TrimSpace(q.Get("outcome"))
	switch f.Outcome {
	case "", "success", "denied", "failed":
	default:
		return f, "outcome must be success, denied or failed"
	}
	f.TargetType = strings.TrimSpace(q.Get("targetType"))
	f.TargetID = strings.TrimSpace(q.Get("targetId"))
	if api := strings.TrimSpace(q.Get("apiId")); api != "" {
		f.TargetType, f.TargetID = "api", api
	}
	return f, ""
}

func (s *Server) handleAuditLogs(w http.ResponseWriter, r *http.Request) {
	filter, problem := auditFilter(r)
	if problem != "" {
		writeError(w, r, http.StatusBadRequest, problem)
		return
	}
	limit, _ := strconv.Atoi(defaultString(r.URL.Query().Get("limit"), "25"))
	offset, _ := strconv.Atoi(defaultString(r.URL.Query().Get("offset"), "0"))
	limit = clampInt(limit, 1, 500)
	offset = clampInt(offset, 0, 1<<30)
	logs, total, err := s.store.ListAuditLogs(r.Context(), filter, limit, offset)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load audit logs")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":  logs,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

// handleAuditLogsExport streams the entries matching the same filters as the list
// as CSV, newest first. More than AUDIT_EXPORT_MAX_ROWS matches: the newest rows
// are sent and X-Audit-Export-Truncated: true says so.
func (s *Server) handleAuditLogsExport(w http.ResponseWriter, r *http.Request) {
	filter, problem := auditFilter(r)
	if problem != "" {
		writeError(w, r, http.StatusBadRequest, problem)
		return
	}
	max := s.config.AuditExportMaxRows
	if max <= 0 {
		max = 100000
	}
	// Count first so the truncation flag can go in a header before the body starts.
	_, total, err := s.store.ListAuditLogs(r.Context(), filter, 1, 0)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to export audit logs")
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="audit-logs-`+time.Now().UTC().Format("20060102-150405")+`.csv"`)
	w.Header().Set("X-Audit-Export-Rows", strconv.Itoa(min(total, max)))
	if total > max {
		w.Header().Set("X-Audit-Export-Truncated", "true")
	}
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"timestamp", "user", "actorSource", "action", "outcome", "targetType", "targetId", "targetName", "changes", "statusCode", "durationMs", "blocked", "sourceIp", "requestId", "errorMessage", "details"})
	n := 0
	_, err = s.store.EachAuditLog(r.Context(), filter, max, func(e models.AuditLog) error {
		n++
		if err := writer.Write([]string{
			e.Timestamp.In(s.timezone).Format(time.RFC3339), csvCell(e.User), csvCell(e.ActorSource), csvCell(e.Action), e.Outcome,
			csvCell(e.ResourceType), csvCell(e.ResourceID), csvCell(e.ResourceName), csvCell(e.Changes),
			strconv.Itoa(e.StatusCode), strconv.FormatInt(e.DurationMs, 10), strconv.FormatBool(e.Blocked),
			csvCell(e.SourceIP), csvCell(e.RequestID), csvCell(e.ErrorMessage), csvCell(e.DetailsJSON),
		}); err != nil {
			return err
		}
		if n%500 == 0 {
			writer.Flush()
		}
		return nil
	})
	writer.Flush()
	// Exporting the audit log is itself audited (it is a read, so no middleware).
	entry := models.AuditLog{Action: "audit.export.success", Outcome: "success", ResourceType: "audit", StatusCode: http.StatusOK,
		DetailsJSON: marshalJSON(map[string]any{"rows": n, "truncated": total > max, "filter": r.URL.RawQuery})}
	if err != nil {
		entry.Action, entry.Outcome, entry.ErrorMessage = "audit.export.failed", "failed", err.Error()
	}
	s.recordAudit(r, entry)
}

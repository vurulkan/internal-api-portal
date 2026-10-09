package api

import (
	"encoding/csv"
	"net/http"
	"strconv"
	"time"
)

func (s *Server) handleAuditLogs(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(defaultString(r.URL.Query().Get("limit"), "25"))
	offset, _ := strconv.Atoi(defaultString(r.URL.Query().Get("offset"), "0"))
	limit = clampInt(limit, 1, 500)
	offset = clampInt(offset, 0, 1<<30)
	logs, total, err := s.store.ListAuditLogs(r.Context(), limit, offset, r.URL.Query().Get("action"), r.URL.Query().Get("user"))
	if err != nil {
		http.Error(w, "failed to load audit logs", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":  logs,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (s *Server) handleAuditLogsExport(w http.ResponseWriter, r *http.Request) {
	logs, _, err := s.store.ListAuditLogs(r.Context(), 5000, 0, r.URL.Query().Get("action"), r.URL.Query().Get("user"))
	if err != nil {
		http.Error(w, "failed to export audit logs", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", `attachment; filename="audit-logs.csv"`)
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"timestamp", "user", "action", "resourceType", "resourceId", "resourceName", "statusCode", "durationMs", "blocked", "errorMessage"})
	for _, entry := range logs {
		_ = writer.Write([]string{entry.Timestamp.In(s.timezone).Format(time.RFC3339), csvCell(entry.User), csvCell(entry.Action), csvCell(entry.ResourceType), csvCell(entry.ResourceID), csvCell(entry.ResourceName), strconv.Itoa(entry.StatusCode), strconv.FormatInt(entry.DurationMs, 10), strconv.FormatBool(entry.Blocked), csvCell(entry.ErrorMessage)})
	}
	writer.Flush()
}

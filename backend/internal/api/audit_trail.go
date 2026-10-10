package api

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"sort"
	"strings"
	"sync"
	"time"

	"api-portal/backend/internal/models"
)

// Every state-changing route is registered with audited("<domain>.<verb>"). The
// middleware writes exactly one audit entry per request, "<domain>.<verb>.<outcome>",
// from the response status: success (< 400), denied (401, 403, 429) or failed
// (anything else). Handlers only add the target, details and the names of changed
// fields; an error message passed to writeError becomes the entry's reason. So a
// write can't be left unaudited, and denials and failures are recorded the same
// way as successes.

type auditInfo struct {
	mu          sync.Mutex
	targetType  string
	targetID    string
	targetName  string
	actor       string
	actorSource string
	details     map[string]any
	changes     []string
	errMsg      string
	blocked     bool
	skip        bool
	fill        func(*models.AuditLog)
}

type auditInfoKey struct{}

func auditFrom(r *http.Request) *auditInfo {
	info, _ := r.Context().Value(auditInfoKey{}).(*auditInfo)
	return info
}

func auditOutcome(status int) string {
	switch {
	case status < 400:
		return "success"
	case status == http.StatusUnauthorized || status == http.StatusForbidden || status == http.StatusTooManyRequests:
		return "denied"
	default:
		return "failed"
	}
}

func (s *Server) audited(action string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			info := &auditInfo{details: map[string]any{}}
			rec := &statusRecorder{ResponseWriter: w}
			start := time.Now()
			next.ServeHTTP(rec, r.WithContext(context.WithValue(r.Context(), auditInfoKey{}, info)))
			if info.skip {
				return
			}
			status := rec.status
			if status == 0 {
				status = http.StatusOK
			}
			outcome := auditOutcome(status)
			entry := models.AuditLog{
				Action:       action + "." + outcome,
				Outcome:      outcome,
				ResourceType: info.targetType,
				ResourceID:   info.targetID,
				ResourceName: info.targetName,
				StatusCode:   status,
				DurationMs:   time.Since(start).Milliseconds(),
				ErrorMessage: info.errMsg,
				Blocked:      outcome == "denied" || info.blocked,
				User:         info.actor,
				ActorSource:  info.actorSource,
			}
			if len(info.changes) > 0 {
				sort.Strings(info.changes)
				entry.Changes = strings.Join(info.changes, ",")
			}
			if len(info.details) > 0 {
				entry.DetailsJSON = marshalJSON(info.details)
			}
			if info.fill != nil {
				info.fill(&entry)
			}
			s.recordAudit(r, entry)
		})
	}
}

// auditTarget names what the request acts on.
func auditTarget(r *http.Request, targetType, id, name string) {
	if info := auditFrom(r); info != nil {
		info.mu.Lock()
		info.targetType, info.targetID, info.targetName = targetType, id, name
		info.mu.Unlock()
	}
}

func auditDetail(r *http.Request, key string, value any) {
	if info := auditFrom(r); info != nil {
		info.mu.Lock()
		info.details[key] = value
		info.mu.Unlock()
	}
}

// auditDetails merges the fields of v (a map or struct) into the entry's details.
func auditDetails(r *http.Request, v any) {
	for key, value := range jsonFields(v) {
		auditDetail(r, key, value)
	}
}

// auditActor sets the actor for requests made before there is a session (sign-in).
func auditActor(r *http.Request, username, source string) {
	if info := auditFrom(r); info != nil {
		info.mu.Lock()
		info.actor, info.actorSource = username, source
		info.mu.Unlock()
	}
}

// auditFill lets a handler set entry fields the middleware doesn't know (invoke
// sizes and headers).
func auditFill(r *http.Request, fn func(*models.AuditLog)) {
	if info := auditFrom(r); info != nil {
		info.fill = fn
	}
}

func auditBlocked(r *http.Request) {
	if info := auditFrom(r); info != nil {
		info.blocked = true
	}
}

// auditReason records why a request was refused (writeError calls it too).
func auditReason(r *http.Request, reason string) {
	if info := auditFrom(r); info != nil {
		info.mu.Lock()
		if info.errMsg == "" {
			info.errMsg = reason
		}
		info.mu.Unlock()
	}
}

// auditChanges records which fields differ between before and after, by JSON name.
// Only names are stored, so secret values never reach the audit log.
func auditChanges(r *http.Request, before, after any, ignore ...string) {
	info := auditFrom(r)
	if info == nil {
		return
	}
	skip := map[string]bool{}
	for _, name := range ignore {
		skip[name] = true
	}
	a, b := jsonFields(before), jsonFields(after)
	var changed []string
	for key, value := range b {
		if skip[key] {
			continue
		}
		if !reflect.DeepEqual(a[key], value) {
			changed = append(changed, key)
		}
	}
	for key := range a {
		if _, ok := b[key]; !ok && !skip[key] {
			changed = append(changed, key)
		}
	}
	info.mu.Lock()
	info.changes = append(info.changes, changed...)
	info.mu.Unlock()
}

// auditChanged adds field names directly (for changes auditChanges can't see, such
// as a write-only secret).
func auditChanged(r *http.Request, names ...string) {
	if info := auditFrom(r); info != nil {
		info.mu.Lock()
		info.changes = append(info.changes, names...)
		info.mu.Unlock()
	}
}

func jsonFields(v any) map[string]any {
	out := map[string]any{}
	if v == nil {
		return out
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return out
	}
	_ = json.Unmarshal(raw, &out)
	return out
}

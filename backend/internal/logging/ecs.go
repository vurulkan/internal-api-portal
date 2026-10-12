package logging

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"runtime"
	"strings"
	"sync"
	"time"
)

// ECSVersion is written as ecs.version on every JSON line.
const ECSVersion = "8.11.0"

// TimestampLayout is the fixed-width UTC layout of @timestamp (RFC 3339 with
// nanoseconds), so shippers can parse it with one format string.
const TimestampLayout = "2006-01-02T15:04:05.000000000Z"

// Datasets (event.dataset). Elasticsearch shippers route on them, so each can get
// its own data stream, retention and access rights.
const (
	DatasetAudit = "portal.audit" // one line per audit entry (the full record)
	DatasetHTTP  = "portal.http"  // one line per HTTP request
	DatasetApp   = "portal.app"   // everything else: startup, migrations, errors, …
)

// keyAliases maps the short keys used in code to their ECS field. Keys with a dot
// are taken as ECS / dotted paths already; any other key goes under portal.<key>.
var keyAliases = map[string]string{
	"error":      "error.message",
	"stack":      "error.stack_trace",
	"request_id": "http.request.id",
	"user":       "user.name",
	"username":   "user.name",
	"ip":         "source.ip",
}

// ecsHandler writes one JSON object per record in the Elastic Common Schema,
// nested ({"event":{"action":…}}) so log shippers can address fields.
type ecsHandler struct {
	mu        *sync.Mutex
	w         io.Writer
	level     slog.Leveler
	addSource bool
	static    map[string]any
	attrs     []slog.Attr
	groups    []string
}

// NewECSHandler returns the JSON handler. static fields (service.name, …) are
// added to every record.
func NewECSHandler(w io.Writer, level slog.Leveler, addSource bool, static map[string]any) slog.Handler {
	return &ecsHandler{mu: &sync.Mutex{}, w: w, level: level, addSource: addSource, static: static}
}

func (h *ecsHandler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= h.level.Level()
}

func (h *ecsHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	clone := *h
	clone.attrs = append(append([]slog.Attr{}, h.attrs...), prefixed(h.groups, attrs)...)
	return &clone
}

func (h *ecsHandler) WithGroup(name string) slog.Handler {
	clone := *h
	clone.groups = append(append([]string{}, h.groups...), name)
	return &clone
}

func prefixed(groups []string, attrs []slog.Attr) []slog.Attr {
	if len(groups) == 0 {
		return attrs
	}
	out := make([]slog.Attr, 0, len(attrs))
	prefix := strings.Join(groups, ".") + "."
	for _, a := range attrs {
		out = append(out, slog.Attr{Key: prefix + a.Key, Value: a.Value})
	}
	return out
}

func (h *ecsHandler) Handle(ctx context.Context, r slog.Record) error {
	doc := map[string]any{}
	set := func(key string, value any) { setPath(doc, key, value) }

	set("@timestamp", r.Time.UTC().Format(TimestampLayout))
	set("log.level", strings.ToLower(r.Level.String()))
	set("message", r.Message)
	set("ecs.version", ECSVersion)
	for key, value := range h.static {
		set(key, value)
	}
	for _, a := range h.attrs {
		addAttr(set, "", a)
	}
	r.Attrs(func(a slog.Attr) bool {
		addAttr(set, strings.Join(h.groups, "."), a)
		return true
	})
	if h.addSource && r.PC != 0 {
		frames := runtime.CallersFrames([]uintptr{r.PC})
		frame, _ := frames.Next()
		set("log.origin.file.name", frame.File)
		set("log.origin.file.line", frame.Line)
		set("log.origin.function", frame.Function)
	}
	if id := RequestID(ctx); id != "" && getPath(doc, "http.request.id") == nil {
		set("http.request.id", id)
	}
	if getPath(doc, "event.dataset") == nil {
		set("event.dataset", DatasetApp)
	}
	if getPath(doc, "event.dataset") == DatasetApp && getPath(doc, "event.action") == nil {
		// App lines are named events ("db.migration.applied"): make the name a keyword.
		set("event.action", r.Message)
	}
	if getPath(doc, "event.kind") == nil {
		set("event.kind", "event")
	}

	line, err := json.Marshal(doc)
	if err != nil {
		return err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	_, err = h.w.Write(append(line, '\n'))
	return err
}

func addAttr(set func(string, any), group string, a slog.Attr) {
	a.Value = a.Value.Resolve()
	if a.Equal(slog.Attr{}) {
		return
	}
	key := a.Key
	if group != "" {
		key = group + "." + key
	}
	if a.Value.Kind() == slog.KindGroup {
		for _, child := range a.Value.Group() {
			addAttr(set, key, child)
		}
		return
	}
	field := ecsKey(key)
	if IsSensitiveKey(field[strings.LastIndex(field, ".")+1:]) {
		set(field, "[REDACTED]")
		return
	}
	set(field, ecsValue(a.Value))
}

func ecsKey(key string) string {
	if alias, ok := keyAliases[key]; ok {
		return alias
	}
	if strings.Contains(key, ".") || strings.HasPrefix(key, "@") {
		return key
	}
	return "portal." + key
}

func ecsValue(v slog.Value) any {
	switch v.Kind() {
	case slog.KindTime:
		return v.Time().UTC().Format(time.RFC3339Nano)
	case slog.KindDuration:
		// ECS durations (event.duration) are nanoseconds.
		return v.Duration().Nanoseconds()
	case slog.KindAny:
		switch x := v.Any().(type) {
		case error:
			return x.Error()
		case json.RawMessage:
			if len(x) == 0 {
				return nil
			}
			return x
		case fmt.Stringer:
			return x.String()
		default:
			return x
		}
	default:
		return v.Any()
	}
}

// setPath stores value at a dotted path, creating nested objects. If a path runs
// into a non-object (e.g. "user" set as a string, then "user.name"), the value is
// kept under the full dotted key instead of being dropped.
func setPath(doc map[string]any, key string, value any) {
	if strings.HasPrefix(key, "@") {
		doc[key] = value
		return
	}
	parts := strings.Split(key, ".")
	node := doc
	for _, part := range parts[:len(parts)-1] {
		next, ok := node[part]
		if !ok {
			child := map[string]any{}
			node[part] = child
			node = child
			continue
		}
		child, ok := next.(map[string]any)
		if !ok {
			doc[key] = value
			return
		}
		node = child
	}
	node[parts[len(parts)-1]] = value
}

func getPath(doc map[string]any, key string) any {
	parts := strings.Split(key, ".")
	var node any = doc
	for _, part := range parts {
		m, ok := node.(map[string]any)
		if !ok {
			return nil
		}
		node = m[part]
	}
	return node
}

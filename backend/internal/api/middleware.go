package api

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"runtime/debug"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"api-portal/backend/internal/logging"
)

// Middleware order (outermost first): requestContext → requestLogger → recover →
// securityHeaders → router. The logger wraps recover so a panic is logged with its 500.

var validRequestID = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,64}$`)

// requestInfo is filled in by inner layers (requireSession sets the user) and read
// by the request logger after the handler returns.
type requestInfo struct {
	user string
}

type requestInfoKey struct{}

// requestContext assigns the request id (an incoming X-Request-Id is kept when it
// looks safe, so ids from an ingress or caller carry through) and echoes it back.
func requestContext(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-Id")
		if !validRequestID.MatchString(id) {
			id = newRequestID()
		}
		w.Header().Set("X-Request-Id", id)
		ctx := logging.WithRequestID(r.Context(), id)
		ctx = context.WithValue(ctx, requestInfoKey{}, &requestInfo{})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func newRequestID() string {
	raw := make([]byte, 12)
	_, _ = rand.Read(raw)
	return base64.RawURLEncoding.EncodeToString(raw)
}

func setRequestUser(ctx context.Context, username string) {
	if info, ok := ctx.Value(requestInfoKey{}).(*requestInfo); ok {
		info.user = username
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (s *statusRecorder) WriteHeader(code int) {
	if s.status == 0 {
		s.status = code
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	n, err := s.ResponseWriter.Write(b)
	s.bytes += int64(n)
	return n, err
}

// requestLogger writes one http.request line per request and records the HTTP
// metrics. Route labels use the chi pattern ("/api/apis/{id}"), never the raw path,
// so metric cardinality stays bounded. Probe and metrics scrapes log at debug.
func (s *Server) requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(rec, r)
		if rec.status == 0 {
			rec.status = http.StatusOK
		}
		elapsed := time.Since(start)
		route := routeLabel(r)
		s.metrics.HTTPRequests.Inc(route, r.Method, strconv.Itoa(rec.status))
		s.metrics.HTTPDuration.Observe(elapsed.Seconds(), route, r.Method)

		level := slog.LevelInfo
		switch {
		case rec.status >= 500:
			level = slog.LevelError
		case rec.status >= 400:
			level = slog.LevelWarn
		case isProbe(r.URL.Path):
			level = slog.LevelDebug
		}
		user := ""
		if info, ok := r.Context().Value(requestInfoKey{}).(*requestInfo); ok {
			user = info.user
		}
		slog.Log(r.Context(), level, "http.request",
			"method", r.Method,
			"route", route,
			"path", r.URL.Path,
			"status", rec.status,
			"duration_ms", elapsed.Milliseconds(),
			"bytes", rec.bytes,
			"ip", s.clientIP(r),
			"user", user,
			"request_id", logging.RequestID(r.Context()),
		)
	})
}

func routeLabel(r *http.Request) string {
	if rctx := chi.RouteContext(r.Context()); rctx != nil {
		if pattern := rctx.RoutePattern(); pattern != "" && pattern != "/*" {
			return pattern
		}
	}
	if strings.HasPrefix(r.URL.Path, "/api/") {
		return "unmatched"
	}
	return "static"
}

func isProbe(path string) bool {
	return path == "/livez" || path == "/readyz" || path == "/healthz" || path == "/metrics"
}

func recoverMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				slog.ErrorContext(r.Context(), "http.panic",
					"error", fmt.Sprint(v),
					"path", r.URL.Path,
					"request_id", logging.RequestID(r.Context()),
					"stack", string(debug.Stack()),
				)
				writeError(w, r, http.StatusInternalServerError, "internal server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

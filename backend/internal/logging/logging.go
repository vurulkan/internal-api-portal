// Package logging configures the process-wide slog logger and carries the request
// id through contexts, so HTTP logs, audit entries and error responses can be
// correlated.
package logging

import (
	"context"
	"io"
	"log"
	"log/slog"
	"os"
	"strings"
)

// Options configures the process logger (LOG_* environment variables).
type Options struct {
	Format      string // json (ECS, default) or text (human, development)
	Level       string // debug, info (default), warn, error
	Output      string // stdout (default) or stderr
	AddSource   bool   // log.origin.* (file, line, function)
	Service     string // service.name
	Version     string // service.version
	Environment string // service.environment (dev / test / prod …), optional
}

// Setup installs the logger as slog's default and routes the standard library log
// package through it.
func Setup(opts Options) *slog.Logger {
	w := io.Writer(os.Stdout)
	if strings.EqualFold(opts.Output, "stderr") {
		w = os.Stderr
	}
	return SetupWriter(w, opts)
}

func SetupWriter(w io.Writer, opts Options) *slog.Logger {
	level := parseLevel(opts.Level)
	var handler slog.Handler
	if strings.EqualFold(opts.Format, "text") {
		handler = slog.NewTextHandler(w, &slog.HandlerOptions{Level: level, AddSource: opts.AddSource, ReplaceAttr: func(_ []string, a slog.Attr) slog.Attr {
			if IsSensitiveKey(a.Key[strings.LastIndex(a.Key, ".")+1:]) {
				return slog.String(a.Key, "[REDACTED]")
			}
			return a
		}})
		attrs := []slog.Attr{slog.String("service", opts.Service), slog.String("version", opts.Version)}
		if opts.Environment != "" {
			attrs = append(attrs, slog.String("env", opts.Environment))
		}
		handler = handler.WithAttrs(attrs)
	} else {
		static := map[string]any{"service.name": opts.Service, "service.version": opts.Version, "service.type": "api-portal"}
		if opts.Environment != "" {
			static["service.environment"] = opts.Environment
		}
		handler = NewECSHandler(w, level, opts.AddSource, static)
	}
	logger := slog.New(handler)
	slog.SetDefault(logger)
	log.SetFlags(0)
	log.SetOutput(slogWriter{logger})
	return logger
}

// sensitiveKeys are never logged with their value (compared case-insensitively,
// ignoring "-" and "_").
var sensitiveKeys = map[string]bool{
	"password": true, "newpassword": true, "currentpassword": true, "temporarypassword": true,
	"bindpassword": true, "clientsecret": true, "secret": true, "token": true, "accesstoken": true,
	"idtoken": true, "authorization": true, "cookie": true, "setcookie": true, "apikey": true,
	"xapikey": true, "session": true, "sessiontoken": true, "privatekey": true, "dataencryptionkey": true,
}

// IsSensitiveKey reports whether a field of this name must not be logged verbatim.
func IsSensitiveKey(key string) bool {
	normalized := strings.NewReplacer("-", "", "_", "", ".", "").Replace(strings.ToLower(key))
	return sensitiveKeys[normalized]
}

// Redact returns a copy of m with the values of sensitive keys replaced, recursing
// into nested maps. Call it on any free-form map before logging it.
func Redact(m map[string]any) map[string]any {
	if m == nil {
		return nil
	}
	out := make(map[string]any, len(m))
	for key, value := range m {
		switch {
		case IsSensitiveKey(key):
			out[key] = "[REDACTED]"
		default:
			if nested, ok := value.(map[string]any); ok {
				out[key] = Redact(nested)
			} else {
				out[key] = value
			}
		}
	}
	return out
}

func parseLevel(raw string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// slogWriter turns stray log.Printf calls (from dependencies) into info lines.
type slogWriter struct{ logger *slog.Logger }

func (w slogWriter) Write(p []byte) (int, error) {
	w.logger.Info(strings.TrimRight(string(p), "\n"))
	return len(p), nil
}

type requestIDKey struct{}

func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey{}, id)
}

// RequestID returns the request id stored on the context, or "".
func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey{}).(string)
	return id
}

// Detach returns a background context that keeps the request id, for work that
// outlives the request (it must not be cancelled with it).
func Detach(ctx context.Context) context.Context {
	return WithRequestID(context.Background(), RequestID(ctx))
}

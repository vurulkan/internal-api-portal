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

// Setup installs a JSON (default) or text logger as slog's default and routes the
// standard library log package through it. Static attributes are added to every line.
func Setup(format, level, service, version string) *slog.Logger {
	return SetupWriter(os.Stdout, format, level, service, version)
}

func SetupWriter(w io.Writer, format, level, service, version string) *slog.Logger {
	opts := &slog.HandlerOptions{Level: parseLevel(level)}
	var handler slog.Handler
	if strings.EqualFold(format, "text") {
		handler = slog.NewTextHandler(w, opts)
	} else {
		handler = slog.NewJSONHandler(w, opts)
	}
	logger := slog.New(handler).With("service", service, "version", version)
	slog.SetDefault(logger)
	log.SetFlags(0)
	log.SetOutput(slogWriter{logger})
	return logger
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

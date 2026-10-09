package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"api-portal/backend/internal/api"
	"api-portal/backend/internal/audit"
	"api-portal/backend/internal/auth"
	"api-portal/backend/internal/config"
	"api-portal/backend/internal/db"
	"api-portal/backend/internal/logging"
	"api-portal/backend/internal/store"
)

// version is set at build time: -ldflags "-X main.version=1.2.0".
var version = "dev"

func main() {
	cfg := config.Load()
	logging.Setup(cfg.LogFormat, cfg.LogLevel, "internal-api-portal", version)

	database, err := db.Open(cfg.DataPath)
	if err != nil {
		fatal("db.open", err)
	}

	dataStore, err := store.New(database.Conn)
	if err != nil {
		fatal("store.init", err)
	}

	adminHash, err := auth.HashPassword("admin")
	if err != nil {
		fatal("admin.hash", err)
	}
	if err := dataStore.EnsureDefaultAdmin(context.Background(), adminHash, cfg.SessionMinutes); err != nil {
		fatal("admin.seed", err)
	}

	if removed, err := dataStore.ClearSVGLogo(context.Background()); err != nil {
		slog.Warn("branding.svg_cleanup_failed", "error", err.Error())
	} else if removed {
		slog.Warn("branding.svg_logo_removed", "reason", "SVG logos are no longer accepted (they can carry script); upload a PNG, JPEG or WEBP")
	}

	auditLogger := audit.New(dataStore)
	auditLogger.StartRetention(context.Background(), cfg.LogRetentionDays, cfg.AuditPurgeInterval)

	server := api.NewServer(dataStore, auditLogger, cfg)
	httpServer := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           server.Router(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	var metricsServer *http.Server
	if cfg.MetricsEnabled && cfg.MetricsAddr != "" {
		mux := http.NewServeMux()
		mux.Handle("/metrics", server.MetricsHandler())
		metricsServer = &http.Server{Addr: cfg.MetricsAddr, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
		go func() {
			slog.Info("metrics.listening", "addr", cfg.MetricsAddr)
			if err := metricsServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				fatal("metrics.listen", err)
			}
		}()
	}

	go func() {
		slog.Info("http.listening", "addr", httpServer.Addr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fatal("http.listen", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	sig := <-stop
	slog.Info("shutdown.start", "signal", sig.String())

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		slog.Error("shutdown.failed", "error", err.Error())
	}
	if metricsServer != nil {
		_ = metricsServer.Shutdown(ctx)
	}
	if err := database.Conn.Close(); err != nil {
		slog.Error("db.close_failed", "error", err.Error())
	}
	slog.Info("shutdown.done")
}

func fatal(event string, err error) {
	slog.Error(event, "error", err.Error())
	os.Exit(1)
}

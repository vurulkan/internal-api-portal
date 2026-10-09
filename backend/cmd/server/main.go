package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	// Embedded zone database, so TIMEZONE works on images without /usr/share/zoneinfo.
	_ "time/tzdata"

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

	// Subcommands for the distroless image, which has no shell or curl:
	//   server healthcheck   exit 0 when /livez answers (Docker HEALTHCHECK)
	//   server backup        write a consistent copy of the database to BACKUP_DIR
	//   server version
	if len(os.Args) > 1 {
		// Logs go to stderr so stdout carries only the command's result.
		logging.SetupWriter(os.Stderr, cfg.LogFormat, cfg.LogLevel, "internal-api-portal", version)
		switch os.Args[1] {
		case "healthcheck":
			os.Exit(healthcheck(cfg.Port))
		case "backup":
			os.Exit(backupOnce(cfg))
		case "version":
			fmt.Println(version)
			return
		default:
			fmt.Fprintf(os.Stderr, "unknown command %q (healthcheck, backup, version)\n", os.Args[1])
			os.Exit(2)
		}
	}
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
	db.StartBackups(context.Background(), database.Conn, cfg.BackupDirFor(), cfg.BackupInterval, cfg.BackupKeep)
	if cfg.BackupInterval > 0 {
		slog.Info("db.backups_scheduled", "dir", cfg.BackupDirFor(), "interval", cfg.BackupInterval.String(), "keep", cfg.BackupKeep)
	}

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

func healthcheck(port string) int {
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/livez")
	if err != nil {
		fmt.Fprintln(os.Stderr, "healthcheck:", err)
		return 1
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "healthcheck: status", resp.StatusCode)
		return 1
	}
	return 0
}

// backupOnce opens the database (running pending migrations, like the server would)
// and writes one backup. Safe while the server runs: SQLite WAL allows a second
// connection, and VACUUM INTO reads a consistent snapshot.
func backupOnce(cfg config.Config) int {
	database, err := db.Open(cfg.DataPath)
	if err != nil {
		slog.Error("backup.open", "error", err.Error())
		return 1
	}
	defer database.Conn.Close()
	path, err := db.Backup(context.Background(), database.Conn, cfg.BackupDirFor(), cfg.BackupKeep)
	if err != nil {
		slog.Error("backup.failed", "error", err.Error())
		return 1
	}
	fmt.Println(path)
	return 0
}

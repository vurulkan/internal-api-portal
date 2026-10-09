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
	"api-portal/backend/internal/password"
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

	keys, err := loadKeys(cfg)
	if err != nil {
		fatal("crypto.config", err)
	}
	dataStore, err := store.New(database.Conn, keys)
	if err != nil {
		fatal("store.init", err)
	}
	secureSecretsAtRest(dataStore)
	bootstrapAdmin(cfg, dataStore)

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
	server.StartSessionPurge(context.Background())
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

// loadKeys parses DATA_ENCRYPTION_KEY(_PREVIOUS). A malformed key stops startup:
// running on with the database key would silently undo the operator's intent.
func loadKeys(cfg config.Config) (store.Keys, error) {
	current, err := store.ParseKey(cfg.DataEncryptionKey)
	if err != nil {
		return store.Keys{}, fmt.Errorf("DATA_ENCRYPTION_KEY: %w", err)
	}
	previous, err := store.ParseKey(cfg.DataEncryptionKeyPrev)
	if err != nil {
		return store.Keys{}, fmt.Errorf("DATA_ENCRYPTION_KEY_PREVIOUS: %w", err)
	}
	return store.Keys{Current: current, Previous: [][]byte{previous}}, nil
}

// secureSecretsAtRest re-encrypts stored secrets with the current key and reports
// where the key lives. A value that can't be decrypted (its key was removed) is
// logged, not fatal: the LDAP / Azure AD secret can be entered again in the UI.
func secureSecretsAtRest(dataStore *store.Store) {
	result, err := dataStore.Rekey(context.Background())
	switch {
	case err != nil:
		slog.Error("crypto.rekey_failed", "error", err.Error(), "hint", "set DATA_ENCRYPTION_KEY_PREVIOUS to the old key, or re-enter the LDAP bind password / Azure AD client secret")
	case result.Reencrypted > 0 || result.LegacyKeyRemoved:
		slog.Info("crypto.rekey", "reencrypted", result.Reencrypted, "database_key_removed", result.LegacyKeyRemoved, "key_id", dataStore.CurrentKeyID())
	}
	if dataStore.KeyInDatabase() {
		slog.Warn("crypto.key_in_database", "hint", "the encryption key for stored LDAP / Azure AD secrets is kept in the database; set DATA_ENCRYPTION_KEY (or _FILE) from a secret store")
	}
}

// bootstrapAdmin creates the first administrator on an empty database. Without
// BOOTSTRAP_ADMIN_PASSWORD a random password is generated and logged once; either
// way it must be changed at first sign-in.
func bootstrapAdmin(cfg config.Config, dataStore *store.Store) {
	ctx := context.Background()
	if n, err := dataStore.CountUsers(ctx); err != nil {
		fatal("bootstrap.count_users", err)
	} else if n > 0 {
		return
	}
	pw, generated := cfg.BootstrapAdminPassword, false
	if pw == "" {
		var err error
		if pw, err = password.Generate(20); err != nil {
			fatal("bootstrap.generate_password", err)
		}
		generated = true
	}
	hash, err := auth.HashPassword(pw)
	if err != nil {
		fatal("bootstrap.hash", err)
	}
	created, err := dataStore.EnsureBootstrapAdmin(ctx, cfg.BootstrapAdminUsername, hash, cfg.SessionMinutes)
	if err != nil {
		fatal("bootstrap.create_admin", err)
	}
	if !created {
		return
	}
	if generated {
		slog.Warn("bootstrap.admin_created", "username", cfg.BootstrapAdminUsername, "password", pw,
			"note", "generated because BOOTSTRAP_ADMIN_PASSWORD is not set; shown only now, must be changed at first sign-in")
	} else {
		slog.Info("bootstrap.admin_created", "username", cfg.BootstrapAdminUsername, "password_source", "BOOTSTRAP_ADMIN_PASSWORD", "note", "must be changed at first sign-in")
	}
}

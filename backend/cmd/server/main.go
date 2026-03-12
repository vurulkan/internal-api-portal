package main

import (
	"context"
	"log"
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
	"api-portal/backend/internal/store"
)

func main() {
	cfg := config.Load()

	database, err := db.Open(cfg.DataPath)
	if err != nil {
		log.Fatalf("db open failed: %v", err)
	}

	dataStore, err := store.New(database.Conn)
	if err != nil {
		log.Fatalf("store init failed: %v", err)
	}

	adminHash, err := auth.HashPassword("admin")
	if err != nil {
		log.Fatalf("admin hash failed: %v", err)
	}
	if err := dataStore.EnsureDefaultAdmin(context.Background(), adminHash, cfg.SessionMinutes); err != nil {
		log.Fatalf("default admin seed failed: %v", err)
	}

	auditLogger := audit.New(dataStore)
	auditLogger.StartRetention(context.Background(), cfg.LogRetentionDays, cfg.AuditPurgeInterval)

	server := api.NewServer(dataStore, auditLogger, cfg)
	httpServer := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      server.Router(),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("listening on %s", httpServer.Addr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server failed: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		log.Printf("shutdown failed: %v", err)
	}
}

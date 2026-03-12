package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port               string
	DataPath           string
	StaticDir          string
	TimeZone           string
	LogRetentionDays   int
	SessionMinutes     int
	AuditPurgeInterval time.Duration
	ProxyTimeout       time.Duration
	MaxRequestBytes    int64
	MaxResponseBytes   int64
}

func Load() Config {
	return Config{
		Port:               env("PORT", "8080"),
		DataPath:           env("DATA_PATH", "/data/app.db"),
		StaticDir:          env("STATIC_DIR", "/app/public"),
		TimeZone:           env("TIMEZONE", "UTC"),
		LogRetentionDays:   envInt("LOG_RETENTION_DAYS", 30),
		SessionMinutes:     envInt("SESSION_MINUTES", 60),
		AuditPurgeInterval: time.Hour,
		ProxyTimeout:       time.Duration(envInt("PROXY_TIMEOUT_SECONDS", 30)) * time.Second,
		MaxRequestBytes:    int64(envInt("MAX_REQUEST_BYTES", 1024*1024)),
		MaxResponseBytes:   int64(envInt("MAX_RESPONSE_BYTES", 5*1024*1024)),
	}
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}

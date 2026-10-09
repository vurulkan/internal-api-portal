package config

import (
	"log"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
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

	// TrustedProxies lists the networks whose X-Forwarded-For / X-Forwarded-Proto
	// headers are believed. Empty means the headers are ignored and RemoteAddr is used,
	// so a client can't spoof its audit IP or dodge the login lockout.
	TrustedProxies []*net.IPNet
	// CookieSecure is "auto" (Secure when the request arrived over TLS, directly or via
	// a trusted proxy), "true" or "false".
	CookieSecure string
	// ProxyDenyCIDRs are extra networks the try-it proxy and spec fetcher may never dial.
	ProxyDenyCIDRs []*net.IPNet
	// ProxyAllowLoopback lets upstreams on 127.0.0.0/8 and ::1 through (local development).
	ProxyAllowLoopback bool

	LogFormat string // json (default) or text
	LogLevel  string // debug, info (default), warn, error
	// MetricsEnabled serves Prometheus metrics. With MetricsAddr set they are served on
	// that separate listener instead of the main port.
	MetricsEnabled bool
	MetricsAddr    string
	// HSTSEnabled adds Strict-Transport-Security; turn on only when the portal is
	// reached exclusively over HTTPS.
	HSTSEnabled bool

	// Scheduled database backups (VACUUM INTO). BackupInterval 0 disables them; the
	// `server backup` command works regardless.
	BackupDir      string
	BackupInterval time.Duration
	BackupKeep     int

	// DataEncryptionKey encrypts secrets at rest (base64 or hex, 32 bytes). Empty:
	// legacy mode, the key is kept in the database. Previous keys stay readable
	// during a rotation.
	DataEncryptionKey     string
	DataEncryptionKeyPrev string

	// First start only (no users yet): the administrator account to create. Without
	// a password a random one is generated and logged once.
	BootstrapAdminUsername string
	BootstrapAdminPassword string

	PasswordMinLength int
}

func Load() Config {
	return Config{
		Port:               env("PORT", "8080"),
		DataPath:           env("DATA_PATH", "/data/app.db"),
		StaticDir:          env("STATIC_DIR", "/app/public"),
		TimeZone:           env("TIMEZONE", "UTC"),
		LogRetentionDays:   envInt("LOG_RETENTION_DAYS", 30),
		SessionMinutes:     envInt("SESSION_MINUTES", 60),
		AuditPurgeInterval: envDuration("AUDIT_PURGE_INTERVAL", time.Hour),
		ProxyTimeout:       time.Duration(envInt("PROXY_TIMEOUT_SECONDS", 30)) * time.Second,
		MaxRequestBytes:    int64(envInt("MAX_REQUEST_BYTES", 1024*1024)),
		MaxResponseBytes:   int64(envInt("MAX_RESPONSE_BYTES", 5*1024*1024)),
		TrustedProxies:     envCIDRs("TRUSTED_PROXIES"),
		CookieSecure:       strings.ToLower(env("COOKIE_SECURE", "auto")),
		ProxyDenyCIDRs:     envCIDRs("PROXY_DENY_CIDRS"),
		ProxyAllowLoopback: envBool("PROXY_ALLOW_LOOPBACK", false),
		BackupDir:          os.Getenv("BACKUP_DIR"),
		LogFormat:          env("LOG_FORMAT", "json"),
		LogLevel:           env("LOG_LEVEL", "info"),
		MetricsEnabled:     envBool("METRICS_ENABLED", true),
		MetricsAddr:        env("METRICS_ADDR", ""),
		HSTSEnabled:        envBool("HSTS_ENABLED", false),
		BackupInterval:     envDurationOrOff("BACKUP_INTERVAL"),
		BackupKeep:         envInt("BACKUP_KEEP", 7),

		DataEncryptionKey:      envSecret("DATA_ENCRYPTION_KEY"),
		DataEncryptionKeyPrev:  envSecret("DATA_ENCRYPTION_KEY_PREVIOUS"),
		BootstrapAdminUsername: env("BOOTSTRAP_ADMIN_USERNAME", "admin"),
		BootstrapAdminPassword: envSecret("BOOTSTRAP_ADMIN_PASSWORD"),
		PasswordMinLength:      envInt("PASSWORD_MIN_LENGTH", 12),
	}
}

// envSecret reads KEY, or the contents of the file named by KEY_FILE (a mounted
// Kubernetes Secret). A configured file that doesn't exist counts as unset (an
// optional Secret that wasn't created) and is logged.
func envSecret(key string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	path := os.Getenv(key + "_FILE")
	if path == "" {
		return ""
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("config: reading %s_FILE %s: %v", key, path, err)
		}
		return ""
	}
	return strings.TrimSpace(string(data))
}

// BackupDirFor returns BACKUP_DIR, defaulting to "backups" next to the database.
func (c Config) BackupDirFor() string {
	if c.BackupDir != "" {
		return c.BackupDir
	}
	return filepath.Join(filepath.Dir(c.DataPath), "backups")
}

// envDurationOrOff reads a duration where empty or "0" means disabled.
func envDurationOrOff(key string) time.Duration {
	raw := os.Getenv(key)
	if raw == "" || raw == "0" {
		return 0
	}
	return envDuration(key, 0)
}

// envDuration reads a Go duration ("90m", "6h"); values below a minute fall back.
func envDuration(key string, fallback time.Duration) time.Duration {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	value, err := time.ParseDuration(raw)
	if err != nil || value < time.Minute {
		log.Printf("config: ignoring invalid %s %q", key, raw)
		return fallback
	}
	return value
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

func envBool(key string, fallback bool) bool {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	value, err := strconv.ParseBool(raw)
	if err != nil {
		return fallback
	}
	return value
}

// envCIDRs parses a comma-separated list of CIDRs or bare IPs. Invalid entries are
// logged and skipped rather than failing startup.
func envCIDRs(key string) []*net.IPNet {
	return ParseCIDRs(os.Getenv(key), func(entry string) {
		log.Printf("config: ignoring invalid %s entry %q", key, entry)
	})
}

func ParseCIDRs(raw string, onInvalid func(string)) []*net.IPNet {
	var out []*net.IPNet
	for _, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		if !strings.Contains(entry, "/") {
			if ip := net.ParseIP(entry); ip != nil {
				bits := 32
				if ip.To4() == nil {
					bits = 128
				}
				entry = entry + "/" + strconv.Itoa(bits)
			}
		}
		_, network, err := net.ParseCIDR(entry)
		if err != nil {
			if onInvalid != nil {
				onInvalid(entry)
			}
			continue
		}
		out = append(out, network)
	}
	return out
}

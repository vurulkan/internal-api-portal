package config

import (
	"log"
	"net"
	"os"
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
		TrustedProxies:     envCIDRs("TRUSTED_PROXIES"),
		CookieSecure:       strings.ToLower(env("COOKIE_SECURE", "auto")),
		ProxyDenyCIDRs:     envCIDRs("PROXY_DENY_CIDRS"),
		ProxyAllowLoopback: envBool("PROXY_ALLOW_LOOPBACK", false),
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

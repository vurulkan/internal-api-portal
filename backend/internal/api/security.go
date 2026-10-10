package api

import (
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"api-portal/backend/internal/models"
	"api-portal/backend/internal/rbac"
)

// ─── Client address ───────────────────────────────────────────────────────────

// clientIP returns the caller's address. X-Forwarded-For is only believed when the
// direct peer is a trusted proxy (TRUSTED_PROXIES); the right-most untrusted hop is
// the client, so entries a client prepends itself are ignored.
func (s *Server) clientIP(r *http.Request) string {
	peer := remoteHost(r)
	if !s.trustedPeer(peer) {
		return peer
	}
	forwarded := r.Header.Get("X-Forwarded-For")
	if forwarded == "" {
		return peer
	}
	hops := strings.Split(forwarded, ",")
	for i := len(hops) - 1; i >= 0; i-- {
		hop := strings.TrimSpace(hops[i])
		if net.ParseIP(hop) == nil {
			continue
		}
		if !s.trustedPeer(hop) {
			return hop
		}
	}
	return peer
}

func (s *Server) trustedPeer(ip string) bool {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}
	for _, network := range s.config.TrustedProxies {
		if network.Contains(parsed) {
			return true
		}
	}
	return false
}

func remoteHost(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// secureRequest decides the Secure flag of cookies we set.
func (s *Server) secureRequest(r *http.Request) bool {
	switch s.config.CookieSecure {
	case "true", "1", "yes":
		return true
	case "false", "0", "no":
		return false
	}
	if r.TLS != nil {
		return true
	}
	return s.trustedPeer(remoteHost(r)) && strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

// ─── Headers ─────────────────────────────────────────────────────────────────

// contentSecurityPolicy applies to every response. Notes on the exceptions:
//   - style-src 'unsafe-inline': Swagger UI and React set inline style attributes.
//   - fonts.googleapis.com / fonts.gstatic.com: the Inter web font; removed when the
//     fonts are self-hosted (M6).
//   - img-src data:: the brand logo is stored as a data URL.
//
// Scripts are 'self' only: no inline script anywhere (the Azure AD callback sets the
// session cookie and redirects; it no longer renders a page).
const contentSecurityPolicy = "default-src 'self'; " +
	"base-uri 'self'; " +
	"object-src 'none'; " +
	"frame-ancestors 'none'; " +
	"form-action 'self'; " +
	"script-src 'self'; " +
	"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
	"font-src 'self' data: https://fonts.gstatic.com; " +
	"img-src 'self' data: blob:; " +
	"connect-src 'self'; " +
	"worker-src 'self' blob:"

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		if s.config.HSTSEnabled {
			h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h.Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

// ─── Login brute-force gate ──────────────────────────────────────────────────

const (
	loginMaxFailures = 5
	loginLockout     = 5 * time.Minute
	loginWindow      = 15 * time.Minute
)

type loginAttempt struct {
	failures    int
	firstFailed time.Time
	lockedUntil time.Time
}

// loginGate locks an IP + username pair for loginLockout after loginMaxFailures
// failed logins within loginWindow. In-memory, so it assumes a single replica (which
// SQLite already requires).
type loginGate struct {
	mu       sync.Mutex
	attempts map[string]*loginAttempt
	now      func() time.Time
}

func newLoginGate() *loginGate {
	return &loginGate{attempts: map[string]*loginAttempt{}, now: time.Now}
}

func loginKey(ip, username string) string {
	return ip + "|" + strings.ToLower(strings.TrimSpace(username))
}

// locked returns how long the key stays locked (0 when it isn't).
func (g *loginGate) locked(key string) time.Duration {
	g.mu.Lock()
	defer g.mu.Unlock()
	if attempt, ok := g.attempts[key]; ok {
		if wait := attempt.lockedUntil.Sub(g.now()); wait > 0 {
			return wait
		}
	}
	return 0
}

// fail records a failure and reports whether this one triggered the lock.
func (g *loginGate) fail(key string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	g.prune(now)
	attempt, ok := g.attempts[key]
	if !ok || now.Sub(attempt.firstFailed) > loginWindow {
		attempt = &loginAttempt{firstFailed: now}
		g.attempts[key] = attempt
	}
	attempt.failures++
	if attempt.failures >= loginMaxFailures {
		attempt.lockedUntil = now.Add(loginLockout)
		attempt.failures = 0
		attempt.firstFailed = now
		return true
	}
	return false
}

func (g *loginGate) succeed(key string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.attempts, key)
}

// prune drops stale entries so a stream of random usernames can't grow the map forever.
func (g *loginGate) prune(now time.Time) {
	if len(g.attempts) < 1024 {
		return
	}
	for key, attempt := range g.attempts {
		if now.After(attempt.lockedUntil) && now.Sub(attempt.firstFailed) > loginWindow {
			delete(g.attempts, key)
		}
	}
}

func retryAfterSeconds(wait time.Duration) string {
	seconds := int(wait.Seconds())
	if seconds < 1 {
		seconds = 1
	}
	return strconv.Itoa(seconds)
}

// ─── Identity ────────────────────────────────────────────────────────────────

type identityKey struct{}

// identityForRequest returns the identity requireSession stored on the request.
func (s *Server) identityForRequest(r *http.Request) (*models.Identity, bool) {
	identity, ok := r.Context().Value(identityKey{}).(*models.Identity)
	return identity, ok && identity != nil
}

func (s *Server) requirePermission(permission string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			identity, ok := s.identityForRequest(r)
			if !ok {
				writeError(w, r, http.StatusUnauthorized, "unauthorized")
				return
			}
			if !rbac.New(identity.User.IsAdmin, identity.Permissions).Has(permission) {
				writeError(w, r, http.StatusForbidden, "forbidden")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// requireAPIManagement admits users who manage at least one API (globally or per
// API); handlers check the specific API.
func (s *Server) requireAPIManagement(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		identity, _ := s.identityForRequest(r)
		engine := rbac.New(identity.User.IsAdmin, identity.Permissions)
		if !engine.ManagesAllAPIs() && !engine.Has("api.create") && len(engine.ManagedAPIs()) == 0 {
			writeError(w, r, http.StatusForbidden, "forbidden: you don't manage any API")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// requireAnyAdminSection admits users who may open at least one admin section.
func (s *Server) requireAnyAdminSection(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		identity, _ := s.identityForRequest(r)
		if len(s.capabilitiesFor(rbac.New(identity.User.IsAdmin, identity.Permissions)).AdminSections) == 0 {
			writeError(w, r, http.StatusForbidden, "forbidden")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// requireFeature refuses requests to a capability switched off with FEATURE_*.
func (s *Server) requireFeature(name string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !s.featureEnabled(name) {
				writeError(w, r, http.StatusForbidden, "this feature is turned off on this portal ("+name+")")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (s *Server) featureEnabled(name string) bool {
	f := s.config.Features
	switch name {
	case "tryIt":
		return f.TryIt
	case "ldap":
		return f.LDAP
	case "azureAd":
		return f.AzureAD
	case "auditExport":
		return f.AuditExport
	}
	return false
}

// ─── Privilege escalation guards ─────────────────────────────────────────────

// scopesBeyondActor returns the scopes in want that the actor doesn't hold. Admins
// hold everything. A delegated manager may hand out only what they have themselves.
func scopesBeyondActor(actor *models.Identity, want []string) []string {
	if actor.User.IsAdmin {
		return nil
	}
	engine := rbac.New(false, actor.Permissions)
	var missing []string
	for _, scope := range want {
		if !engine.Has(scope) {
			missing = append(missing, scope)
		}
	}
	return missing
}

// denyAudit records why a request is refused. On audited routes the reason goes on
// the request's own entry (which the 403 makes "<action>.denied"); elsewhere it
// writes an authz.denied entry.
func (s *Server) denyAudit(r *http.Request, reason, details string) {
	if auditFrom(r) != nil {
		auditReason(r, reason)
		if details != "" {
			auditDetail(r, "refused", json.RawMessage(details))
		}
		return
	}
	s.recordAudit(r, models.AuditLog{
		Action:       "authz.denied",
		ResourceType: "authz",
		ResourceName: r.Method + " " + r.URL.Path,
		ErrorMessage: reason,
		DetailsJSON:  details,
		Blocked:      true,
		StatusCode:   http.StatusForbidden,
		Outcome:      "denied",
	})
}

// ─── Audit / export hygiene ──────────────────────────────────────────────────

// auditUsername bounds what an unauthenticated caller can write into the audit log.
func auditUsername(raw string) string {
	cleaned := strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, strings.TrimSpace(raw))
	if len([]rune(cleaned)) > 64 {
		cleaned = string([]rune(cleaned)[:64])
	}
	return cleaned
}

// csvCell neutralises spreadsheet formulas (CSV injection): cells starting with
// = + - @ TAB or CR are prefixed with a single quote.
func csvCell(value string) string {
	if value == "" {
		return value
	}
	switch value[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + value
	}
	return value
}

func clampInt(value, low, high int) int {
	if value < low {
		return low
	}
	if value > high {
		return high
	}
	return value
}

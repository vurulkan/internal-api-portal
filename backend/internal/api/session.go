package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"api-portal/backend/internal/models"
)

// Sessions are opaque random tokens in an HttpOnly cookie; the database keeps only
// their SHA-256, so neither script in the page nor a copy of the database yields a
// usable token. Every request looks the session up, which makes sign-out,
// revocation and deactivation take effect immediately.
//
// The cookie is SameSite=Strict and every state-changing API request must carry the
// X-CSRF-Protection header (see csrfProtect): a cross-site page can neither send
// the cookie along nor set a custom header without a CORS preflight, which the
// portal never answers.

const (
	// The __Host- prefix makes browsers insist on Secure, Path=/ and no Domain. It
	// can only be used over HTTPS, so plain-HTTP installations get the plain name.
	sessionCookieSecure = "__Host-portal_session"
	sessionCookiePlain  = "portal_session"
	csrfHeader          = "X-CSRF-Protection"
	// last_used_at is written at most this often per session.
	sessionTouchInterval = time.Minute
)

type sessionKey struct{}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// sessionTimeouts returns the idle timeout (Admin → Session, seeded from
// SESSION_MINUTES) and the absolute maximum age.
func (s *Server) sessionTimeouts(ctx context.Context) (idle, max time.Duration) {
	idle = time.Duration(s.config.SessionMinutes) * time.Minute
	max = 12 * time.Hour
	if settings, err := s.store.GetSessionSettings(ctx); err == nil {
		if settings.SessionMinutes > 0 {
			idle = time.Duration(settings.SessionMinutes) * time.Minute
		}
		if settings.MaxHours > 0 {
			max = time.Duration(settings.MaxHours) * time.Hour
		}
	}
	if idle <= 0 {
		idle = time.Hour
	}
	return idle, max
}

// startSession creates a session for user and sets the cookie.
func (s *Server) startSession(w http.ResponseWriter, r *http.Request, user *models.User) error {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	now := time.Now().UTC()
	_, max := s.sessionTimeouts(r.Context())
	session := models.Session{
		UserID:     user.ID,
		AuthSource: user.AuthSource,
		CreatedAt:  now,
		LastUsedAt: now,
		ExpiresAt:  now.Add(max),
		IP:         s.clientIP(r),
		UserAgent:  truncate(r.UserAgent(), 256),
	}
	if _, err := s.store.CreateSession(r.Context(), hashToken(token), session); err != nil {
		return err
	}
	s.clearSessionCookies(w, r)
	secure := s.secureRequest(r)
	name := sessionCookiePlain
	if secure {
		name = sessionCookieSecure
	}
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
		Expires:  session.ExpiresAt,
	})
	return nil
}

// clearSessionCookies removes both cookie variants (an installation may have moved
// between HTTP and HTTPS).
func (s *Server) clearSessionCookies(w http.ResponseWriter, r *http.Request) {
	for _, name := range []string{sessionCookieSecure, sessionCookiePlain} {
		if _, err := r.Cookie(name); err != nil {
			continue
		}
		http.SetCookie(w, &http.Cookie{
			Name:     name,
			Value:    "",
			Path:     "/",
			HttpOnly: true,
			Secure:   name == sessionCookieSecure,
			SameSite: http.SameSiteStrictMode,
			MaxAge:   -1,
		})
	}
}

func sessionToken(r *http.Request) string {
	for _, name := range []string{sessionCookieSecure, sessionCookiePlain} {
		if c, err := r.Cookie(name); err == nil && c.Value != "" {
			return c.Value
		}
	}
	return ""
}

// requireSession authenticates the request from its session cookie and loads the
// user once. It rejects unknown, revoked, idle and expired sessions, deleted and
// deactivated accounts, and keeps local users who must change their password away
// from everything but /me, change-password and logout. A database error fails
// closed (503): an unverifiable session is not a valid one.
func (s *Server) requireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := sessionToken(r)
		if token == "" {
			writeError(w, r, http.StatusUnauthorized, "sign in required")
			return
		}
		session, err := s.store.GetSessionByHash(r.Context(), hashToken(token))
		if errors.Is(err, sql.ErrNoRows) {
			s.clearSessionCookies(w, r)
			writeError(w, r, http.StatusUnauthorized, "your session has ended; sign in again")
			return
		}
		if err != nil {
			slog.ErrorContext(r.Context(), "session.lookup_failed", "error", err.Error())
			writeError(w, r, http.StatusServiceUnavailable, "sessions are temporarily unavailable; try again")
			return
		}
		now := time.Now().UTC()
		idle, _ := s.sessionTimeouts(r.Context())
		if session.RevokedAt != nil || !now.Before(session.ExpiresAt) || now.Sub(session.LastUsedAt) > idle {
			s.clearSessionCookies(w, r)
			writeError(w, r, http.StatusUnauthorized, "your session has ended; sign in again")
			return
		}
		identity, ok := s.loadIdentity(r.Context(), session.UserID)
		if !ok || !identity.User.IsActive {
			_ = s.store.RevokeSession(r.Context(), session.ID, now)
			s.clearSessionCookies(w, r)
			writeError(w, r, http.StatusUnauthorized, "your session has ended; sign in again")
			return
		}
		if now.Sub(session.LastUsedAt) > sessionTouchInterval {
			if err := s.store.TouchSession(r.Context(), session.ID, now); err != nil {
				slog.WarnContext(r.Context(), "session.touch_failed", "error", err.Error())
			}
		}
		if identity.User.MustChangePassword && identity.User.AuthSource == "local" && !allowedBeforePasswordChange(r) {
			writeError(w, r, http.StatusForbidden, "password change required")
			return
		}
		setRequestUser(r.Context(), identity.User.Username)
		ctx := context.WithValue(r.Context(), identityKey{}, identity)
		ctx = context.WithValue(ctx, sessionKey{}, session)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func allowedBeforePasswordChange(r *http.Request) bool {
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/api/auth/me":
		return true
	case r.Method == http.MethodPost && r.URL.Path == "/api/auth/change-password":
		return true
	case r.Method == http.MethodPost && r.URL.Path == "/api/auth/logout":
		return true
	}
	return false
}

func (s *Server) loadIdentity(ctx context.Context, userID int) (*models.Identity, bool) {
	user, err := s.store.GetUserByID(ctx, userID)
	if err != nil {
		return nil, false
	}
	groupIDs, _ := s.store.GetUserGroupIDs(ctx, user.ID)
	permissions, _ := s.store.ResolvePermissions(ctx, user.ID)
	return &models.Identity{User: *user, Permissions: permissions, GroupIDs: groupIDs}, true
}

// currentSession returns the session requireSession stored on the request.
func currentSession(r *http.Request) *models.Session {
	session, _ := r.Context().Value(sessionKey{}).(*models.Session)
	return session
}

// csrfProtect guards state-changing API requests: they must carry the
// X-CSRF-Protection header, and when the browser says where the request comes
// from (Origin, Sec-Fetch-Site) that must be this site.
func (s *Server) csrfProtect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}
		if r.Header.Get(csrfHeader) == "" {
			writeError(w, r, http.StatusForbidden, "missing "+csrfHeader+" header")
			return
		}
		if site := r.Header.Get("Sec-Fetch-Site"); site == "cross-site" {
			writeError(w, r, http.StatusForbidden, "cross-site request refused")
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			u, err := url.Parse(origin)
			if err != nil || !strings.EqualFold(u.Host, s.requestHost(r)) {
				writeError(w, r, http.StatusForbidden, "cross-origin request refused")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// requestHost is the host the browser addressed: X-Forwarded-Host from a trusted
// proxy, otherwise the Host header.
func (s *Server) requestHost(r *http.Request) string {
	if s.trustedPeer(remoteHost(r)) {
		if forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Host"), ",")[0]); forwarded != "" {
			return forwarded
		}
	}
	return r.Host
}

func truncate(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max]
}

// StartSessionPurge deletes sessions that ended more than a day ago, hourly.
func (s *Server) StartSessionPurge(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			if err := s.store.PurgeSessions(context.Background(), time.Now().UTC().Add(-24*time.Hour)); err != nil {
				slog.Error("session.purge_failed", "error", err.Error())
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

package api

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"api-portal/backend/internal/models"
)

func TestSessionCookieNameFollowsTLS(t *testing.T) {
	e := newEnv(t)
	e.user("alice", false)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"username":"alice","password":"`+testPassword+`"}`))
	req.Header.Set(csrfHeader, "1")
	req.TLS = &tls.ConnectionState{}
	rec := e.raw(req)
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != sessionCookieSecure || !cookies[0].Secure || !cookies[0].HttpOnly || cookies[0].Path != "/" {
		t.Fatalf("cookie over TLS: %+v", cookies)
	}
	if strings.Contains(rec.Body.String(), cookies[0].Value) {
		t.Fatal("the session token is in the response body")
	}
}

func TestOnlyTokenHashIsStored(t *testing.T) {
	e := newEnv(t)
	e.user("alice", false)
	token := e.login("alice")
	var stored string
	if err := e.dbConn.QueryRow(`SELECT token_hash FROM sessions`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored == token || stored != hashToken(token) {
		t.Fatalf("stored %q for token %q", stored, token)
	}
}

func TestCSRFProtection(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	token := e.login("root")
	post := func(mutate func(*http.Request)) int {
		req := httptest.NewRequest(http.MethodPost, "/api/admin/groups", bytes.NewReader([]byte(`{"name":"g"}`)))
		req.Header.Set(csrfHeader, "1")
		req.AddCookie(&http.Cookie{Name: sessionCookiePlain, Value: token})
		mutate(req)
		rec := httptest.NewRecorder()
		e.handler.ServeHTTP(rec, req)
		return rec.Code
	}
	if code := post(func(r *http.Request) { r.Header.Del(csrfHeader) }); code != http.StatusForbidden {
		t.Errorf("no CSRF header: %d, want 403", code)
	}
	if code := post(func(r *http.Request) { r.Header.Set("Origin", "https://evil.example") }); code != http.StatusForbidden {
		t.Errorf("foreign Origin: %d, want 403", code)
	}
	if code := post(func(r *http.Request) { r.Header.Set("Sec-Fetch-Site", "cross-site") }); code != http.StatusForbidden {
		t.Errorf("cross-site fetch: %d, want 403", code)
	}
	if code := post(func(r *http.Request) { r.Header.Set("Origin", "http://example.com") }); code != http.StatusCreated {
		t.Errorf("same-origin request: %d, want 201", code) // httptest's Host is example.com
	}
	// Login needs the header too (no login CSRF).
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"username":"root","password":"`+testPassword+`"}`))
	rec := httptest.NewRecorder()
	e.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("login without CSRF header: %d, want 403", rec.Code)
	}
}

func TestLogoutEndsTheSession(t *testing.T) {
	e := newEnv(t)
	e.user("alice", false)
	token := e.login("alice")
	e.expect(http.MethodPost, "/api/auth/logout", token, nil, http.StatusOK)
	e.expect(http.MethodGet, "/api/auth/me", token, nil, http.StatusUnauthorized)
	if !contains(e.auditActions(), "auth.logout.success") {
		t.Fatal("logout not audited")
	}
}

func TestIdleAndAbsoluteExpiry(t *testing.T) {
	e := newEnv(t)
	e.user("alice", false)
	if err := e.store.UpdateSessionSettings(context.Background(), models.SessionSettings{SessionMinutes: 30, MaxHours: 8}); err != nil {
		t.Fatal(err)
	}
	idle := e.login("alice")
	if _, err := e.dbConn.Exec(`UPDATE sessions SET last_used_at = ? WHERE token_hash = ?`, time.Now().UTC().Add(-31*time.Minute), hashToken(idle)); err != nil {
		t.Fatal(err)
	}
	e.expect(http.MethodGet, "/api/auth/me", idle, nil, http.StatusUnauthorized)

	expired := e.login("alice")
	if _, err := e.dbConn.Exec(`UPDATE sessions SET expires_at = ? WHERE token_hash = ?`, time.Now().UTC().Add(-time.Second), hashToken(expired)); err != nil {
		t.Fatal(err)
	}
	e.expect(http.MethodGet, "/api/auth/me", expired, nil, http.StatusUnauthorized)

	fresh := e.login("alice")
	out := e.expect(http.MethodGet, "/api/auth/me", fresh, nil, http.StatusOK)
	var me struct {
		Session struct {
			ExpiresAt   time.Time
			IdleMinutes int
		}
	}
	_ = json.Unmarshal([]byte(out), &me)
	if me.Session.IdleMinutes != 30 || time.Until(me.Session.ExpiresAt) > 8*time.Hour || time.Until(me.Session.ExpiresAt) < 7*time.Hour {
		t.Fatalf("session info: %+v", me.Session)
	}
}

func TestPasswordChangeEndsOtherSessions(t *testing.T) {
	e := newEnv(t)
	e.user("alice", false)
	laptop := e.login("alice")
	phone := e.login("alice")
	out := e.expect(http.MethodPost, "/api/auth/change-password", laptop, map[string]string{"currentPassword": testPassword, "newPassword": "a-much-better-pass-9"}, http.StatusOK)
	if !strings.Contains(out, `"sessionsRevoked":1`) {
		t.Fatalf("response: %s", out)
	}
	e.expect(http.MethodGet, "/api/auth/me", laptop, nil, http.StatusOK)
	e.expect(http.MethodGet, "/api/auth/me", phone, nil, http.StatusUnauthorized)
}

func TestDeactivationAndDemotionEndSessions(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	bob := e.user("bob", true)
	rootToken := e.login("root")
	bobToken := e.login("bob")
	e.expect(http.MethodPut, fmt.Sprintf("/api/admin/users/%d", bob.ID), rootToken, map[string]any{"username": "bob", "isAdmin": false, "isActive": true}, http.StatusOK)
	e.expect(http.MethodGet, "/api/auth/me", bobToken, nil, http.StatusUnauthorized)
}

func TestAdminPasswordReset(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	alice := e.user("alice", false)
	otherAdmin := e.user("other", true)
	manager := e.user("manager", false)
	e.grant(manager.ID, "user.manage")
	aliceToken := e.login("alice")
	rootToken := e.login("root")

	out := e.expect(http.MethodPost, fmt.Sprintf("/api/admin/users/%d/reset-password", alice.ID), rootToken, nil, http.StatusOK)
	var resp struct{ TemporaryPassword string }
	_ = json.Unmarshal([]byte(out), &resp)
	if len(resp.TemporaryPassword) != 16 {
		t.Fatalf("temporary password: %q", resp.TemporaryPassword)
	}
	e.expect(http.MethodGet, "/api/auth/me", aliceToken, nil, http.StatusUnauthorized)
	newToken := e.loginWith("alice", resp.TemporaryPassword)
	e.expect(http.MethodGet, "/api/catalog", newToken, nil, http.StatusForbidden) // must change first

	logs, _, _ := e.store.ListAuditLogs(context.Background(), models.AuditFilter{ActionPrefix: "user.password_reset.success"}, 50, 0)
	if len(logs) != 1 || strings.Contains(logs[0].DetailsJSON, resp.TemporaryPassword) {
		t.Fatalf("reset audit: %+v", logs)
	}

	managerToken := e.login("manager")
	e.expect(http.MethodPost, fmt.Sprintf("/api/admin/users/%d/reset-password", otherAdmin.ID), managerToken, nil, http.StatusForbidden)
	ldapID, _ := e.store.CreateUser(context.Background(), models.User{Username: "ldap-lee", AuthSource: "ldap", IsActive: true})
	e.expect(http.MethodPost, fmt.Sprintf("/api/admin/users/%d/reset-password", ldapID), rootToken, nil, http.StatusBadRequest)
}

func TestSessionListsAndRevocation(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	e.user("alice", false)
	e.user("bob", false)
	a1 := e.login("alice")
	a2 := e.login("alice")
	b1 := e.login("bob")

	var mine struct{ Items []models.Session }
	_ = json.Unmarshal([]byte(e.expect(http.MethodGet, "/api/auth/sessions", a1, nil, http.StatusOK)), &mine)
	if len(mine.Items) != 2 {
		t.Fatalf("alice sees %d sessions, want 2", len(mine.Items))
	}
	var other *models.Session
	for i := range mine.Items {
		if !mine.Items[i].Current {
			other = &mine.Items[i]
		}
	}
	e.expect(http.MethodDelete, fmt.Sprintf("/api/auth/sessions/%d", other.ID), a1, nil, http.StatusOK)
	e.expect(http.MethodGet, "/api/auth/me", a2, nil, http.StatusUnauthorized)

	// bob's session is not alice's to end.
	var bobs struct{ Items []models.Session }
	_ = json.Unmarshal([]byte(e.expect(http.MethodGet, "/api/auth/sessions", b1, nil, http.StatusOK)), &bobs)
	e.expect(http.MethodDelete, fmt.Sprintf("/api/auth/sessions/%d", bobs.Items[0].ID), a1, nil, http.StatusNotFound)

	rootToken := e.login("root")
	var all struct{ Items []models.Session }
	_ = json.Unmarshal([]byte(e.expect(http.MethodGet, "/api/admin/sessions", rootToken, nil, http.StatusOK)), &all)
	if len(all.Items) != 3 { // alice, bob, root
		t.Fatalf("admin sees %d sessions, want 3", len(all.Items))
	}
	e.expect(http.MethodDelete, fmt.Sprintf("/api/admin/sessions/%d", bobs.Items[0].ID), rootToken, nil, http.StatusOK)
	e.expect(http.MethodGet, "/api/auth/me", b1, nil, http.StatusUnauthorized)
}

func TestSessionLookupFailsClosed(t *testing.T) {
	e := newEnv(t)
	e.user("alice", false)
	token := e.login("alice")
	e.dbConn.Close()
	e.expect(http.MethodGet, "/api/auth/me", token, nil, http.StatusServiceUnavailable)
}

func TestPasswordPolicyApplies(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	token := e.login("root")
	out := e.expect(http.MethodPost, "/api/admin/users", token, map[string]any{"username": "weak", "password": "contortionist"}, http.StatusBadRequest)
	if !strings.Contains(out, "commonly used") && !strings.Contains(out, "at least") {
		t.Fatalf("weak password message: %s", out)
	}
	e.expect(http.MethodPost, "/api/admin/users", token, map[string]any{"username": "weak", "password": "weak-weak-weak"}, http.StatusBadRequest) // contains the username
	var me struct{ PasswordPolicy struct{ MinLength int } }
	_ = json.Unmarshal([]byte(e.expect(http.MethodGet, "/api/auth/me", token, nil, http.StatusOK)), &me)
	if me.PasswordPolicy.MinLength != 12 {
		t.Fatalf("policy in /me: %+v", me.PasswordPolicy)
	}
}

func TestDirectoryAccountsKeepDirectoryFields(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	token := e.login("root")
	id, _ := e.store.CreateUser(context.Background(), models.User{Username: "ldap-lee", DisplayName: "Lee", Email: "lee@corp", AuthSource: "ldap", IsActive: true})
	e.expect(http.MethodPut, fmt.Sprintf("/api/admin/users/%d", id), token, map[string]any{"username": "someone-else", "displayName": "X", "email": "x@evil", "isActive": true}, http.StatusOK)
	u, _ := e.store.GetUserByID(context.Background(), id)
	if u.Username != "ldap-lee" || u.Email != "lee@corp" || u.DisplayName != "Lee" {
		t.Fatalf("directory fields changed: %+v", u)
	}
}

func TestSessionSettingsValidation(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	token := e.login("root")
	e.expect(http.MethodPut, "/api/admin/session", token, map[string]int{"sessionMinutes": 600, "maxHours": 4}, http.StatusBadRequest)
	e.expect(http.MethodPut, "/api/admin/session", token, map[string]int{"sessionMinutes": 2}, http.StatusBadRequest)
	e.expect(http.MethodPut, "/api/admin/session", token, map[string]int{"sessionMinutes": 45}, http.StatusOK) // keeps maxHours
	settings, _ := e.store.GetSessionSettings(context.Background())
	if settings.SessionMinutes != 45 || settings.MaxHours != 12 {
		t.Fatalf("settings: %+v", settings)
	}
}

func TestEncryptionKeyWarningForAdmins(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	e.user("alice", false)
	if out := e.expect(http.MethodGet, "/api/auth/me", e.login("root"), nil, http.StatusOK); !strings.Contains(out, "encryption_key_in_database") {
		t.Fatalf("admin /me lacks the key warning: %s", out)
	}
	if out := e.expect(http.MethodGet, "/api/auth/me", e.login("alice"), nil, http.StatusOK); strings.Contains(out, "encryption_key_in_database") {
		t.Fatal("non-admin sees the key warning")
	}
}

func TestLDAPTestLoginReportsSteps(t *testing.T) {
	e := newEnv(t)
	e.user("root", true)
	out := e.expect(http.MethodPost, "/api/admin/ldap/test-login", e.login("root"), map[string]string{"username": "alice", "password": "x"}, http.StatusOK)
	var resp struct {
		OK    bool
		Steps []struct {
			Name string
			OK   bool
		}
	}
	_ = json.Unmarshal([]byte(out), &resp)
	if resp.OK || len(resp.Steps) == 0 || resp.Steps[0].Name != "connect" || resp.Steps[0].OK {
		t.Fatalf("test login with LDAP disabled: %s", out)
	}
}

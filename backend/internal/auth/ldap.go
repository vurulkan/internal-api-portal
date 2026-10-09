package auth

import (
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	neturl "net/url"
	"strings"
	"time"

	"github.com/go-ldap/ldap/v3"

	"api-portal/backend/internal/models"
)

func LDAPAuthenticate(cfg models.LDAPConfig, username, password string) error {
	conn, err := dialLDAP(cfg)
	if err != nil {
		return err
	}
	defer conn.Close()

	if cfg.BindDN != "" {
		if err := conn.Bind(cfg.BindDN, cfg.BindPassword); err != nil {
			return err
		}
	}

	userDN, _, err := findLDAPUser(conn, cfg, username)
	if err != nil {
		return err
	}
	return conn.Bind(userDN, password)
}

func TestLDAPConnection(cfg models.LDAPConfig) error {
	conn, err := dialLDAP(cfg)
	if err != nil {
		return err
	}
	defer conn.Close()
	if cfg.BindDN != "" {
		return conn.Bind(cfg.BindDN, cfg.BindPassword)
	}
	return nil
}

func SearchLDAPUsers(cfg models.LDAPConfig, query string) ([]models.LDAPUser, error) {
	conn, err := dialLDAP(cfg)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	if cfg.BindDN != "" {
		if err := conn.Bind(cfg.BindDN, cfg.BindPassword); err != nil {
			return nil, err
		}
	}

	filter := searchFilter(cfg, query)

	var out []models.LDAPUser
	for _, baseDN := range userBaseDNs(cfg) {
		req := ldap.NewSearchRequest(baseDN, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 50, 0, false, filter, []string{"dn", cfg.UsernameAttribute, cfg.DisplayNameAttr, cfg.EmailAttr, "cn", "mail"}, nil)
		result, err := conn.Search(req)
		if err != nil {
			continue
		}
		for _, entry := range result.Entries {
			username := firstValue(entry, cfg.UsernameAttribute, "uid", "sAMAccountName", "cn")
			displayName := firstValue(entry, cfg.DisplayNameAttr, "displayName", "cn")
			email := firstValue(entry, cfg.EmailAttr, "mail")
			if username == "" {
				continue
			}
			out = append(out, models.LDAPUser{
				Username:    username,
				DisplayName: displayName,
				Email:       email,
				DN:          entry.DN,
			})
		}
	}
	return out, nil
}

func searchFilter(cfg models.LDAPConfig, query string) string {
	escaped := ldap.EscapeFilter(strings.TrimSpace(query))
	usernameAttr := cfg.UsernameAttribute
	if usernameAttr == "" {
		usernameAttr = "uid"
	}
	displayAttr := cfg.DisplayNameAttr
	if displayAttr == "" {
		displayAttr = "displayName"
	}
	emailAttr := cfg.EmailAttr
	if emailAttr == "" {
		emailAttr = "mail"
	}

	baseFilter := strings.TrimSpace(cfg.UserFilter)
	if strings.Contains(baseFilter, "%s") {
		return fmt.Sprintf(baseFilter, escaped)
	}
	if baseFilter == "" {
		baseFilter = "(objectClass=person)"
	}
	if escaped == "" {
		return baseFilter
	}
	searchPart := fmt.Sprintf("(|(%s=*%s*)(%s=*%s*)(%s=*%s*)(cn=*%s*))", usernameAttr, escaped, displayAttr, escaped, emailAttr, escaped, escaped)
	return fmt.Sprintf("(&%s%s)", baseFilter, searchPart)
}

func dialLDAP(cfg models.LDAPConfig) (*ldap.Conn, error) {
	if !cfg.Enabled {
		return nil, fmt.Errorf("ldap disabled")
	}
	url := cfg.URL
	if url == "" {
		scheme := "ldap"
		if cfg.UseSSL {
			scheme = "ldaps"
		}
		port := cfg.Port
		if port == 0 {
			port = 389
		}
		url = fmt.Sprintf("%s://%s:%d", scheme, cfg.Host, port)
	}
	timeout := time.Duration(cfg.TimeoutSeconds) * time.Second
	if timeout == 0 {
		timeout = 10 * time.Second
	}
	parsed, err := neturl.Parse(url)
	if err != nil {
		return nil, fmt.Errorf("invalid ldap url: %w", err)
	}
	// One TLS config for ldaps:// and StartTLS. Before, ldaps:// ignored "skip verify"
	// and StartTLS had no ServerName (so verification could only fail).
	tlsConfig := &tls.Config{
		ServerName:         parsed.Hostname(),
		InsecureSkipVerify: cfg.SkipVerify,
		MinVersion:         tls.VersionTLS12,
	}
	conn, err := ldap.DialURL(url, ldap.DialWithDialer(&net.Dialer{Timeout: timeout}), ldap.DialWithTLSConfig(tlsConfig))
	if err != nil {
		return nil, err
	}
	if cfg.StartTLS {
		if err := conn.StartTLS(tlsConfig); err != nil {
			conn.Close()
			return nil, err
		}
	}
	return conn, nil
}

// ErrLDAPAmbiguousUser means the login filter matched more than one entry. Binding
// to any of them would authenticate the wrong person, so the login is refused.
var ErrLDAPAmbiguousUser = errors.New("ldap login filter matches more than one user")

// UserLoginFilter builds the search filter for a login. The username is always part
// of the filter: a configured filter with %s gets it substituted, any other filter
// (e.g. "(objectClass=user)") is AND-ed with (<usernameAttribute>=<username>).
// Previously a filter without %s was used as-is and the first entry in the directory
// was bound with the typed password.
func UserLoginFilter(cfg models.LDAPConfig, username string) string {
	attr := strings.TrimSpace(cfg.UsernameAttribute)
	if attr == "" {
		attr = "uid"
	}
	escaped := ldap.EscapeFilter(username)
	userClause := fmt.Sprintf("(%s=%s)", attr, escaped)
	filter := strings.TrimSpace(cfg.UserFilter)
	switch {
	case filter == "":
		return userClause
	case strings.Contains(filter, "%s"):
		return strings.ReplaceAll(filter, "%s", escaped)
	default:
		return fmt.Sprintf("(&%s%s)", filter, userClause)
	}
}

// ValidateUserFilter rejects filters the directory would refuse at login time.
func ValidateUserFilter(cfg models.LDAPConfig) error {
	raw := strings.TrimSpace(cfg.UserFilter)
	if raw == "" {
		return nil
	}
	// Compile the configured filter on its own too: once wrapped in (&...), a missing
	// ")" can be swallowed into an attribute value and go unnoticed.
	for _, candidate := range []string{strings.ReplaceAll(raw, "%s", "probe"), UserLoginFilter(cfg, "probe")} {
		if _, err := ldap.CompileFilter(candidate); err != nil {
			return fmt.Errorf("invalid ldap user filter: %w", err)
		}
	}
	return nil
}

func findLDAPUser(conn *ldap.Conn, cfg models.LDAPConfig, username string) (string, *ldap.Entry, error) {
	attr := cfg.UsernameAttribute
	if attr == "" {
		attr = "uid"
	}
	filter := UserLoginFilter(cfg, username)
	var found *ldap.Entry
	for _, baseDN := range userBaseDNs(cfg) {
		// Size limit 2: enough to detect an ambiguous filter without listing the directory.
		req := ldap.NewSearchRequest(baseDN, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 2, 0, false, filter, []string{"dn", attr}, nil)
		result, err := conn.Search(req)
		if ldap.IsErrorWithCode(err, ldap.LDAPResultSizeLimitExceeded) {
			return "", nil, ErrLDAPAmbiguousUser
		}
		if err != nil || result == nil {
			continue
		}
		for _, entry := range result.Entries {
			if found != nil && !strings.EqualFold(found.DN, entry.DN) {
				return "", nil, ErrLDAPAmbiguousUser
			}
			found = entry
		}
	}
	if found == nil {
		return "", nil, fmt.Errorf("ldap user not found")
	}
	return found.DN, found, nil
}

func userBaseDNs(cfg models.LDAPConfig) []string {
	if len(cfg.UserBaseDNs) > 0 {
		return cfg.UserBaseDNs
	}
	if cfg.UserBaseDN != "" {
		return []string{cfg.UserBaseDN}
	}
	return nil
}

func firstValue(entry *ldap.Entry, attrs ...string) string {
	for _, attr := range attrs {
		if attr == "" {
			continue
		}
		if value := entry.GetAttributeValue(attr); value != "" {
			return value
		}
	}
	return ""
}

// LDAPStep is one stage of LDAPTestLogin.
type LDAPStep struct {
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail"`
}

// LDAPTestLogin runs the login sequence for username / password and reports each
// stage (connect, service bind, user search, user bind), so an administrator can
// see where a sign-in fails. It does not check whether the user is imported.
func LDAPTestLogin(cfg models.LDAPConfig, username, password string) []LDAPStep {
	var steps []LDAPStep
	add := func(name string, err error, okDetail string) bool {
		if err != nil {
			steps = append(steps, LDAPStep{Name: name, OK: false, Detail: err.Error()})
			return false
		}
		steps = append(steps, LDAPStep{Name: name, OK: true, Detail: okDetail})
		return true
	}
	conn, err := dialLDAP(cfg)
	if !add("connect", err, "connected") {
		return steps
	}
	defer conn.Close()
	if cfg.BindDN != "" {
		if !add("service bind", conn.Bind(cfg.BindDN, cfg.BindPassword), "bound as "+cfg.BindDN) {
			return steps
		}
	} else {
		add("service bind", nil, "anonymous (no bind DN configured)")
	}
	filter := UserLoginFilter(cfg, username)
	userDN, _, err := findLDAPUser(conn, cfg, username)
	if !add("user search", err, "filter "+filter+" matched "+userDN) {
		steps[len(steps)-1].Detail += " (filter " + filter + ")"
		return steps
	}
	if strings.TrimSpace(password) == "" {
		steps = append(steps, LDAPStep{Name: "user bind", OK: false, Detail: "no password given; skipped"})
		return steps
	}
	add("user bind", conn.Bind(userDN, password), "password accepted")
	return steps
}

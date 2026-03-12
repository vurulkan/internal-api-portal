package auth

import (
	"crypto/tls"
	"fmt"
	"net"
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
	conn, err := ldap.DialURL(url, ldap.DialWithDialer(&net.Dialer{Timeout: timeout}))
	if err != nil {
		return nil, err
	}
	if cfg.StartTLS {
		if err := conn.StartTLS(&tls.Config{InsecureSkipVerify: cfg.SkipVerify}); err != nil {
			conn.Close()
			return nil, err
		}
	}
	return conn, nil
}

func findLDAPUser(conn *ldap.Conn, cfg models.LDAPConfig, username string) (string, *ldap.Entry, error) {
	attr := cfg.UsernameAttribute
	if attr == "" {
		attr = "uid"
	}
	filter := cfg.UserFilter
	if strings.Contains(filter, "%s") {
		filter = fmt.Sprintf(filter, ldap.EscapeFilter(username))
	}
	if filter == "" {
		filter = fmt.Sprintf("(%s=%s)", attr, ldap.EscapeFilter(username))
	}
	for _, baseDN := range userBaseDNs(cfg) {
		req := ldap.NewSearchRequest(baseDN, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 1, 0, false, filter, []string{"dn", attr}, nil)
		result, err := conn.Search(req)
		if err != nil {
			continue
		}
		if len(result.Entries) > 0 {
			return result.Entries[0].DN, result.Entries[0], nil
		}
	}
	return "", nil, fmt.Errorf("ldap user not found")
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

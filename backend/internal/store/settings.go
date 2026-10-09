package store

import (
	"context"
	"encoding/json"

	"api-portal/backend/internal/models"
)

func (s *Store) GetLDAPConfig(ctx context.Context) (*models.LDAPConfig, error) {
	var cfg models.LDAPConfig
	var enabled, useSSL, startTLS, skipVerify int
	var bindPasswordEnc string
	var userBaseDNSRaw string
	err := s.conn.QueryRowContext(ctx, `SELECT enabled, url, host, port, use_ssl, start_tls, skip_verify, timeout_seconds, bind_dn, bind_password_enc, user_base_dn, user_base_dns, user_filter, username_attribute, display_name_attribute, email_attribute FROM ldap_config WHERE id = 1`).
		Scan(&enabled, &cfg.URL, &cfg.Host, &cfg.Port, &useSSL, &startTLS, &skipVerify, &cfg.TimeoutSeconds, &cfg.BindDN, &bindPasswordEnc, &cfg.UserBaseDN, &userBaseDNSRaw, &cfg.UserFilter, &cfg.UsernameAttribute, &cfg.DisplayNameAttr, &cfg.EmailAttr)
	if err != nil {
		return nil, err
	}
	cfg.Enabled = enabled == 1
	cfg.UseSSL = useSSL == 1
	cfg.StartTLS = startTLS == 1
	cfg.SkipVerify = skipVerify == 1
	cfg.PasswordConfigured = bindPasswordEnc != ""
	_ = json.Unmarshal([]byte(userBaseDNSRaw), &cfg.UserBaseDNs)
	if bindPasswordEnc != "" {
		cfg.BindPassword, _ = decrypt(s.key, bindPasswordEnc)
	}
	return &cfg, nil
}

func (s *Store) UpdateLDAPConfig(ctx context.Context, cfg models.LDAPConfig) error {
	raw, _ := json.Marshal(cfg.UserBaseDNs)
	password := cfg.BindPassword
	if password == "" {
		existing, err := s.GetLDAPConfig(ctx)
		if err == nil {
			password = existing.BindPassword
		}
	}
	encoded, err := encrypt(s.key, password)
	if err != nil {
		return err
	}
	_, err = s.conn.ExecContext(ctx, `UPDATE ldap_config SET enabled = ?, url = ?, host = ?, port = ?, use_ssl = ?, start_tls = ?, skip_verify = ?, timeout_seconds = ?, bind_dn = ?, bind_password_enc = ?, user_base_dn = ?, user_base_dns = ?, user_filter = ?, username_attribute = ?, display_name_attribute = ?, email_attribute = ? WHERE id = 1`,
		boolInt(cfg.Enabled), cfg.URL, cfg.Host, cfg.Port, boolInt(cfg.UseSSL), boolInt(cfg.StartTLS), boolInt(cfg.SkipVerify), cfg.TimeoutSeconds, cfg.BindDN, encoded, cfg.UserBaseDN, string(raw), cfg.UserFilter, cfg.UsernameAttribute, cfg.DisplayNameAttr, cfg.EmailAttr)
	return err
}

func (s *Store) GetAzureADConfig(ctx context.Context) (*models.AzureADConfig, error) {
	var cfg models.AzureADConfig
	var enabled int
	var clientSecretEnc string
	err := s.conn.QueryRowContext(ctx, `SELECT enabled, tenant_id, client_id, client_secret_enc, redirect_url FROM azure_ad_config WHERE id = 1`).
		Scan(&enabled, &cfg.TenantID, &cfg.ClientID, &clientSecretEnc, &cfg.RedirectURL)
	if err != nil {
		return nil, err
	}
	cfg.Enabled = enabled == 1
	cfg.PasswordConfigured = clientSecretEnc != ""
	if clientSecretEnc != "" {
		cfg.ClientSecret, _ = decrypt(s.key, clientSecretEnc)
	}
	return &cfg, nil
}

func (s *Store) UpdateAzureADConfig(ctx context.Context, cfg models.AzureADConfig) error {
	clientSecret := cfg.ClientSecret
	if clientSecret == "" {
		existing, err := s.GetAzureADConfig(ctx)
		if err == nil {
			clientSecret = existing.ClientSecret
		}
	}
	encoded, err := encrypt(s.key, clientSecret)
	if err != nil {
		return err
	}
	_, err = s.conn.ExecContext(ctx, `UPDATE azure_ad_config SET enabled = ?, tenant_id = ?, client_id = ?, client_secret_enc = ?, redirect_url = ? WHERE id = 1`,
		boolInt(cfg.Enabled), cfg.TenantID, cfg.ClientID, encoded, cfg.RedirectURL)
	return err
}

func (s *Store) GetSessionSettings(ctx context.Context) (*models.SessionSettings, error) {
	var session models.SessionSettings
	err := s.conn.QueryRowContext(ctx, `SELECT session_minutes FROM session_settings WHERE id = 1`).Scan(&session.SessionMinutes)
	return &session, err
}

func (s *Store) UpdateSessionSettings(ctx context.Context, session models.SessionSettings) error {
	_, err := s.conn.ExecContext(ctx, `UPDATE session_settings SET session_minutes = ? WHERE id = 1`, session.SessionMinutes)
	return err
}

func (s *Store) GetSystemSettings(ctx context.Context) (*models.SystemSettings, error) {
	var settings models.SystemSettings
	err := s.conn.QueryRowContext(ctx, `SELECT brand_title, logo_data_url FROM system_settings WHERE id = 1`).Scan(&settings.BrandTitle, &settings.LogoDataURL)
	return &settings, err
}

// ClearSVGLogo removes a stored SVG logo. SVG uploads are no longer accepted because
// an SVG can carry script; it returns true when a logo was removed.
func (s *Store) ClearSVGLogo(ctx context.Context) (bool, error) {
	result, err := s.conn.ExecContext(ctx, `UPDATE system_settings SET logo_data_url = '' WHERE id = 1 AND logo_data_url LIKE 'data:image/svg%'`)
	if err != nil {
		return false, err
	}
	n, _ := result.RowsAffected()
	return n > 0, nil
}

func (s *Store) UpdateSystemSettings(ctx context.Context, settings models.SystemSettings) error {
	_, err := s.conn.ExecContext(ctx, `UPDATE system_settings SET brand_title = ?, logo_data_url = ? WHERE id = 1`, settings.BrandTitle, settings.LogoDataURL)
	return err
}

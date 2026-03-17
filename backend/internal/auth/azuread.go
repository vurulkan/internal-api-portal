package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"strings"

	oidc "github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"api-portal/backend/internal/models"
)

type AzureADUser struct {
	Subject     string
	Email       string
	Username    string
	DisplayName string
}

func AzureADAuthURL(cfg models.AzureADConfig, state, nonce string) (string, error) {
	oauthConfig, err := azureOAuthConfig(cfg)
	if err != nil {
		return "", err
	}
	return oauthConfig.AuthCodeURL(state, oidc.Nonce(nonce)), nil
}

func AzureADExchangeCode(ctx context.Context, cfg models.AzureADConfig, code, expectedNonce string) (*AzureADUser, error) {
	provider, oauthConfig, verifier, err := azureProvider(ctx, cfg)
	if err != nil {
		return nil, err
	}
	_ = provider
	token, err := oauthConfig.Exchange(ctx, code)
	if err != nil {
		return nil, err
	}
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok || rawIDToken == "" {
		return nil, fmt.Errorf("azure ad id_token missing")
	}
	idToken, err := verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return nil, err
	}
	var claims struct {
		Subject           string `json:"sub"`
		Email             string `json:"email"`
		PreferredUsername string `json:"preferred_username"`
		Name              string `json:"name"`
		OID               string `json:"oid"`
		Nonce             string `json:"nonce"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return nil, err
	}
	if expectedNonce != "" && claims.Nonce != expectedNonce {
		return nil, fmt.Errorf("azure ad nonce mismatch")
	}
	username := strings.TrimSpace(claims.PreferredUsername)
	if username == "" {
		username = strings.TrimSpace(claims.Email)
	}
	if username == "" {
		username = strings.TrimSpace(claims.OID)
	}
	if username == "" {
		return nil, fmt.Errorf("azure ad user identifier missing")
	}
	return &AzureADUser{
		Subject:     firstNonEmpty(claims.OID, claims.Subject),
		Email:       strings.TrimSpace(claims.Email),
		Username:    username,
		DisplayName: strings.TrimSpace(claims.Name),
	}, nil
}

func TestAzureADConnection(ctx context.Context, cfg models.AzureADConfig) error {
	_, _, _, err := azureProvider(ctx, cfg)
	return err
}

func RandomState() (string, error) {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func azureProvider(ctx context.Context, cfg models.AzureADConfig) (*oidc.Provider, *oauth2.Config, *oidc.IDTokenVerifier, error) {
	if !cfg.Enabled {
		return nil, nil, nil, fmt.Errorf("azure ad disabled")
	}
	issuer := fmt.Sprintf("https://login.microsoftonline.com/%s/v2.0", strings.TrimSpace(cfg.TenantID))
	provider, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, nil, nil, err
	}
	oauthConfig := &oauth2.Config{
		ClientID:     strings.TrimSpace(cfg.ClientID),
		ClientSecret: strings.TrimSpace(cfg.ClientSecret),
		RedirectURL:  strings.TrimSpace(cfg.RedirectURL),
		Endpoint:     provider.Endpoint(),
		Scopes:       []string{oidc.ScopeOpenID, "profile", "email"},
	}
	verifier := provider.Verifier(&oidc.Config{ClientID: oauthConfig.ClientID})
	return provider, oauthConfig, verifier, nil
}

func azureOAuthConfig(cfg models.AzureADConfig) (*oauth2.Config, error) {
	_, oauthConfig, _, err := azureProvider(context.Background(), cfg)
	if err != nil {
		return nil, err
	}
	return oauthConfig, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"strings"

	oidc "github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/clientcredentials"

	"api-portal/backend/internal/models"
)

// azureAuthority is Microsoft Entra ID's sign-in host (tests point it elsewhere).
var azureAuthority = "https://login.microsoftonline.com"

type AzureADUser struct {
	Subject string
	// ExternalID is "<tid>:<oid>", the stable identity a portal account is bound to.
	ExternalID  string
	Email       string
	Username    string
	DisplayName string
	// Groups are the group object ids from the "groups" claim. GroupsOverage is set
	// when Azure left them out because the user is in too many groups.
	Groups        []string
	GroupsOverage bool
}

// AzureADAuthURL builds the authorization request with state, nonce and a PKCE
// (S256) challenge for pkceVerifier.
func AzureADAuthURL(cfg models.AzureADConfig, state, nonce, pkceVerifier string) (string, error) {
	oauthConfig, err := azureOAuthConfig(cfg)
	if err != nil {
		return "", err
	}
	return oauthConfig.AuthCodeURL(state, oidc.Nonce(nonce), oauth2.S256ChallengeOption(pkceVerifier)), nil
}

// NewPKCEVerifier returns a random PKCE code verifier.
func NewPKCEVerifier() string { return oauth2.GenerateVerifier() }

func AzureADExchangeCode(ctx context.Context, cfg models.AzureADConfig, code, expectedNonce, pkceVerifier string) (*AzureADUser, error) {
	_, oauthConfig, verifier, err := azureProvider(ctx, cfg)
	if err != nil {
		return nil, err
	}
	token, err := oauthConfig.Exchange(ctx, code, oauth2.VerifierOption(pkceVerifier))
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
		Subject           string         `json:"sub"`
		Email             string         `json:"email"`
		PreferredUsername string         `json:"preferred_username"`
		Name              string         `json:"name"`
		OID               string         `json:"oid"`
		TenantID          string         `json:"tid"`
		Nonce             string         `json:"nonce"`
		Groups            []string       `json:"groups"`
		ClaimNames        map[string]any `json:"_claim_names"`
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
	subject := firstNonEmpty(claims.OID, claims.Subject)
	if subject == "" {
		return nil, fmt.Errorf("azure ad subject missing")
	}
	return &AzureADUser{
		Subject:       subject,
		ExternalID:    firstNonEmpty(claims.TenantID, strings.TrimSpace(cfg.TenantID)) + ":" + subject,
		Email:         strings.TrimSpace(claims.Email),
		Username:      username,
		DisplayName:   strings.TrimSpace(claims.Name),
		Groups:        claims.Groups,
		GroupsOverage: claims.ClaimNames["groups"] != nil,
	}, nil
}

// TestAzureADConnection checks what a sign-in needs, without a user: the tenant's
// OpenID configuration loads, and the client ID and secret are accepted by the
// token endpoint (a client-credentials request; the token is thrown away). A wrong
// or expired secret fails here instead of at the first sign-in.
func TestAzureADConnection(ctx context.Context, cfg models.AzureADConfig) error {
	switch {
	case strings.TrimSpace(cfg.TenantID) == "":
		return errors.New("tenant ID is required")
	case strings.TrimSpace(cfg.ClientID) == "":
		return errors.New("client ID is required")
	case strings.TrimSpace(cfg.ClientSecret) == "":
		return errors.New("client secret is required")
	}
	if u, err := url.Parse(strings.TrimSpace(cfg.RedirectURL)); err != nil || u.Host == "" ||
		(u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"))) {
		return errors.New("redirect URL must be an absolute https URL (http only for localhost), e.g. https://portal.example.com/api/auth/azure/callback")
	}
	provider, _, _, err := azureProvider(ctx, cfg)
	if err != nil {
		return fmt.Errorf("tenant: the OpenID configuration could not be loaded, check the tenant ID (%v)", err)
	}
	credentials := clientcredentials.Config{
		ClientID:     strings.TrimSpace(cfg.ClientID),
		ClientSecret: strings.TrimSpace(cfg.ClientSecret),
		TokenURL:     provider.Endpoint().TokenURL,
		Scopes:       []string{"https://graph.microsoft.com/.default"},
		AuthStyle:    oauth2.AuthStyleInParams,
	}
	if _, err := credentials.Token(ctx); err != nil {
		return explainTokenError(err)
	}
	return nil
}

// explainTokenError turns the token endpoint's refusal into what to fix. Azure's
// descriptions carry trace and correlation ids; only the first sentence is kept.
func explainTokenError(err error) error {
	var re *oauth2.RetrieveError
	if !errors.As(err, &re) {
		return fmt.Errorf("token endpoint: %v", err)
	}
	desc := re.ErrorDescription
	if i := strings.Index(desc, "\r\n"); i > 0 {
		desc = desc[:i]
	}
	if i := strings.Index(desc, "\n"); i > 0 {
		desc = desc[:i]
	}
	desc = strings.TrimSpace(desc)
	switch {
	case strings.Contains(desc, "AADSTS7000215"), strings.Contains(desc, "AADSTS7000222"):
		return fmt.Errorf("client secret rejected: it is wrong or has expired; use the secret's Value (not its ID) (%s)", desc)
	case strings.Contains(desc, "AADSTS700016"), re.ErrorCode == "unauthorized_client":
		return fmt.Errorf("client ID not found in this tenant (%s)", desc)
	case re.ErrorCode == "invalid_client":
		return fmt.Errorf("client ID or secret rejected (%s)", firstNonEmpty(desc, re.ErrorCode))
	}
	return fmt.Errorf("token endpoint refused the client: %s", firstNonEmpty(desc, re.ErrorCode, err.Error()))
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
	issuer := fmt.Sprintf("%s/%s/v2.0", azureAuthority, strings.TrimSpace(cfg.TenantID))
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

// InAllowedGroups reports whether the user may sign in under allowed (empty: anyone).
func (u *AzureADUser) InAllowedGroups(allowed []string) bool {
	if len(allowed) == 0 {
		return true
	}
	for _, group := range u.Groups {
		for _, want := range allowed {
			if strings.EqualFold(group, strings.TrimSpace(want)) {
				return true
			}
		}
	}
	return false
}

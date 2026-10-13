package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"api-portal/backend/internal/models"
)

// A fake Entra ID: the tenant's OpenID configuration and a token endpoint that
// accepts one client ID / secret pair, answering like Azure otherwise.
func fakeAzure(t *testing.T) {
	t.Helper()
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/tenant-1/v2.0/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"issuer":                 srv.URL + "/tenant-1/v2.0",
				"authorization_endpoint": srv.URL + "/tenant-1/oauth2/v2.0/authorize",
				"token_endpoint":         srv.URL + "/tenant-1/oauth2/v2.0/token",
				"jwks_uri":               srv.URL + "/tenant-1/discovery/v2.0/keys",
			})
		case r.URL.Path == "/tenant-1/oauth2/v2.0/token":
			_ = r.ParseForm()
			w.Header().Set("Content-Type", "application/json")
			switch {
			case r.Form.Get("client_id") != "app-1":
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"unauthorized_client","error_description":"AADSTS700016: Application with identifier 'x' was not found in the directory.\r\nTrace ID: 1"}`))
			case r.Form.Get("client_secret") != "right-secret":
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":"invalid_client","error_description":"AADSTS7000215: Invalid client secret provided.\r\nTrace ID: 2\r\nCorrelation ID: 3"}`))
			default:
				_, _ = w.Write([]byte(`{"access_token":"t","token_type":"Bearer","expires_in":3600}`))
			}
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	old := azureAuthority
	azureAuthority = srv.URL
	t.Cleanup(func() { azureAuthority = old })
}

func TestAzureADConnectionChecksTheSecret(t *testing.T) {
	fakeAzure(t)
	cfg := models.AzureADConfig{Enabled: true, TenantID: "tenant-1", ClientID: "app-1", ClientSecret: "right-secret", RedirectURL: "https://portal.example.com/api/auth/azure/callback"}
	if err := TestAzureADConnection(t.Context(), cfg); err != nil {
		t.Fatalf("valid configuration: %v", err)
	}
	for name, tc := range map[string]struct {
		mutate func(*models.AzureADConfig)
		want   string
	}{
		"wrong secret":   {func(c *models.AzureADConfig) { c.ClientSecret = "typo" }, "client secret rejected"},
		"unknown client": {func(c *models.AzureADConfig) { c.ClientID = "app-2" }, "client ID not found"},
		"unknown tenant": {func(c *models.AzureADConfig) { c.TenantID = "tenant-9" }, "check the tenant ID"},
		"no secret":      {func(c *models.AzureADConfig) { c.ClientSecret = " " }, "client secret is required"},
		"http redirect":  {func(c *models.AzureADConfig) { c.RedirectURL = "http://portal.example.com/cb" }, "redirect URL"},
	} {
		t.Run(name, func(t *testing.T) {
			c := cfg
			tc.mutate(&c)
			err := TestAzureADConnection(t.Context(), c)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("got %v, want %q", err, tc.want)
			}
			if strings.Contains(err.Error(), "Trace ID") || strings.Contains(err.Error(), "right-secret") {
				t.Fatalf("error leaks noise or the secret: %v", err)
			}
		})
	}
}

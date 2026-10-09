package proxy

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"api-portal/backend/internal/models"
	"api-portal/backend/internal/netguard"
)

type seen struct {
	method     string
	requestURI string
	header     http.Header
}

func newUpstream(t *testing.T, status int, location string) (*httptest.Server, *seen) {
	t.Helper()
	got := &seen{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.method = r.Method
		got.requestURI = r.RequestURI
		got.header = r.Header.Clone()
		if location != "" {
			w.Header().Set("Location", location)
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte("ok"))
	}))
	t.Cleanup(srv.Close)
	return srv, got
}

func newService() *Service {
	return New(netguard.New(nil, true).Client(5*time.Second, false), 1<<20, 1<<20)
}

func apiFor(baseURL string, prefixes ...string) models.APIDefinition {
	return models.APIDefinition{InternalBaseURL: baseURL + "/base", AllowedMethods: []string{"GET", "POST"}, AllowedPathPrefixes: prefixes}
}

func isPolicy(err error) bool {
	var p *PolicyError
	return errors.As(err, &p)
}

func TestHeaderFiltering(t *testing.T) {
	srv, got := newUpstream(t, 200, "")
	_, audited, err := newService().Invoke(context.Background(), apiFor(srv.URL), InvokeRequest{
		Method: "GET",
		Path:   "/v1/items",
		Headers: map[string]string{
			"X-Api-Key":              "secret-value",
			"X-HTTP-Method-Override": "DELETE",
			"X-Forwarded-For":        "10.0.0.1",
			"X-Original-URL":         "/admin",
			"Authorization":          "Bearer user-token",
			"Accept":                 "application/json",
		},
	})
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if got.header.Get("X-Api-Key") != "secret-value" {
		t.Error("X-Api-Key was not forwarded")
	}
	for _, name := range []string{"X-Http-Method-Override", "X-Forwarded-For", "X-Original-Url", "Authorization"} {
		if v := got.header.Get(name); v != "" {
			t.Errorf("%s reached the upstream: %q", name, v)
		}
	}
	if got.method != "GET" {
		t.Errorf("method = %s", got.method)
	}
	if audited["X-Api-Key"] != "***" {
		t.Errorf("audit kept the API key value: %q", audited["X-Api-Key"])
	}
	if audited["Accept"] != "application/json" {
		t.Errorf("audit lost a safe header: %v", audited)
	}
}

func TestPathAllowlistUsesSegmentBoundaries(t *testing.T) {
	srv, _ := newUpstream(t, 200, "")
	svc := newService()
	api := apiFor(srv.URL, "/v1")
	for path, allowed := range map[string]bool{
		"/v1":          true,
		"/v1/":         true,
		"/v1/items":    true,
		"/v1-admin":    false,
		"/v1admin/x":   false,
		"/v2/items":    false,
		"v1/items":     true, // leading slash is added
		"/v1/../admin": false,
	} {
		_, _, err := svc.Invoke(context.Background(), api, InvokeRequest{Method: "GET", Path: path})
		if allowed && err != nil {
			t.Errorf("%s: unexpected error %v", path, err)
		}
		if !allowed && !isPolicy(err) {
			t.Errorf("%s: expected a policy error, got %v", path, err)
		}
	}
}

func TestPathRejectsTraversalAndAmbiguity(t *testing.T) {
	srv, _ := newUpstream(t, 200, "")
	svc := newService()
	for _, path := range []string{"/v1/%2e%2e/admin", "/v1/..%2Fadmin", "/v1//x", `/v1\x`, "/v1/a%00b", "/v1/x?y=1", "/v1/%zz"} {
		if _, _, err := svc.Invoke(context.Background(), apiFor(srv.URL), InvokeRequest{Method: "GET", Path: path}); !isPolicy(err) {
			t.Errorf("%s: expected a policy error, got %v", path, err)
		}
	}
}

func TestEncodedPathParametersReachUpstreamUnchanged(t *testing.T) {
	srv, got := newUpstream(t, 200, "")
	// The UI sends path parameters through encodeURIComponent.
	_, _, err := newService().Invoke(context.Background(), apiFor(srv.URL), InvokeRequest{Method: "GET", Path: "/users/john%20doe/files/a%2Fb", Query: "q=a b&z=1"})
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if want := "/base/users/john%20doe/files/a%2Fb?q=a+b&z=1"; got.requestURI != want {
		t.Fatalf("upstream saw %q, want %q", got.requestURI, want)
	}
}

func TestMethodAllowlist(t *testing.T) {
	srv, _ := newUpstream(t, 200, "")
	if _, _, err := newService().Invoke(context.Background(), apiFor(srv.URL), InvokeRequest{Method: "DELETE", Path: "/x"}); !isPolicy(err) {
		t.Fatalf("DELETE: expected a policy error, got %v", err)
	}
}

func TestRedirectIsReturnedNotFollowed(t *testing.T) {
	srv, _ := newUpstream(t, http.StatusFound, "http://169.254.169.254/latest/meta-data/")
	resp, _, err := newService().Invoke(context.Background(), apiFor(srv.URL), InvokeRequest{Method: "GET", Path: "/x"})
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("status = %d, want 302 passed through", resp.StatusCode)
	}
}

package netguard

import (
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestAllowed(t *testing.T) {
	_, extra, _ := net.ParseCIDR("10.99.0.0/16")
	strict := New([]*net.IPNet{extra}, false)
	devMode := New(nil, true)

	cases := []struct {
		ip              string
		strict, devMode bool
	}{
		{"169.254.169.254", false, false}, // cloud metadata
		{"::ffff:169.254.169.254", false, false},
		{"fd00:ec2::254", false, false},
		{"0.0.0.0", false, false},
		{"127.0.0.1", false, true},
		{"::1", false, true},
		{"10.0.0.5", true, true}, // internal services are the point of the portal
		{"192.168.1.10", true, true},
		{"10.99.3.4", false, true}, // PROXY_DENY_CIDRS
		{"8.8.8.8", true, true},
	}
	for _, tc := range cases {
		ip := net.ParseIP(tc.ip)
		if got := strict.Allowed(ip); got != tc.strict {
			t.Errorf("strict.Allowed(%s) = %v, want %v", tc.ip, got, tc.strict)
		}
		if got := devMode.Allowed(ip); got != tc.devMode {
			t.Errorf("devMode.Allowed(%s) = %v, want %v", tc.ip, got, tc.devMode)
		}
	}
}

func TestClientRefusesLoopbackAtDialTime(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer upstream.Close()

	_, err := New(nil, false).Client(5*time.Second, false).Get(upstream.URL)
	if !errors.Is(err, ErrForbiddenAddress) {
		t.Fatalf("expected ErrForbiddenAddress, got %v", err)
	}
	resp, err := New(nil, true).Client(5*time.Second, false).Get(upstream.URL)
	if err != nil {
		t.Fatalf("loopback allowed client failed: %v", err)
	}
	resp.Body.Close()
}

func TestClientDoesNotFollowRedirectsWhenAsked(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://169.254.169.254/latest/meta-data/", http.StatusFound)
	}))
	defer upstream.Close()

	resp, err := New(nil, true).Client(5*time.Second, false).Get(upstream.URL)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("status = %d, want the 302 itself", resp.StatusCode)
	}
}

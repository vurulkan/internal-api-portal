// Package netguard builds HTTP clients that refuse to connect to addresses an
// upstream must never be: link-local / cloud metadata endpoints, loopback and
// "this host". The check runs on the resolved IP at dial time, so a hostname that
// resolves (or re-resolves) to a forbidden address is caught too.
//
// Private ranges (10/8, 172.16/12, 192.168/16, fc00::/7) are allowed on purpose:
// the portal exists to reach internal services.
package netguard

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"syscall"
	"time"
)

// ErrForbiddenAddress is returned (wrapped) when a dial target is blocked.
var ErrForbiddenAddress = errors.New("upstream address is not allowed")

var defaultDeny = mustCIDRs(
	"0.0.0.0/8",          // "this host"; dialing 0.0.0.0 reaches localhost
	"169.254.0.0/16",     // link-local, incl. 169.254.169.254 (AWS / GCP / Azure IMDS)
	"100.100.100.200/32", // Alibaba Cloud metadata
	"168.63.129.16/32",   // Azure WireServer
	"::/128",             // unspecified
	"fe80::/10",          // link-local
	"fd00:ec2::254/128",  // AWS IMDS over IPv6
)

var loopback = mustCIDRs("127.0.0.0/8", "::1/128")

type Guard struct {
	deny []*net.IPNet
}

// New returns a guard that blocks the default list, loopback unless allowLoopback,
// and every network in extraDeny.
func New(extraDeny []*net.IPNet, allowLoopback bool) *Guard {
	deny := append([]*net.IPNet{}, defaultDeny...)
	if !allowLoopback {
		deny = append(deny, loopback...)
	}
	deny = append(deny, extraDeny...)
	return &Guard{deny: deny}
}

// Allowed reports whether ip may be dialed.
func (g *Guard) Allowed(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	for _, network := range g.deny {
		if network.Contains(ip) {
			return false
		}
	}
	return true
}

// control runs after DNS resolution, once per address the dialer tries.
func (g *Guard) control(_, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("%w: %s", ErrForbiddenAddress, address)
	}
	if !g.Allowed(net.ParseIP(host)) {
		return fmt.Errorf("%w: %s", ErrForbiddenAddress, host)
	}
	return nil
}

// Client returns an HTTP client whose connections go through the guard. When
// followRedirects is false, 3xx responses are returned to the caller as-is.
// Proxies from the environment are not used: an explicit proxy would make the
// guard check the proxy's address instead of the upstream's.
func (g *Guard) Client(timeout time.Duration, followRedirects bool) *http.Client {
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second, Control: g.control}
	transport := &http.Transport{
		Proxy:                 nil,
		DialContext:           dialer.DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: time.Second,
	}
	client := &http.Client{Timeout: timeout, Transport: transport}
	if !followRedirects {
		client.CheckRedirect = func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}
	}
	return client
}

func mustCIDRs(values ...string) []*net.IPNet {
	out := make([]*net.IPNet, 0, len(values))
	for _, value := range values {
		_, network, err := net.ParseCIDR(value)
		if err != nil {
			panic(err)
		}
		out = append(out, network)
	}
	return out
}

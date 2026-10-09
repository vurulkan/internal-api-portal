package metrics

// Portal holds the metrics the API server records.
type Portal struct {
	Registry *Registry

	HTTPRequests     *CounterVec   // route, method, code
	HTTPDuration     *HistogramVec // route, method
	Invocations      *CounterVec   // api, outcome (ok, upstream_error, blocked, timeout)
	UpstreamDuration *HistogramVec // api
	SpecRefreshes    *CounterVec   // outcome (ok, error)
	Logins           *CounterVec   // source, outcome (success, failed, locked)
}

func NewPortal() *Portal {
	r := NewRegistry()
	return &Portal{
		Registry:         r,
		HTTPRequests:     r.NewCounterVec("portal_http_requests_total", "HTTP requests by route pattern, method and status code.", "route", "method", "code"),
		HTTPDuration:     r.NewHistogramVec("portal_http_request_duration_seconds", "HTTP request latency by route pattern and method.", DefaultBuckets, "route", "method"),
		Invocations:      r.NewCounterVec("portal_invoke_total", "Try-it invocations by API id and outcome.", "api", "outcome"),
		UpstreamDuration: r.NewHistogramVec("portal_invoke_upstream_duration_seconds", "Upstream latency of try-it invocations by API id.", DefaultBuckets, "api"),
		SpecRefreshes:    r.NewCounterVec("portal_spec_refresh_total", "OpenAPI spec fetches by outcome.", "outcome"),
		Logins:           r.NewCounterVec("portal_login_total", "Sign-in attempts by identity source and outcome.", "source", "outcome"),
	}
}

package proxy

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"

	"api-portal/backend/internal/models"
)

type Service struct {
	client           *http.Client
	maxRequestBytes  int64
	maxResponseBytes int64
}

type InvokeRequest struct {
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Query   string            `json:"query"`
	Headers map[string]string `json:"headers"`
	BodyB64 string            `json:"bodyBase64"`
}

type InvokeResponse struct {
	StatusCode    int               `json:"statusCode"`
	Headers       map[string]string `json:"headers"`
	BodyB64       string            `json:"bodyBase64"`
	ContentType   string            `json:"contentType"`
	Truncated     bool              `json:"truncated"`
	RequestBytes  int64             `json:"requestBytes"`
	ResponseBytes int64             `json:"responseBytes"`
}

// PolicyError is a request the API definition doesn't allow (method, path, query).
// Handlers report it as 403/400 with its message; other errors are upstream failures.
type PolicyError struct{ Reason string }

func (e *PolicyError) Error() string { return e.Reason }

func policy(format string, args ...any) error {
	return &PolicyError{Reason: fmt.Sprintf(format, args...)}
}

// New takes the HTTP client to use upstream. It should not follow redirects (an
// upstream could otherwise bounce the request to any host) and should dial through
// netguard; see netguard.Guard.Client.
func New(client *http.Client, maxRequestBytes, maxResponseBytes int64) *Service {
	return &Service{
		client:           client,
		maxRequestBytes:  maxRequestBytes,
		maxResponseBytes: maxResponseBytes,
	}
}

func (s *Service) Invoke(ctx context.Context, api models.APIDefinition, payload InvokeRequest) (*InvokeResponse, map[string]string, error) {
	method := strings.ToUpper(strings.TrimSpace(payload.Method))
	if method == "" {
		return nil, nil, policy("method required")
	}
	if len(api.AllowedMethods) > 0 && !containsFold(api.AllowedMethods, method) {
		return nil, nil, policy("method %s is not allowed for this API", method)
	}
	escapedPath, decodedPath, err := parseRequestPath(payload.Path)
	if err != nil {
		return nil, nil, err
	}
	if len(api.AllowedPathPrefixes) > 0 && !matchesPrefix(decodedPath, api.AllowedPathPrefixes) {
		return nil, nil, policy("path %s is not in this API's allowlist", decodedPath)
	}
	query, err := normalizeQuery(payload.Query)
	if err != nil {
		return nil, nil, policy("invalid query string")
	}

	baseURL, err := url.Parse(api.InternalBaseURL)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid upstream base URL")
	}
	target := *baseURL
	// Path is what was validated; RawPath keeps the client's encoding (e.g. %2F inside
	// a path parameter) so the upstream receives it unchanged, not double-encoded.
	target.Path = joinURLPath(baseURL.Path, decodedPath)
	target.RawPath = joinURLPath(baseURL.EscapedPath(), escapedPath)
	target.RawQuery = query

	bodyBytes, err := decodeBody(payload.BodyB64)
	if err != nil {
		return nil, nil, policy("request body is not valid base64")
	}
	if int64(len(bodyBytes)) > s.maxRequestBytes {
		return nil, nil, policy("request body exceeds %d bytes", s.maxRequestBytes)
	}

	req, err := http.NewRequestWithContext(ctx, method, target.String(), bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, nil, err
	}
	for name, value := range filterRequestHeaders(payload.Headers) {
		req.Header.Set(name, value)
	}
	req.Header.Set("X-Forwarded-By", "internal-api-portal")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, sanitizeHeaders(req.Header), err
	}
	defer resp.Body.Close()

	reader := io.LimitReader(resp.Body, s.maxResponseBytes+1)
	responseBody, err := io.ReadAll(reader)
	if err != nil {
		return nil, sanitizeHeaders(req.Header), err
	}
	truncated := int64(len(responseBody)) > s.maxResponseBytes
	if truncated {
		responseBody = responseBody[:s.maxResponseBytes]
	}

	headers := map[string]string{}
	for key, values := range resp.Header {
		if hopByHopHeader(key) {
			continue
		}
		headers[key] = strings.Join(values, ", ")
	}

	return &InvokeResponse{
		StatusCode:    resp.StatusCode,
		Headers:       headers,
		BodyB64:       base64.StdEncoding.EncodeToString(responseBody),
		ContentType:   resp.Header.Get("Content-Type"),
		Truncated:     truncated,
		RequestBytes:  int64(len(bodyBytes)),
		ResponseBytes: int64(len(responseBody)),
	}, sanitizeHeaders(req.Header), nil
}

// parseRequestPath treats the client path as already percent-encoded (the UI encodes
// path parameters) and returns it with its decoded form. Inputs whose meaning could
// differ between the portal and the upstream are refused: dot segments (literal or
// encoded), empty segments ("//"), backslashes and control characters.
func parseRequestPath(raw string) (escaped, decoded string, err error) {
	escaped = strings.TrimSpace(raw)
	if escaped == "" {
		return "", "", policy("path required")
	}
	if !strings.HasPrefix(escaped, "/") {
		escaped = "/" + escaped
	}
	if strings.ContainsAny(escaped, "?#") {
		return "", "", policy("path must not contain a query or fragment; use the query field")
	}
	decoded, err = url.PathUnescape(escaped)
	if err != nil {
		return "", "", policy("path is not valid percent-encoding")
	}
	if strings.Contains(decoded, "\\") || strings.Contains(decoded, "//") {
		return "", "", policy("path must not contain backslashes or empty segments")
	}
	for _, segment := range strings.Split(decoded, "/") {
		if segment == "." || segment == ".." {
			return "", "", policy("path must not contain dot segments")
		}
	}
	for _, r := range decoded {
		if r < 0x20 || r == 0x7f {
			return "", "", policy("path must not contain control characters")
		}
	}
	return escaped, decoded, nil
}

// normalizeQuery parses and re-encodes the query so what the upstream receives is
// exactly what was validated and audited.
func normalizeQuery(raw string) (string, error) {
	raw = strings.TrimPrefix(strings.TrimSpace(raw), "?")
	if raw == "" {
		return "", nil
	}
	values, err := url.ParseQuery(raw)
	if err != nil {
		return "", err
	}
	return values.Encode(), nil
}

func normalizePath(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	clean := path.Clean("/" + raw)
	if !strings.HasPrefix(clean, "/") {
		return ""
	}
	return clean
}

func joinURLPath(basePath, requestPath string) string {
	if requestPath == "/" {
		return strings.TrimSuffix(basePath, "/")
	}
	return strings.TrimSuffix(basePath, "/") + requestPath
}

func decodeBody(encoded string) ([]byte, error) {
	if encoded == "" {
		return nil, nil
	}
	return base64.StdEncoding.DecodeString(encoded)
}

// deniedRequestHeaders never reach the upstream, even though they match the X-*
// rule: they change routing, the method, or the client identity the upstream sees.
var deniedRequestHeaders = map[string]bool{
	"x-forwarded-for":        true,
	"x-forwarded-host":       true,
	"x-forwarded-proto":      true,
	"x-forwarded-port":       true,
	"x-forwarded-prefix":     true,
	"x-forwarded-server":     true,
	"x-forwarded-by":         true,
	"x-real-ip":              true,
	"x-client-ip":            true,
	"x-http-method-override": true,
	"x-http-method":          true,
	"x-method-override":      true,
	"x-original-method":      true,
	"x-original-url":         true,
	"x-rewrite-url":          true,
	"x-original-uri":         true,
	"x-host":                 true,
}

func filterRequestHeaders(headers map[string]string) map[string]string {
	out := map[string]string{}
	for key, value := range headers {
		if value == "" {
			continue
		}
		lower := strings.ToLower(strings.TrimSpace(key))
		if deniedRequestHeaders[lower] || strings.HasPrefix(lower, "x-forwarded-") {
			continue
		}
		if lower == "content-type" || lower == "accept" || lower == "accept-language" || lower == "user-agent" || strings.HasPrefix(lower, "x-") {
			out[http.CanonicalHeaderKey(key)] = value
		}
	}
	return out
}

// auditSafeHeaders are stored with their value; every other header keeps its name
// and has the value masked, since users put API keys in arbitrary X-* headers.
var auditSafeHeaders = map[string]bool{
	"content-type":    true,
	"accept":          true,
	"accept-language": true,
	"user-agent":      true,
	"x-forwarded-by":  true,
}

func sanitizeHeaders(headers http.Header) map[string]string {
	out := map[string]string{}
	for key, values := range headers {
		if auditSafeHeaders[strings.ToLower(key)] {
			out[key] = strings.Join(values, ", ")
			continue
		}
		out[key] = "***"
	}
	return out
}

func hopByHopHeader(name string) bool {
	switch strings.ToLower(name) {
	case "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade", "set-cookie":
		return true
	default:
		return false
	}
}

func containsFold(values []string, target string) bool {
	for _, value := range values {
		if strings.EqualFold(value, target) {
			return true
		}
	}
	return false
}

// matchesPrefix compares on segment boundaries: "/v1" allows "/v1" and "/v1/x",
// not "/v1-admin".
func matchesPrefix(path string, prefixes []string) bool {
	for _, prefix := range prefixes {
		normalized := normalizePath(prefix)
		if normalized == "" {
			continue
		}
		if normalized == "/" || path == normalized || strings.HasPrefix(path, normalized+"/") {
			return true
		}
	}
	return false
}

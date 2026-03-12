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
	"time"

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
	StatusCode   int               `json:"statusCode"`
	Headers      map[string]string `json:"headers"`
	BodyB64      string            `json:"bodyBase64"`
	ContentType  string            `json:"contentType"`
	Truncated    bool              `json:"truncated"`
	RequestBytes int64             `json:"requestBytes"`
	ResponseBytes int64            `json:"responseBytes"`
}

func New(timeout time.Duration, maxRequestBytes, maxResponseBytes int64) *Service {
	return &Service{
		client: &http.Client{Timeout: timeout},
		maxRequestBytes: maxRequestBytes,
		maxResponseBytes: maxResponseBytes,
	}
}

func (s *Service) Invoke(ctx context.Context, api models.APIDefinition, payload InvokeRequest) (*InvokeResponse, map[string]string, error) {
	method := strings.ToUpper(strings.TrimSpace(payload.Method))
	if method == "" {
		return nil, nil, fmt.Errorf("method required")
	}
	if len(api.AllowedMethods) > 0 && !containsFold(api.AllowedMethods, method) {
		return nil, nil, fmt.Errorf("method not allowed")
	}
	cleanPath := normalizePath(payload.Path)
	if cleanPath == "" {
		return nil, nil, fmt.Errorf("path required")
	}
	if len(api.AllowedPathPrefixes) > 0 && !matchesPrefix(cleanPath, api.AllowedPathPrefixes) {
		return nil, nil, fmt.Errorf("path not allowed")
	}

	baseURL, err := url.Parse(api.InternalBaseURL)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid upstream base URL")
	}
	target := *baseURL
	target.Path = joinURLPath(baseURL.Path, cleanPath)
	target.RawQuery = payload.Query

	bodyBytes, err := decodeBody(payload.BodyB64)
	if err != nil {
		return nil, nil, err
	}
	if int64(len(bodyBytes)) > s.maxRequestBytes {
		return nil, nil, fmt.Errorf("request too large")
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
		StatusCode:   resp.StatusCode,
		Headers:      headers,
		BodyB64:      base64.StdEncoding.EncodeToString(responseBody),
		ContentType:  resp.Header.Get("Content-Type"),
		Truncated:    truncated,
		RequestBytes: int64(len(bodyBytes)),
		ResponseBytes: int64(len(responseBody)),
	}, sanitizeHeaders(req.Header), nil
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

func filterRequestHeaders(headers map[string]string) map[string]string {
	out := map[string]string{}
	for key, value := range headers {
		if value == "" {
			continue
		}
		lower := strings.ToLower(key)
		if lower == "authorization" || lower == "cookie" || lower == "set-cookie" || lower == "host" {
			continue
		}
		if lower == "content-type" || lower == "accept" || lower == "accept-language" || lower == "user-agent" || strings.HasPrefix(lower, "x-") {
			out[key] = value
		}
	}
	return out
}

func sanitizeHeaders(headers http.Header) map[string]string {
	out := map[string]string{}
	for key, values := range headers {
		lower := strings.ToLower(key)
		if lower == "authorization" || lower == "cookie" || lower == "set-cookie" {
			out[key] = "***"
			continue
		}
		out[key] = strings.Join(values, ", ")
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

func matchesPrefix(path string, prefixes []string) bool {
	for _, prefix := range prefixes {
		normalized := normalizePath(prefix)
		if normalized != "" && strings.HasPrefix(path, normalized) {
			return true
		}
	}
	return false
}

package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"api-portal/backend/internal/logging"
)

// errorBody is the one error shape every API endpoint returns:
//
//	{"error": "human-readable message", "code": "forbidden", "requestId": "..."}
//
// The message is safe to show to the user. Internal details (LDAP, OIDC, upstream
// errors) go to the log under the same request id, not into the response.
type errorBody struct {
	Error     string `json:"error"`
	Code      string `json:"code"`
	RequestID string `json:"requestId,omitempty"`
}

func writeError(w http.ResponseWriter, r *http.Request, status int, message string) {
	writeJSON(w, status, errorBody{Error: message, Code: errorCode(status), RequestID: logging.RequestID(r.Context())})
}

func errorCode(status int) string {
	switch status {
	case http.StatusBadRequest:
		return "bad_request"
	case http.StatusUnauthorized:
		return "unauthorized"
	case http.StatusForbidden:
		return "forbidden"
	case http.StatusNotFound:
		return "not_found"
	case http.StatusMethodNotAllowed:
		return "method_not_allowed"
	case http.StatusConflict:
		return "conflict"
	case http.StatusRequestEntityTooLarge:
		return "payload_too_large"
	case http.StatusTooManyRequests:
		return "rate_limited"
	case http.StatusBadGateway:
		return "upstream_error"
	case http.StatusServiceUnavailable:
		return "unavailable"
	case http.StatusGatewayTimeout:
		return "upstream_timeout"
	}
	if status >= 500 {
		return "internal_error"
	}
	return "error"
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

// maxJSONBody bounds every JSON request body. The largest legitimate one is a try-it
// invocation: MAX_REQUEST_BYTES (1 MiB default) base64-encoded.
const maxJSONBody = 2 << 20

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	defer r.Body.Close()
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBody)).Decode(target); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, r, http.StatusRequestEntityTooLarge, "request body is too large")
			return false
		}
		writeError(w, r, http.StatusBadRequest, "invalid json payload")
		return false
	}
	return true
}

func marshalJSON(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(data)
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func cookieValue(r *http.Request, name string) string {
	cookie, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	return cookie.Value
}

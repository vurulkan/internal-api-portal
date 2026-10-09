package api

import (
	"encoding/base64"
	"io"
	"net/http"
	"strings"
	"time"

	"api-portal/backend/internal/models"
)

func (s *Server) handleGetSession(w http.ResponseWriter, r *http.Request) {
	session, err := s.store.GetSessionSettings(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load session settings")
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (s *Server) handleUpdateSession(w http.ResponseWriter, r *http.Request) {
	var payload models.SessionSettings
	if !decodeJSON(w, r, &payload) {
		return
	}
	current, err := s.store.GetSessionSettings(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load session settings")
		return
	}
	if payload.MaxHours == 0 {
		payload.MaxHours = current.MaxHours // older clients only send sessionMinutes
	}
	switch {
	case payload.SessionMinutes < 5 || payload.SessionMinutes > 24*60:
		writeError(w, r, http.StatusBadRequest, "idle timeout must be between 5 minutes and 24 hours")
		return
	case payload.MaxHours < 1 || payload.MaxHours > 30*24:
		writeError(w, r, http.StatusBadRequest, "maximum session age must be between 1 hour and 30 days")
		return
	case time.Duration(payload.SessionMinutes)*time.Minute > time.Duration(payload.MaxHours)*time.Hour:
		writeError(w, r, http.StatusBadRequest, "the idle timeout can't be longer than the maximum session age")
		return
	}
	if err := s.store.UpdateSessionSettings(r.Context(), payload); err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to update session settings")
		return
	}
	s.recordAudit(r, models.AuditLog{Action: "admin.session.update", ResourceType: "settings", StatusCode: http.StatusOK, DetailsJSON: marshalJSON(payload)})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleGetSystem(w http.ResponseWriter, r *http.Request) {
	settings, err := s.store.GetSystemSettings(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load settings")
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

// handleUpdateSystem changes the brand title. The logo is only changed through the
// upload / delete endpoints, which validate the image; a logoDataUrl in this payload
// is ignored.
func (s *Server) handleUpdateSystem(w http.ResponseWriter, r *http.Request) {
	var payload models.SystemSettings
	if !decodeJSON(w, r, &payload) {
		return
	}
	title := strings.TrimSpace(payload.BrandTitle)
	if len([]rune(title)) > 100 {
		writeError(w, r, http.StatusBadRequest, "brand title is too long (max 100 characters)")
		return
	}
	settings, err := s.store.GetSystemSettings(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load settings")
		return
	}
	settings.BrandTitle = title
	if err := s.store.UpdateSystemSettings(r.Context(), *settings); err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to update settings")
		return
	}
	s.recordAudit(r, models.AuditLog{Action: "admin.system.update", ResourceType: "settings", StatusCode: http.StatusOK, DetailsJSON: marshalJSON(map[string]string{"brandTitle": title})})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleUploadSystemLogo(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 512*1024)
	if err := r.ParseMultipartForm(512 * 1024); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid multipart payload")
		return
	}
	file, header, err := r.FormFile("logo")
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "logo file is required")
		return
	}
	defer file.Close()

	if header.Size <= 0 || header.Size > 256*1024 {
		writeError(w, r, http.StatusBadRequest, "logo file too large")
		return
	}

	content, err := io.ReadAll(io.LimitReader(file, 256*1024+1))
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "failed to read logo file")
		return
	}
	if len(content) == 0 || len(content) > 256*1024 {
		writeError(w, r, http.StatusBadRequest, "logo file too large")
		return
	}

	// Sniffed, not taken from the client. SVG is refused: it can carry script.
	contentType := http.DetectContentType(content)
	if !allowedLogoContentType(contentType) {
		writeError(w, r, http.StatusBadRequest, "unsupported logo type (use PNG, JPEG or WEBP)")
		return
	}

	dataURL := "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(content)
	if !validLogo(dataURL) {
		writeError(w, r, http.StatusBadRequest, "invalid logo data")
		return
	}

	settings, err := s.store.GetSystemSettings(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load settings")
		return
	}
	settings.LogoDataURL = dataURL
	if err := s.store.UpdateSystemSettings(r.Context(), *settings); err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to store logo")
		return
	}
	s.recordAudit(r, models.AuditLog{Action: "admin.system.logo.update", ResourceType: "settings", StatusCode: http.StatusOK, DetailsJSON: marshalJSON(map[string]any{"contentType": contentType, "bytes": len(content)})})
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleDeleteSystemLogo(w http.ResponseWriter, r *http.Request) {
	settings, err := s.store.GetSystemSettings(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load settings")
		return
	}
	settings.LogoDataURL = ""
	if err := s.store.UpdateSystemSettings(r.Context(), *settings); err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to remove logo")
		return
	}
	s.recordAudit(r, models.AuditLog{Action: "admin.system.logo.delete", ResourceType: "settings", StatusCode: http.StatusOK})
	writeJSON(w, http.StatusOK, settings)
}

// validLogo bounds the data URL to a base64-encoded 256 KB raster image.
func validLogo(dataURL string) bool {
	if len(dataURL) > 360*1024 {
		return false
	}
	return strings.HasPrefix(dataURL, "data:image/png;base64,") ||
		strings.HasPrefix(dataURL, "data:image/jpeg;base64,") ||
		strings.HasPrefix(dataURL, "data:image/webp;base64,")
}

func allowedLogoContentType(contentType string) bool {
	switch contentType {
	case "image/png", "image/jpeg", "image/webp":
		return true
	default:
		return false
	}
}

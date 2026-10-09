package api

import (
	"encoding/base64"
	"io"
	"net/http"
	"strings"

	"api-portal/backend/internal/models"
)

func (s *Server) handleGetSession(w http.ResponseWriter, r *http.Request) {
	session, err := s.store.GetSessionSettings(r.Context())
	if err != nil {
		http.Error(w, "failed to load session settings", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (s *Server) handleUpdateSession(w http.ResponseWriter, r *http.Request) {
	var session models.SessionSettings
	if !decodeJSON(w, r, &session) {
		return
	}
	if session.SessionMinutes < 5 {
		http.Error(w, "session timeout too low", http.StatusBadRequest)
		return
	}
	if err := s.store.UpdateSessionSettings(r.Context(), session); err != nil {
		http.Error(w, "failed to update session settings", http.StatusBadRequest)
		return
	}
	s.recordAudit(r, models.AuditLog{Action: "admin.session.update", ResourceType: "settings", StatusCode: http.StatusOK, DetailsJSON: marshalJSON(session)})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleGetSystem(w http.ResponseWriter, r *http.Request) {
	settings, err := s.store.GetSystemSettings(r.Context())
	if err != nil {
		http.Error(w, "failed to load settings", http.StatusInternalServerError)
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
		http.Error(w, "brand title is too long (max 100 characters)", http.StatusBadRequest)
		return
	}
	settings, err := s.store.GetSystemSettings(r.Context())
	if err != nil {
		http.Error(w, "failed to load settings", http.StatusInternalServerError)
		return
	}
	settings.BrandTitle = title
	if err := s.store.UpdateSystemSettings(r.Context(), *settings); err != nil {
		http.Error(w, "failed to update settings", http.StatusBadRequest)
		return
	}
	s.recordAudit(r, models.AuditLog{Action: "admin.system.update", ResourceType: "settings", StatusCode: http.StatusOK, DetailsJSON: marshalJSON(map[string]string{"brandTitle": title})})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleUploadSystemLogo(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 512*1024)
	if err := r.ParseMultipartForm(512 * 1024); err != nil {
		http.Error(w, "invalid multipart payload", http.StatusBadRequest)
		return
	}
	file, header, err := r.FormFile("logo")
	if err != nil {
		http.Error(w, "logo file is required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	if header.Size <= 0 || header.Size > 256*1024 {
		http.Error(w, "logo file too large", http.StatusBadRequest)
		return
	}

	content, err := io.ReadAll(io.LimitReader(file, 256*1024+1))
	if err != nil {
		http.Error(w, "failed to read logo file", http.StatusBadRequest)
		return
	}
	if len(content) == 0 || len(content) > 256*1024 {
		http.Error(w, "logo file too large", http.StatusBadRequest)
		return
	}

	// Sniffed, not taken from the client. SVG is refused: it can carry script.
	contentType := http.DetectContentType(content)
	if !allowedLogoContentType(contentType) {
		http.Error(w, "unsupported logo type (use PNG, JPEG or WEBP)", http.StatusBadRequest)
		return
	}

	dataURL := "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(content)
	if !validLogo(dataURL) {
		http.Error(w, "invalid logo data", http.StatusBadRequest)
		return
	}

	settings, err := s.store.GetSystemSettings(r.Context())
	if err != nil {
		http.Error(w, "failed to load settings", http.StatusInternalServerError)
		return
	}
	settings.LogoDataURL = dataURL
	if err := s.store.UpdateSystemSettings(r.Context(), *settings); err != nil {
		http.Error(w, "failed to store logo", http.StatusInternalServerError)
		return
	}
	s.recordAudit(r, models.AuditLog{Action: "admin.system.logo.update", ResourceType: "settings", StatusCode: http.StatusOK, DetailsJSON: marshalJSON(map[string]any{"contentType": contentType, "bytes": len(content)})})
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleDeleteSystemLogo(w http.ResponseWriter, r *http.Request) {
	settings, err := s.store.GetSystemSettings(r.Context())
	if err != nil {
		http.Error(w, "failed to load settings", http.StatusInternalServerError)
		return
	}
	settings.LogoDataURL = ""
	if err := s.store.UpdateSystemSettings(r.Context(), *settings); err != nil {
		http.Error(w, "failed to remove logo", http.StatusInternalServerError)
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

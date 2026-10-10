package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"api-portal/backend/internal/models"
)

// activeSessions lists sessions of userID (0: everyone) that are still usable,
// marking the caller's own.
func (s *Server) activeSessions(r *http.Request, userID int) ([]models.Session, error) {
	now := time.Now().UTC()
	sessions, err := s.store.ListActiveSessions(r.Context(), userID, now)
	if err != nil {
		return nil, err
	}
	idle, _ := s.sessionTimeouts(r.Context())
	current := currentSession(r)
	out := make([]models.Session, 0, len(sessions))
	for _, session := range sessions {
		if now.Sub(session.LastUsedAt) > idle {
			continue
		}
		session.Current = current != nil && session.ID == current.ID
		out = append(out, session)
	}
	return out, nil
}

func (s *Server) handleMySessions(w http.ResponseWriter, r *http.Request) {
	identity, _ := s.identityForRequest(r)
	sessions, err := s.activeSessions(r, identity.User.ID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "could not load sessions")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": sessions})
}

func (s *Server) handleRevokeMySession(w http.ResponseWriter, r *http.Request) {
	identity, _ := s.identityForRequest(r)
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	auditTarget(r, "session", strconv.Itoa(id), "")
	session, err := s.store.GetSession(r.Context(), id)
	if err != nil || session.UserID != identity.User.ID {
		writeError(w, r, http.StatusNotFound, "session not found")
		return
	}
	s.revokeSession(w, r, session)
}

func (s *Server) handleRevokeMyOtherSessions(w http.ResponseWriter, r *http.Request) {
	identity, _ := s.identityForRequest(r)
	revoked, err := s.store.RevokeUserSessions(r.Context(), identity.User.ID, currentSession(r).ID, time.Now().UTC())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "could not end the sessions")
		return
	}
	auditTarget(r, "session", "", "")
	auditDetails(r, map[string]int{"sessionsRevoked": revoked})
	writeJSON(w, http.StatusOK, map[string]int{"sessionsRevoked": revoked})
}

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	sessions, err := s.activeSessions(r, 0)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "could not load sessions")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": sessions})
}

func (s *Server) handleRevokeSession(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	auditTarget(r, "session", strconv.Itoa(id), "")
	session, err := s.store.GetSession(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "session not found")
		return
	}
	s.revokeSession(w, r, session)
}

func (s *Server) revokeSession(w http.ResponseWriter, r *http.Request, session *models.Session) {
	if err := s.store.RevokeSession(r.Context(), session.ID, time.Now().UTC()); err != nil {
		writeError(w, r, http.StatusInternalServerError, "could not end the session")
		return
	}
	if current := currentSession(r); current != nil && current.ID == session.ID {
		s.clearSessionCookies(w, r)
	}
	auditTarget(r, "session", strconv.Itoa(session.ID), session.Username)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

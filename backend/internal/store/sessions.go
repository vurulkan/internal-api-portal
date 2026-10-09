package store

import (
	"context"
	"database/sql"
	"time"

	"api-portal/backend/internal/models"
)

const sessionColumns = `s.id, s.user_id, u.username, s.auth_source, s.created_at, s.last_used_at, s.expires_at, s.revoked_at, s.ip, s.user_agent`

func (s *Store) CreateSession(ctx context.Context, tokenHash string, session models.Session) (int, error) {
	result, err := s.conn.ExecContext(ctx, `INSERT INTO sessions (token_hash, user_id, auth_source, created_at, last_used_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		tokenHash, session.UserID, session.AuthSource, session.CreatedAt, session.LastUsedAt, session.ExpiresAt, session.IP, session.UserAgent)
	if err != nil {
		return 0, err
	}
	id, _ := result.LastInsertId()
	return int(id), nil
}

// GetSessionByHash returns sql.ErrNoRows for unknown tokens.
func (s *Store) GetSessionByHash(ctx context.Context, tokenHash string) (*models.Session, error) {
	row := s.conn.QueryRowContext(ctx, `SELECT `+sessionColumns+` FROM sessions s INNER JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, tokenHash)
	return scanSession(row)
}

func (s *Store) GetSession(ctx context.Context, id int) (*models.Session, error) {
	row := s.conn.QueryRowContext(ctx, `SELECT `+sessionColumns+` FROM sessions s INNER JOIN users u ON u.id = s.user_id WHERE s.id = ?`, id)
	return scanSession(row)
}

func (s *Store) TouchSession(ctx context.Context, id int, at time.Time) error {
	_, err := s.conn.ExecContext(ctx, `UPDATE sessions SET last_used_at = ? WHERE id = ?`, at, id)
	return err
}

// ListActiveSessions returns sessions that are not revoked and not past their
// absolute expiry, newest first; userID 0 lists everyone's. Idle expiry is applied
// by the caller, which knows the timeout.
func (s *Store) ListActiveSessions(ctx context.Context, userID int, now time.Time) ([]models.Session, error) {
	query := `SELECT ` + sessionColumns + ` FROM sessions s INNER JOIN users u ON u.id = s.user_id WHERE s.revoked_at IS NULL AND s.expires_at > ?`
	args := []any{now}
	if userID > 0 {
		query += ` AND s.user_id = ?`
		args = append(args, userID)
	}
	rows, err := s.conn.QueryContext(ctx, query+` ORDER BY s.last_used_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.Session{}
	for rows.Next() {
		session, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *session)
	}
	return out, rows.Err()
}

func (s *Store) RevokeSession(ctx context.Context, id int, at time.Time) error {
	_, err := s.conn.ExecContext(ctx, `UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, at, id)
	return err
}

// RevokeUserSessions ends every session of the user except exceptID (0 for none)
// and returns how many it ended.
func (s *Store) RevokeUserSessions(ctx context.Context, userID, exceptID int, at time.Time) (int, error) {
	result, err := s.conn.ExecContext(ctx, `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL`, at, userID, exceptID)
	if err != nil {
		return 0, err
	}
	n, _ := result.RowsAffected()
	return int(n), nil
}

// PurgeSessions deletes sessions that ended (expired or revoked) before cutoff.
func (s *Store) PurgeSessions(ctx context.Context, cutoff time.Time) error {
	_, err := s.conn.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`, cutoff, cutoff)
	return err
}

func scanSession(scanner interface{ Scan(...any) error }) (*models.Session, error) {
	var session models.Session
	var revoked sql.NullTime
	if err := scanner.Scan(&session.ID, &session.UserID, &session.Username, &session.AuthSource, &session.CreatedAt, &session.LastUsedAt, &session.ExpiresAt, &revoked, &session.IP, &session.UserAgent); err != nil {
		return nil, err
	}
	if revoked.Valid {
		t := revoked.Time
		session.RevokedAt = &t
	}
	return &session, nil
}

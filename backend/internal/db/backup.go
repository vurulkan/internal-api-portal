package db

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const backupPrefix = "app-"

// Backup writes a consistent copy of the database to dir with VACUUM INTO (safe
// while the server is running and with WAL: the copy is a single self-contained
// file) and keeps the newest keep copies. It returns the new file's path.
func Backup(ctx context.Context, conn *sql.DB, dir string, keep int) (string, error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", err
	}
	name := backupPrefix + time.Now().UTC().Format("20060102-150405") + ".db"
	path := filepath.Join(dir, name)
	if _, err := os.Stat(path); err == nil {
		return "", fmt.Errorf("backup %s already exists", path)
	}
	if _, err := conn.ExecContext(ctx, `VACUUM INTO ?`, path); err != nil {
		return "", fmt.Errorf("vacuum into %s: %w", path, err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return "", err
	}
	if keep > 0 {
		if err := pruneBackups(dir, keep); err != nil {
			return path, err
		}
	}
	return path, nil
}

func pruneBackups(dir string, keep int) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	var backups []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), backupPrefix) && strings.HasSuffix(e.Name(), ".db") {
			backups = append(backups, e.Name())
		}
	}
	// Names embed a sortable UTC timestamp, so lexical order is chronological.
	sort.Strings(backups)
	for len(backups) > keep {
		if err := os.Remove(filepath.Join(dir, backups[0])); err != nil {
			return err
		}
		backups = backups[1:]
	}
	return nil
}

// StartBackups runs Backup every interval until ctx is done. interval <= 0 disables it.
func StartBackups(ctx context.Context, conn *sql.DB, dir string, interval time.Duration, keep int) {
	if interval <= 0 {
		return
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if path, err := Backup(ctx, conn, dir, keep); err != nil {
					slog.Error("db.backup_failed", "error", err.Error())
				} else {
					slog.Info("db.backup", "path", path, "keep", keep)
				}
			}
		}
	}()
}

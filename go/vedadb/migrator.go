package vedadb

import (
	"context"
	"fmt"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Schema Migrations
// ---------------------------------------------------------------------------

// Migration represents a single schema migration.
type Migration struct {
	Version   int64
	Name      string
	Up        string
	Down      string
	Timestamp time.Time
}

// MigrationRecord tracks applied migrations in the database.
type MigrationRecord struct {
	Version   int64     `json:"version"`
	Name      string    `json:"name"`
	AppliedAt time.Time `json:"applied_at"`
	Checksum  string    `json:"checksum"`
}

// Migrator manages database schema migrations.
type Migrator struct {
	client      *Client
	tableName   string
	migrations  []Migration

	mu          sync.RWMutex
	onMigrate   func(version int64, name string, direction string)
	onError     func(version int64, err error)
}

// MigratorOption configures the migrator.
type MigratorOption func(*Migrator)

// WithMigrationTable sets the migrations tracking table name (default: schema_migrations).
func WithMigrationTable(name string) MigratorOption {
	return func(m *Migrator) {
		m.tableName = name
	}
}

// NewMigrator creates a new schema migrator.
func NewMigrator(client *Client, opts ...MigratorOption) *Migrator {
	m := &Migrator{
		client:     client,
		tableName:  "schema_migrations",
		migrations: make([]Migration, 0),
	}
	for _, opt := range opts {
		opt(m)
	}
	return m
}

// OnMigrate sets a callback invoked on each migration.
func (m *Migrator) OnMigrate(fn func(version int64, name string, direction string)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.onMigrate = fn
}

// OnError sets a callback invoked on migration errors.
func (m *Migrator) OnError(fn func(version int64, err error)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.onError = fn
}

// AddMigration registers a migration.
func (m *Migrator) AddMigration(mig Migration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.migrations = append(m.migrations, mig)
}

// AddMigrationSimple creates and adds a simple migration.
func (m *Migrator) AddMigrationSimple(version int64, name, up, down string) {
	m.AddMigration(Migration{
		Version: version,
		Name:    name,
		Up:      up,
		Down:    down,
	})
}

// Init creates the migrations tracking table.
func (m *Migrator) Init(ctx context.Context) error {
	sql := fmt.Sprintf(`
		CREATE TABLE IF NOT EXISTS %s (
			version BIGINT PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			checksum VARCHAR(64)
		)`, m.tableName)
	_, err := m.client.Exec(ctx, sql)
	return err
}

// Status returns the current migration status.
func (m *Migrator) Status(ctx context.Context) (*MigrationStatus, error) {
	if err := m.Init(ctx); err != nil {
		return nil, err
	}

	applied, err := m.getApplied(ctx)
	if err != nil {
		return nil, err
	}

	m.mu.RLock()
	migrations := make([]Migration, len(m.migrations))
	copy(migrations, m.migrations)
	m.mu.RUnlock()

	sort.Slice(migrations, func(i, j int) bool {
		return migrations[i].Version < migrations[j].Version
	})

	var pending []Migration
	var completed []MigrationRecord

	appliedMap := make(map[int64]MigrationRecord)
	for _, a := range applied {
		appliedMap[a.Version] = a
	}

	for _, mig := range migrations {
		if _, ok := appliedMap[mig.Version]; ok {
			completed = append(completed, appliedMap[mig.Version])
		} else {
			pending = append(pending, mig)
		}
	}

	return &MigrationStatus{
		Applied:   completed,
		Pending:   pending,
		Total:     len(migrations),
		Completed: len(completed),
	}, nil
}

// Up applies all pending migrations.
func (m *Migrator) Up(ctx context.Context) error {
	if err := m.Init(ctx); err != nil {
		return err
	}

	status, err := m.Status(ctx)
	if err != nil {
		return err
	}

	for _, mig := range status.Pending {
		if err := m.applyMigration(ctx, mig, "up"); err != nil {
			m.mu.RLock()
			cb := m.onError
			m.mu.RUnlock()
			if cb != nil {
				cb(mig.Version, err)
			}
			return fmt.Errorf("migration %d (%s) up failed: %w", mig.Version, mig.Name, err)
		}
	}

	return nil
}

// UpTo applies migrations up to a specific version.
func (m *Migrator) UpTo(ctx context.Context, targetVersion int64) error {
	if err := m.Init(ctx); err != nil {
		return err
	}

	status, err := m.Status(ctx)
	if err != nil {
		return err
	}

	for _, mig := range status.Pending {
		if mig.Version > targetVersion {
			break
		}
		if err := m.applyMigration(ctx, mig, "up"); err != nil {
			return fmt.Errorf("migration %d (%s) up failed: %w", mig.Version, mig.Name, err)
		}
	}

	return nil
}

// Down rolls back the last migration.
func (m *Migrator) Down(ctx context.Context) error {
	if err := m.Init(ctx); err != nil {
		return err
	}

	applied, err := m.getApplied(ctx)
	if err != nil {
		return err
	}

	if len(applied) == 0 {
		return nil // nothing to rollback
	}

	// Roll back the most recent migration
	last := applied[len(applied)-1]

	m.mu.RLock()
	var mig *Migration
	for i := range m.migrations {
		if m.migrations[i].Version == last.Version {
			mig = &m.migrations[i]
			break
		}
	}
	m.mu.RUnlock()

	if mig == nil {
		return fmt.Errorf("migration %d not found in registered migrations", last.Version)
	}

	return m.applyMigration(ctx, *mig, "down")
}

// DownTo rolls back migrations down to a specific version.
func (m *Migrator) DownTo(ctx context.Context, targetVersion int64) error {
	if err := m.Init(ctx); err != nil {
		return err
	}

	applied, err := m.getApplied(ctx)
	if err != nil {
		return err
	}

	// Roll back in reverse order
	for i := len(applied) - 1; i >= 0; i-- {
		if applied[i].Version <= targetVersion {
			break
		}

		m.mu.RLock()
		var mig *Migration
		for j := range m.migrations {
			if m.migrations[j].Version == applied[i].Version {
				mig = &m.migrations[j]
				break
			}
		}
		m.mu.RUnlock()

		if mig == nil {
			continue
		}

		if err := m.applyMigration(ctx, *mig, "down"); err != nil {
			return fmt.Errorf("migration %d (%s) down failed: %w", mig.Version, mig.Name, err)
		}
	}

	return nil
}

// applyMigration applies a single migration.
func (m *Migrator) applyMigration(ctx context.Context, mig Migration, direction string) error {
	var sql string
	if direction == "up" {
		sql = mig.Up
	} else {
		sql = mig.Down
	}

	if strings.TrimSpace(sql) == "" {
		return NewValidationError(fmt.Sprintf("empty %s migration for version %d", direction, mig.Version))
	}

	// Execute the migration SQL
	_, err := m.client.Exec(ctx, sql)
	if err != nil {
		return err
	}

	// Update tracking table
	if direction == "up" {
		trackSQL := fmt.Sprintf(
			"INSERT INTO %s (version, name, applied_at, checksum) VALUES (%d, '%s', '%s', '')",
			m.tableName, mig.Version, mig.Name, time.Now().Format(time.RFC3339))
		_, err = m.client.Exec(ctx, trackSQL)
	} else {
		trackSQL := fmt.Sprintf(
			"DELETE FROM %s WHERE version = %d",
			m.tableName, mig.Version)
		_, err = m.client.Exec(ctx, trackSQL)
	}

	if err != nil {
		return fmt.Errorf("failed to track migration: %w", err)
	}

	m.mu.RLock()
	cb := m.onMigrate
	m.mu.RUnlock()
	if cb != nil {
		go cb(mig.Version, mig.Name, direction)
	}

	return nil
}

// getApplied retrieves the list of applied migrations.
func (m *Migrator) getApplied(ctx context.Context) ([]MigrationRecord, error) {
	sql := fmt.Sprintf("SELECT version, name, applied_at, checksum FROM %s ORDER BY version", m.tableName)
	result, err := m.client.Query(ctx, sql)
	if err != nil {
		return nil, err
	}

	records := make([]MigrationRecord, 0, len(result.Rows))
	for _, row := range result.Rows {
		if len(row) < 2 {
			continue
		}
		version, _ := strconv.ParseInt(row[0], 10, 64)
		name := row[1]
		var appliedAt time.Time
		if len(row) > 2 {
			appliedAt, _ = time.Parse(time.RFC3339, row[2])
		}
		var checksum string
		if len(row) > 3 {
			checksum = row[3]
		}
		records = append(records, MigrationRecord{
			Version:   version,
			Name:      name,
			AppliedAt: appliedAt,
			Checksum:  checksum,
		})
	}

	return records, nil
}

// MigrationStatus holds the current migration state.
type MigrationStatus struct {
	Applied   []MigrationRecord
	Pending   []Migration
	Total     int
	Completed int
}

// HasPending returns true if there are pending migrations.
func (s *MigrationStatus) HasPending() bool {
	return len(s.Pending) > 0
}

// NextVersion returns the next pending version, or 0 if none.
func (s *MigrationStatus) NextVersion() int64 {
	if len(s.Pending) == 0 {
		return 0
	}
	return s.Pending[0].Version
}

// ---------------------------------------------------------------------------
// Migration Helpers
// ---------------------------------------------------------------------------

// GenerateMigrationName creates a migration name from a timestamp.
func GenerateMigrationName(description string) string {
	ts := time.Now().Format("20060102150405")
	safe := strings.ReplaceAll(description, " ", "_")
	safe = regexp.MustCompile(`[^a-zA-Z0-9_]`).ReplaceAllString(safe, "")
	return fmt.Sprintf("%s_%s", ts, safe)
}

// ParseMigrationFileName parses a migration file name into version and name.
// Expected format: YYYYMMDDHHMMSS_description.sql
func ParseMigrationFileName(filename string) (int64, string, error) {
	base := filepath.Base(filename)
	ext := filepath.Ext(base)
	base = strings.TrimSuffix(base, ext)

	parts := strings.SplitN(base, "_", 2)
	if len(parts) < 2 {
		return 0, "", fmt.Errorf("invalid migration filename: %s", filename)
	}

	version, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, "", fmt.Errorf("invalid version in filename: %s", filename)
	}

	name := parts[1]
	return version, name, nil
}

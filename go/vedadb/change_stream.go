package vedadb

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
)

// ---------------------------------------------------------------------------
// ChangeStream - Subscribe to table changes (CDC) for Go driver
// ---------------------------------------------------------------------------

// ChangeEvent represents a single change event from the server.
type ChangeEvent struct {
	Operation  string                 `json:"operation"`  // INSERT, UPDATE, DELETE
	Table      string                 `json:"table"`
	Timestamp  int64                  `json:"timestamp"`
	LSN        int64                  `json:"lsn"`
	Before     map[string]interface{} `json:"before,omitempty"`
	After      map[string]interface{} `json:"after,omitempty"`
	Keys       map[string]interface{} `json:"keys,omitempty"`
	RawData    []byte                 `json:"-"`
}

// ChangeStreamConfig configures a change stream subscription.
type ChangeStreamConfig struct {
	Table          string            // Table to watch (empty = all tables)
	Operations     []string          // Filter by operation type: INSERT, UPDATE, DELETE
	ResumeFromLSN  int64             // Resume from a specific LSN checkpoint
	IncludeBefore  bool              // Include before-image for updates
	KeyColumns     []string          // Columns to use as keys
	ExtraParams    map[string]string // Additional parameters
}

// ChangeStream subscribes to and streams change events from VedaDB.
type ChangeStream struct {
	client   *Client
	config   ChangeStreamConfig
	events   chan *ChangeEvent
	errors   chan error
	done     chan struct{}
	mu       sync.RWMutex
	active   bool
	lastLSN  int64
	cancelFn context.CancelFunc
}

// NewChangeStream creates a new change stream subscription.
func NewChangeStream(client *Client, config ChangeStreamConfig) *ChangeStream {
	return &ChangeStream{
		client:  client,
		config:  config,
		events:  make(chan *ChangeEvent, 100),
		errors:  make(chan error, 10),
		done:    make(chan struct{}),
		active:  false,
		lastLSN: config.ResumeFromLSN,
	}
}

// Start begins consuming change events.
func (cs *ChangeStream) Start(ctx context.Context) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	if cs.active {
		return
	}
	cs.active = true
	childCtx, cancel := context.WithCancel(ctx)
	cs.cancelFn = cancel

	go cs.run(childCtx)
}

// Stop halts the change stream.
func (cs *ChangeStream) Stop() {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	if !cs.active {
		return
	}
	cs.active = false
	if cs.cancelFn != nil {
		cs.cancelFn()
	}
	close(cs.done)
}

// Events returns the channel of change events.
func (cs *ChangeStream) Events() <-chan *ChangeEvent {
	return cs.events
}

// Errors returns the channel of errors.
func (cs *ChangeStream) Errors() <-chan error {
	return cs.errors
}

// LastLSN returns the most recently processed LSN (for resume).
func (cs *ChangeStream) LastLSN() int64 {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	return cs.lastLSN
}

// Active returns whether the stream is currently consuming.
func (cs *ChangeStream) Active() bool {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	return cs.active
}

// ResumeToken returns a token for resuming from the current position.
func (cs *ChangeStream) ResumeToken() string {
	token := map[string]interface{}{
		"lsn":    cs.LastLSN(),
		"table":  cs.config.Table,
		"time":   0,
	}
	b, _ := json.Marshal(token)
	return string(b)
}

// run is the main loop consuming changes.
func (cs *ChangeStream) run(ctx context.Context) {
	defer close(cs.events)

	for {
		select {
		case <-ctx.Done():
			return
		case <-cs.done:
			return
		default:
		}

		sql := cs.buildWatchSQL()
		result, err := cs.client.Query(ctx, sql)
		if err != nil {
			select {
			case cs.errors <- fmt.Errorf("changestream query error: %w", err):
			case <-ctx.Done():
				return
			}
			continue
		}

		for _, row := range result.Rows {
			event := cs.parseRow(row, result.Columns)
			if event == nil {
				continue
			}
			if !cs.matchesFilter(event) {
				continue
			}
			cs.mu.Lock()
			cs.lastLSN = event.LSN
			cs.mu.Unlock()

			select {
			case cs.events <- event:
			case <-ctx.Done():
				return
			case <-cs.done:
				return
			}
		}
	}
}

// buildWatchSQL constructs the WATCH query with filters.
func (cs *ChangeStream) buildWatchSQL() string {
	var b strings.Builder
	b.WriteString("WATCH")
	if cs.config.Table != "" {
		b.WriteString(" ")
		b.WriteString(cs.config.Table)
	}
	if cs.config.ResumeFromLSN > 0 {
		fmt.Fprintf(&b, " RESUME LSN %d", cs.config.ResumeFromLSN)
	}
	if len(cs.config.Operations) > 0 {
		fmt.Fprintf(&b, " FILTER (%s)", strings.Join(cs.config.Operations, ","))
	}
	b.WriteString(";")
	return b.String()
}

// parseRow converts a result row into a ChangeEvent.
func (cs *ChangeStream) parseRow(row []interface{}, columns []string) *ChangeEvent {
	if len(row) == 0 {
		return nil
	}
	event := &ChangeEvent{}
	for i, col := range columns {
		if i >= len(row) {
			break
		}
		switch col {
		case "operation":
			event.Operation = fmt.Sprintf("%v", row[i])
		case "table":
			event.Table = fmt.Sprintf("%v", row[i])
		case "timestamp":
			fmt.Sscanf(fmt.Sprintf("%v", row[i]), "%d", &event.Timestamp)
		case "lsn":
			fmt.Sscanf(fmt.Sprintf("%v", row[i]), "%d", &event.LSN)
		case "before":
			if cs.config.IncludeBefore {
				json.Unmarshal([]byte(fmt.Sprintf("%v", row[i])), &event.Before)
			}
		case "after":
			json.Unmarshal([]byte(fmt.Sprintf("%v", row[i])), &event.After)
		case "keys":
			json.Unmarshal([]byte(fmt.Sprintf("%v", row[i])), &event.Keys)
		}
	}
	return event
}

// matchesFilter checks if the event matches the configured operation filter.
func (cs *ChangeStream) matchesFilter(event *ChangeEvent) bool {
	if len(cs.config.Operations) == 0 {
		return true
	}
	for _, op := range cs.config.Operations {
		if strings.EqualFold(op, event.Operation) {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Client helper: Watch
// ---------------------------------------------------------------------------

// Watch starts a change stream for the given table.
func (c *Client) Watch(ctx context.Context, table string, opts ...ChangeStreamOption) *ChangeStream {
	config := ChangeStreamConfig{Table: table}
	for _, opt := range opts {
		opt(&config)
	}
	cs := NewChangeStream(c, config)
	cs.Start(ctx)
	return cs
}

// ChangeStreamOption configures a change stream.
type ChangeStreamOption func(*ChangeStreamConfig)

// WithOperations filters by operation type.
func WithOperations(ops ...string) ChangeStreamOption {
	return func(c *ChangeStreamConfig) {
		c.Operations = ops
	}
}

// WithResumeFromLSN resumes from a specific LSN.
func WithResumeFromLSN(lsn int64) ChangeStreamOption {
	return func(c *ChangeStreamConfig) {
		c.ResumeFromLSN = lsn
	}
}

// WithIncludeBefore includes before-images.
func WithIncludeBefore(v bool) ChangeStreamOption {
	return func(c *ChangeStreamConfig) {
		c.IncludeBefore = v
	}
}

package vedadb

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// ChangeEvent represents a single change in a watched table.
type ChangeEvent struct {
	OperationType string                 `json:"operation_type"`
	Table         string                 `json:"table"`
	DocumentKey   string                 `json:"document_key"`
	FullDocument  map[string]interface{} `json:"full_document,omitempty"`
	ClusterTime   time.Time              `json:"cluster_time"`
	LSN           int64                  `json:"lsn"`
	Raw           map[string]interface{} `json:"-"`
}

// WatchOptions configures change stream behavior.
type WatchOptions struct {
	FullDocument    bool          // include full document in events
	ResumeAfter     int64         // resume after this LSN
	OperationTypes  []string      // filter by operation types (INSERT, UPDATE, DELETE)
	HeartbeatInterval time.Duration
}

// DefaultWatchOptions returns default watch options.
func DefaultWatchOptions() WatchOptions {
	return WatchOptions{
		FullDocument:      true,
		HeartbeatInterval: 30 * time.Second,
	}
}

// Watch starts a change stream for the given table.
// Returns a channel that receives change events.
func (c *Client) Watch(ctx context.Context, table string) (<-chan *ChangeEvent, error) {
	return c.WatchWithOptions(ctx, table, DefaultWatchOptions())
}

// WatchWithOptions starts a change stream with options.
func (c *Client) WatchWithOptions(ctx context.Context, table string, opts WatchOptions) (<-chan *ChangeEvent, error) {
	if table == "" {
		return nil, NewValidationError("table name is required")
	}

	eventCh := make(chan *ChangeEvent, 100)

	// Register watch with server
	payload := map[string]interface{}{
		"table":          table,
		"full_document":  opts.FullDocument,
		"operation_types": opts.OperationTypes,
	}
	if opts.ResumeAfter > 0 {
		payload["resume_after"] = opts.ResumeAfter
	}

	body, err := json.Marshal(payload)
	if err != nil {
		close(eventCh)
		return nil, NewValidationError("failed to encode watch payload: " + err.Error())
	}

	reqCtx, cancel := contextWithTimeout(c.config.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, "POST",
		c.proto.baseURL+"/v1/watch", bytes.NewReader(body))
	if err != nil {
		close(eventCh)
		return nil, err
	}

	c.proto.setHeaders(req, true)
	resp, err := c.proto.client.Do(req)
	if err != nil {
		close(eventCh)
		return nil, NewConnectionError(err.Error())
	}
	resp.Body.Close()

	if resp.StatusCode >= 400 {
		close(eventCh)
		return nil, NewConnectionError(fmt.Sprintf("watch returned %d", resp.StatusCode))
	}

	// Start polling for changes
	go c.pollChanges(ctx, table, opts, eventCh)

	return eventCh, nil
}

// pollChanges polls the server for change events.
func (c *Client) pollChanges(ctx context.Context, table string, opts WatchOptions, eventCh chan<- *ChangeEvent) {
	defer close(eventCh)

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	heartbeat := time.NewTicker(opts.HeartbeatInterval)
	defer heartbeat.Stop()

	var lastLSN int64
	if opts.ResumeAfter > 0 {
		lastLSN = opts.ResumeAfter
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-heartbeat.C:
			// Send heartbeat to keep watch alive
			c.sendHeartbeat(ctx, table, lastLSN)
		case <-ticker.C:
			events, err := c.fetchChanges(ctx, table, lastLSN)
			if err != nil {
				continue
			}
			for _, event := range events {
				if event.LSN > lastLSN {
					lastLSN = event.LSN
				}
				if shouldIncludeEvent(event, opts) {
					select {
					case eventCh <- event:
					case <-ctx.Done():
						return
					}
				}
			}
		}
	}
}

// fetchChanges retrieves new change events from the server.
func (c *Client) fetchChanges(ctx context.Context, table string, afterLSN int64) ([]*ChangeEvent, error) {
	payload := map[string]interface{}{
		"table":     table,
		"after_lsn": afterLSN,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	reqCtx, cancel := contextWithTimeout(c.config.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, "POST",
		c.proto.baseURL+"/v1/changes", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}

	c.proto.setHeaders(req, true)
	resp, err := c.proto.client.Do(req)
	if err != nil {
		return nil, NewConnectionError(err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, NewConnectionError(fmt.Sprintf("changes returned %d", resp.StatusCode))
	}

	var result struct {
		Events []*ChangeEvent `json:"events"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return result.Events, nil
}

// sendHeartbeat sends a heartbeat to keep the watch session alive.
func (c *Client) sendHeartbeat(ctx context.Context, table string, lastLSN int64) {
	payload := map[string]interface{}{
		"table":    table,
		"last_lsn": lastLSN,
		"type":     "heartbeat",
	}

	body, _ := json.Marshal(payload)
	heartbeatCtx, cancel := contextWithTimeout(5 * time.Second)
	defer cancel()

	req, _ := http.NewRequestWithContext(heartbeatCtx, "POST",
		c.proto.baseURL+"/v1/watch/heartbeat", bytes.NewReader(body))
	if req != nil {
		c.proto.setHeaders(req, true)
		resp, err := c.proto.client.Do(req)
		if err == nil && resp != nil {
			resp.Body.Close()
		}
	}
}

// shouldIncludeEvent filters events based on WatchOptions.
func shouldIncludeEvent(event *ChangeEvent, opts WatchOptions) bool {
	if len(opts.OperationTypes) == 0 {
		return true
	}
	for _, op := range opts.OperationTypes {
		if op == event.OperationType {
			return true
		}
	}
	return false
}

// String returns a human-readable representation of a ChangeEvent.
func (e *ChangeEvent) String() string {
	return fmt.Sprintf("ChangeEvent{op=%s table=%s key=%s lsn=%d time=%s}",
		e.OperationType, e.Table, e.DocumentKey, e.LSN, e.ClusterTime.Format(time.RFC3339))
}

// ChangeStream wraps a change event channel with additional controls.
type ChangeStream struct {
	events  <-chan *ChangeEvent
	cancel  context.CancelFunc
	mu      sync.Mutex
	resumed bool
}

// NewChangeStream creates a new ChangeStream wrapper.
func NewChangeStream(events <-chan *ChangeEvent, cancel context.CancelFunc) *ChangeStream {
	return &ChangeStream{
		events: events,
		cancel: cancel,
	}
}

// Events returns the underlying event channel.
func (cs *ChangeStream) Events() <-chan *ChangeEvent {
	return cs.events
}

// Stop cancels the change stream.
func (cs *ChangeStream) Stop() {
	if cs.cancel != nil {
		cs.cancel()
	}
}

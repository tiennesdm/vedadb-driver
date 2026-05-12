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

// Message represents a pub/sub message.
type Message struct {
	Channel   string
	Payload   string
	Timestamp time.Time
	ID        string
}

// PubSub provides publish/subscribe functionality over VedaDB.
type PubSub struct {
	client *Client

	mu          sync.RWMutex
	subscribers map[string][]chan *Message
	closed      bool
	stopCh      chan struct{}
}

// NewPubSub creates a new PubSub instance for the given client.
func NewPubSub(client *Client) *PubSub {
	return &PubSub{
		client:      client,
		subscribers: make(map[string][]chan *Message),
		stopCh:      make(chan struct{}),
	}
}

// Publish sends a message to the specified channel.
// Returns the number of subscribers that received the message.
func (ps *PubSub) Publish(ctx context.Context, channel string, message string) (int, error) {
	if channel == "" {
		return 0, NewValidationError("channel name is required")
	}

	payload := map[string]interface{}{
		"channel": channel,
		"message": message,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return 0, NewValidationError("failed to encode publish payload: " + err.Error())
	}

	reqCtx, cancel := contextWithTimeout(ps.client.config.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, "POST",
		ps.client.proto.baseURL+"/v1/pubsub/publish", bytes.NewReader(body))
	if err != nil {
		return 0, err
	}

	ps.client.proto.setHeaders(req, true)
	resp, err := ps.client.proto.client.Do(req)
	if err != nil {
		return 0, NewConnectionError(err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		var errResp struct {
			Error string `json:"error"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&errResp); err == nil && errResp.Error != "" {
			return 0, NewQueryError(errResp.Error)
		}
		return 0, NewConnectionError(fmt.Sprintf("publish returned %d", resp.StatusCode))
	}

	var result struct {
		Subscribers int `json:"subscribers"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, nil // Best effort
	}
	return result.Subscribers, nil
}

// Subscribe listens for messages on the given channels.
// Returns a receive-only channel of Messages.
func (ps *PubSub) Subscribe(ctx context.Context, channels ...string) (<-chan *Message, error) {
	if len(channels) == 0 {
		return nil, NewValidationError("at least one channel is required")
	}

	ps.mu.Lock()
	defer ps.mu.Unlock()

	if ps.closed {
		return nil, NewConnectionError("pubsub is closed")
	}

	msgCh := make(chan *Message, 100)

	for _, ch := range channels {
		ps.subscribers[ch] = append(ps.subscribers[ch], msgCh)

		// Register subscription with server
		if err := ps.registerSubscription(ctx, ch); err != nil {
			// Cleanup on partial failure
			ps.removeSubscriber(ch, msgCh)
			return nil, err
		}
	}

	// Start polling for messages
	go ps.poll(ctx, channels, msgCh)

	return msgCh, nil
}

// Unsubscribe removes subscriptions for the given channels.
func (ps *PubSub) Unsubscribe(channels ...string) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	if ps.closed {
		return NewConnectionError("pubsub is closed")
	}

	for _, ch := range channels {
		// Unregister with server
		ps.unregisterSubscription(ch)

		// Remove subscriber channels
		if subs, ok := ps.subscribers[ch]; ok {
			for _, subCh := range subs {
				close(subCh)
			}
			delete(ps.subscribers, ch)
		}
	}

	return nil
}

// Close shuts down the PubSub system.
func (ps *PubSub) Close() error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	if ps.closed {
		return nil
	}
	ps.closed = true
	close(ps.stopCh)

	for ch, subs := range ps.subscribers {
		for _, subCh := range subs {
			close(subCh)
		}
		delete(ps.subscribers, ch)
	}

	return nil
}

// registerSubscription registers a channel subscription with the server.
func (ps *PubSub) registerSubscription(ctx context.Context, channel string) error {
	payload := map[string]interface{}{
		"channel": channel,
		"action":  "subscribe",
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	reqCtx, cancel := contextWithTimeout(ps.client.config.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, "POST",
		ps.client.proto.baseURL+"/v1/pubsub/subscribe", bytes.NewReader(body))
	if err != nil {
		return err
	}

	ps.client.proto.setHeaders(req, true)
	resp, err := ps.client.proto.client.Do(req)
	if err != nil {
		return NewConnectionError(err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return NewConnectionError(fmt.Sprintf("subscribe returned %d", resp.StatusCode))
	}
	return nil
}

// unregisterSubscription unregisters a channel subscription from the server.
func (ps *PubSub) unregisterSubscription(channel string) {
	payload := map[string]interface{}{
		"channel": channel,
		"action":  "unsubscribe",
	}

	body, _ := json.Marshal(payload)
	reqCtx, cancel := contextWithTimeout(ps.client.config.Timeout)
	defer cancel()

	req, _ := http.NewRequestWithContext(reqCtx, "POST",
		ps.client.proto.baseURL+"/v1/pubsub/unsubscribe", bytes.NewReader(body))
	if req != nil {
		ps.client.proto.setHeaders(req, true)
		resp, _ := ps.client.proto.client.Do(req)
		if resp != nil {
			resp.Body.Close()
		}
	}
}

// poll periodically fetches messages for subscribed channels.
func (ps *PubSub) poll(ctx context.Context, channels []string, msgCh chan<- *Message) {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ps.stopCh:
			return
		case <-ticker.C:
			messages, err := ps.fetchMessages(ctx, channels)
			if err != nil {
				continue
			}
			for _, msg := range messages {
				select {
				case msgCh <- msg:
				case <-ctx.Done():
					return
				case <-ps.stopCh:
					return
				}
			}
		}
	}
}

// fetchMessages retrieves pending messages from the server.
func (ps *PubSub) fetchMessages(ctx context.Context, channels []string) ([]*Message, error) {
	payload := map[string]interface{}{
		"channels": channels,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	reqCtx, cancel := contextWithTimeout(ps.client.config.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, "POST",
		ps.client.proto.baseURL+"/v1/pubsub/receive", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}

	ps.client.proto.setHeaders(req, true)
	resp, err := ps.client.proto.client.Do(req)
	if err != nil {
		return nil, NewConnectionError(err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, NewConnectionError(fmt.Sprintf("receive returned %d", resp.StatusCode))
	}

	var result struct {
		Messages []*Message `json:"messages"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	now := time.Now()
	for _, m := range result.Messages {
		if m.Timestamp.IsZero() {
			m.Timestamp = now
		}
	}

	return result.Messages, nil
}

// removeSubscriber removes a subscriber channel from a channel's subscriber list.
func (ps *PubSub) removeSubscriber(channel string, ch chan *Message) {
	if subs, ok := ps.subscribers[channel]; ok {
		filtered := make([]chan *Message, 0, len(subs))
		for _, sub := range subs {
			if sub != ch {
				filtered = append(filtered, sub)
			}
		}
		if len(filtered) > 0 {
			ps.subscribers[channel] = filtered
		} else {
			delete(ps.subscribers, channel)
		}
	}
}

// Subscribers returns the number of subscribers for a channel.
func (ps *PubSub) Subscribers(channel string) int {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	return len(ps.subscribers[channel])
}

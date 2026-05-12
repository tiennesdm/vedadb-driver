// pubsub_test.go — Pub/Sub tests for VedaDB Go driver
package vedadb

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// Message represents a pub/sub message
type Message struct {
	Channel string
	Data    []byte
	ID      string
}

// PubSub manages publish/subscribe operations
type PubSub struct {
	mu          sync.RWMutex
	subscribers map[string][]chan *Message
	closed      bool
	closeCh     chan struct{}
}

func NewPubSub() *PubSub {
	return &PubSub{
		subscribers: make(map[string][]chan *Message),
		closeCh:     make(chan struct{}),
	}
}

func (ps *PubSub) Subscribe(ctx context.Context, channel string) (<-chan *Message, error) {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	if ps.closed {
		return nil, errors.New("pubsub is closed")
	}

	ch := make(chan *Message, 100)
	ps.subscribers[channel] = append(ps.subscribers[channel], ch)
	return ch, nil
}

func (ps *PubSub) Publish(ctx context.Context, channel string, data []byte) error {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	if ps.closed {
		return errors.New("pubsub is closed")
	}

	msg := &Message{
		Channel: channel,
		Data:    data,
		ID:      generateMsgID(),
	}

	for _, ch := range ps.subscribers[channel] {
		select {
		case ch <- msg:
		default:
		}
	}
	return nil
}

func (ps *PubSub) Unsubscribe(channel string, ch <-chan *Message) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	subs := ps.subscribers[channel]
	for i, sub := range subs {
		if sub == ch {
			ps.subscribers[channel] = append(subs[:i], subs[i+1:]...)
			close(sub)
			break
		}
	}
}

func (ps *PubSub) Close() error {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	if ps.closed {
		return nil
	}
	ps.closed = true
	for _, subs := range ps.subscribers {
		for _, ch := range subs {
			close(ch)
		}
	}
	return nil
}

func (ps *PubSub) SubscriberCount(channel string) int {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	return len(ps.subscribers[channel])
}

var msgIDCounter int64
var msgIDMu sync.Mutex

func generateMsgID() string {
	msgIDMu.Lock()
	defer msgIDMu.Unlock()
	msgIDCounter++
	return time.Now().Format("20060102") + "-" + string(rune(msgIDCounter))
}

func TestPubSub(t *testing.T) {
	t.Run("publish_subscribe", func(t *testing.T) {
		ps := NewPubSub()
		defer ps.Close()

		ctx := context.Background()
		ch, err := ps.Subscribe(ctx, "test-channel")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		err = ps.Publish(ctx, "test-channel", []byte("hello"))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		select {
		case msg := <-ch:
			if string(msg.Data) != "hello" {
				t.Errorf("expected 'hello', got %s", string(msg.Data))
			}
			if msg.Channel != "test-channel" {
				t.Errorf("expected channel 'test-channel', got %s", msg.Channel)
			}
		case <-time.After(time.Second):
			t.Fatal("timeout waiting for message")
		}
	})

	t.Run("multiple_subscribers", func(t *testing.T) {
		ps := NewPubSub()
		defer ps.Close()

		ctx := context.Background()
		ch1, _ := ps.Subscribe(ctx, "broadcast")
		ch2, _ := ps.Subscribe(ctx, "broadcast")
		ch3, _ := ps.Subscribe(ctx, "broadcast")

		ps.Publish(ctx, "broadcast", []byte("to-all"))

		for i, ch := range []<-chan *Message{ch1, ch2, ch3} {
			select {
			case msg := <-ch:
				if string(msg.Data) != "to-all" {
					t.Errorf("subscriber %d: expected 'to-all', got %s", i, string(msg.Data))
				}
			case <-time.After(time.Second):
				t.Fatalf("timeout waiting for message on subscriber %d", i)
			}
		}
	})

	t.Run("channel_isolation", func(t *testing.T) {
		ps := NewPubSub()
		defer ps.Close()

		ctx := context.Background()
		chA, _ := ps.Subscribe(ctx, "channel-a")
		chB, _ := ps.Subscribe(ctx, "channel-b")

		ps.Publish(ctx, "channel-a", []byte("message-a"))

		select {
		case msg := <-chA:
			if string(msg.Data) != "message-a" {
				t.Errorf("expected 'message-a', got %s", string(msg.Data))
			}
		case <-time.After(time.Second):
			t.Fatal("timeout waiting for channel-a")
		}

		select {
		case <-chB:
			t.Fatal("should not receive message on channel-b")
		case <-time.After(100 * time.Millisecond):
			// Expected - no message
		}
	})

	t.Run("unsubscribe", func(t *testing.T) {
		ps := NewPubSub()
		defer ps.Close()

		ctx := context.Background()
		ch, _ := ps.Subscribe(ctx, "temp")

		if ps.SubscriberCount("temp") != 1 {
			t.Errorf("expected 1 subscriber, got %d", ps.SubscriberCount("temp"))
		}

		ps.Unsubscribe("temp", ch)

		// Give a moment for unsubscribe to process
		time.Sleep(10 * time.Millisecond)

		if ps.SubscriberCount("temp") != 0 {
			t.Errorf("expected 0 subscribers, got %d", ps.SubscriberCount("temp"))
		}
	})

	t.Run("close_releases_resources", func(t *testing.T) {
		ps := NewPubSub()
		ctx := context.Background()
		ch, _ := ps.Subscribe(ctx, "test")

		err := ps.Close()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		// Channel should be closed
		select {
		case _, ok := <-ch:
			if ok {
				t.Error("expected channel to be closed")
			}
		case <-time.After(time.Second):
			t.Fatal("timeout waiting for channel close")
		}
	})

	t.Run("publish_after_close", func(t *testing.T) {
		ps := NewPubSub()
		ps.Close()

		ctx := context.Background()
		err := ps.Publish(ctx, "test", []byte("data"))
		if err == nil {
			t.Fatal("expected error publishing to closed pubsub")
		}
	})

	t.Run("subscribe_after_close", func(t *testing.T) {
		ps := NewPubSub()
		ps.Close()

		ctx := context.Background()
		_, err := ps.Subscribe(ctx, "test")
		if err == nil {
			t.Fatal("expected error subscribing to closed pubsub")
		}
	})

	t.Run("concurrent_publish", func(t *testing.T) {
		ps := NewPubSub()
		defer ps.Close()

		ctx := context.Background()
		ch, _ := ps.Subscribe(ctx, "concurrent")

		var wg sync.WaitGroup
		for i := 0; i < 100; i++ {
			wg.Add(1)
			go func(n int) {
				defer wg.Done()
				ps.Publish(ctx, "concurrent", []byte("msg"))
			}(i)
		}
		wg.Wait()

		// Drain the channel
		received := 0
		drain:
		for {
			select {
			case <-ch:
				received++
			case <-time.After(100 * time.Millisecond):
				break drain
			}
		}

		if received == 0 {
			t.Error("expected some messages to be received")
		}
	})
}

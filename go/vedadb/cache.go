package vedadb

import (
	"container/list"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// LRU Query Cache
// ---------------------------------------------------------------------------

// CacheEntry represents a single cached query result.
type CacheEntry struct {
	Key        string
	Result     *Result
	SQL        string
	Params     []interface{}
	CreatedAt  time.Time
	ExpiresAt  time.Time
	HitCount   int64
}

// IsExpired reports whether the cache entry has expired.
func (e *CacheEntry) IsExpired() bool {
	return time.Now().After(e.ExpiresAt)
}

// Cache provides an LRU query result cache.
type Cache struct {
	maxSize      int
	defaultTTL   time.Duration

	mu           sync.RWMutex
	entries      map[string]*list.Element // key -> list element
	lru          *list.List               // front = most recently used
	hits         int64
	misses       int64
	evictions    int64
}

// CacheOption configures the cache.
type CacheOption func(*Cache)

// WithMaxSize sets the maximum number of entries.
func WithMaxSize(size int) CacheOption {
	return func(c *Cache) {
		c.maxSize = size
	}
}

// WithDefaultTTL sets the default TTL for cache entries.
func WithDefaultTTL(ttl time.Duration) CacheOption {
	return func(c *Cache) {
		c.defaultTTL = ttl
	}
}

// NewCache creates a new LRU cache.
func NewCache(opts ...CacheOption) *Cache {
	c := &Cache{
		maxSize:    100,
		defaultTTL: 5 * time.Minute,
		entries:    make(map[string]*list.Element),
		lru:        list.New(),
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// Get retrieves a cached result by key.
// Returns nil if not found or expired.
func (c *Cache) Get(key string) *CacheEntry {
	c.mu.Lock()
	defer c.mu.Unlock()

	elem, ok := c.entries[key]
	if !ok {
		c.misses++
		return nil
	}

	entry := elem.Value.(*CacheEntry)
	if entry.IsExpired() {
		c.evict(elem)
		c.misses++
		return nil
	}

	// Move to front (most recently used)
	c.lru.MoveToFront(elem)
	entry.HitCount++
	c.hits++
	return entry
}

// Set stores a result in the cache.
func (c *Cache) Set(key string, sql string, params []interface{}, result *Result) {
	c.SetWithTTL(key, sql, params, result, c.defaultTTL)
}

// SetWithTTL stores a result with a custom TTL.
func (c *Cache) SetWithTTL(key string, sql string, params []interface{}, result *Result, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Evict expired entries first
	c.evictExpired()

	// If key exists, update it
	if elem, ok := c.entries[key]; ok {
		c.lru.MoveToFront(elem)
		elem.Value = &CacheEntry{
			Key:       key,
			Result:    result,
			SQL:       sql,
			Params:    params,
			CreatedAt: time.Now(),
			ExpiresAt: time.Now().Add(ttl),
			HitCount:  0,
		}
		return
	}

	// Evict oldest if at capacity
	if c.lru.Len() >= c.maxSize {
		c.evictLRU()
	}

	entry := &CacheEntry{
		Key:       key,
		Result:    result,
		SQL:       sql,
		Params:    params,
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(ttl),
		HitCount:  0,
	}
	elem := c.lru.PushFront(entry)
	c.entries[key] = elem
}

// Delete removes a specific key from the cache.
func (c *Cache) Delete(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if elem, ok := c.entries[key]; ok {
		c.evict(elem)
	}
}

// Clear removes all entries from the cache.
func (c *Cache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.entries = make(map[string]*list.Element)
	c.lru.Init()
}

// QueryKey generates a cache key from SQL and parameters.
func (c *Cache) QueryKey(sql string, params []interface{}) string {
	h := sha256.New()
	h.Write([]byte(sql))
	for _, p := range params {
		h.Write([]byte(fmt.Sprintf("|%v|", p)))
	}
	return hex.EncodeToString(h.Sum(nil))[:32]
}

// GetQuery is a convenience method that generates a key and looks up the cache.
func (c *Cache) GetQuery(sql string, params []interface{}) *CacheEntry {
	return c.Get(c.QueryKey(sql, params))
}

// SetQuery is a convenience method that generates a key and stores in cache.
func (c *Cache) SetQuery(sql string, params []interface{}, result *Result) {
	c.Set(c.QueryKey(sql, params), sql, params, result)
}

// CachedClient wraps a Client with query caching.
type CachedClient struct {
	*Client
	cache *Cache
	mu    sync.RWMutex
}

// NewCachedClient creates a client with caching enabled.
func NewCachedClient(client *Client, cache *Cache) *CachedClient {
	return &CachedClient{
		Client: client,
		cache:  cache,
	}
}

// QueryWithCache executes a query with caching.
func (cc *CachedClient) QueryWithCache(ctx context.Context, sql string, args ...interface{}) (*Result, error) {
	// Only cache SELECT queries
	if !isSelectQuery(sql) {
		return cc.Client.Query(ctx, sql, args...)
	}

	key := cc.cache.QueryKey(sql, args)

	if entry := cc.cache.Get(key); entry != nil {
		return entry.Result, nil
	}

	result, err := cc.Client.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}

	cc.cache.SetQuery(sql, args, result)
	return result, nil
}

// Invalidate removes cache entries matching the given table name pattern.
func (cc *CachedClient) Invalidate(tablePattern string) {
	// Simple implementation: clear entire cache
	// In production, you might want to track which tables each query touches
	cc.cache.Clear()
}

// Stats returns cache statistics.
func (c *Cache) Stats() CacheStats {
	c.mu.RLock()
	defer c.mu.RUnlock()

	var totalSize int64
	for elem := c.lru.Front(); elem != nil; elem = elem.Next() {
		entry := elem.Value.(*CacheEntry)
		totalSize += int64(len(entry.SQL)) + int64(len(fmt.Sprint(entry.Params)))
	}

	return CacheStats{
		Size:        c.lru.Len(),
		MaxSize:     c.maxSize,
		Hits:        c.hits,
		Misses:      c.misses,
		Evictions:   c.evictions,
		HitRate:     c.hitRate(),
		TotalSize:   totalSize,
	}
}

// CacheStats holds cache statistics.
type CacheStats struct {
	Size      int
	MaxSize   int
	Hits      int64
	Misses    int64
	Evictions int64
	HitRate   float64
	TotalSize int64
}

func (c *Cache) hitRate() float64 {
	total := c.hits + c.misses
	if total == 0 {
		return 0
	}
	return float64(c.hits) / float64(total)
}

func (c *Cache) evict(elem *list.Element) {
	entry := elem.Value.(*CacheEntry)
	delete(c.entries, entry.Key)
	c.lru.Remove(elem)
	c.evictions++
}

func (c *Cache) evictLRU() {
	if back := c.lru.Back(); back != nil {
		c.evict(back)
	}
}

func (c *Cache) evictExpired() {
	for elem := c.lru.Back(); elem != nil; {
		prev := elem.Prev()
		entry := elem.Value.(*CacheEntry)
		if entry.IsExpired() {
			c.evict(elem)
		}
		elem = prev
	}
}

// isSelectQuery checks if SQL is a SELECT query (case insensitive).
func isSelectQuery(sql string) bool {
	if len(sql) < 6 {
		return false
	}
	return len(sql) >= 6 && (sql[0] == 'S' || sql[0] == 's') &&
		(sql[1] == 'E' || sql[1] == 'e') &&
		(sql[2] == 'L' || sql[2] == 'l') &&
		(sql[3] == 'E' || sql[3] == 'e') &&
		(sql[4] == 'C' || sql[4] == 'c') &&
		(sql[5] == 'T' || sql[5] == 't')
}

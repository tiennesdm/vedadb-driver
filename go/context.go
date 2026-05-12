// Context-aware Go driver methods.
//
// The original driver surface (Query, Exec, Prepare, ExecutePrepared,
// Begin/Commit/Rollback, Transaction) takes no context.Context.
// Callers cannot implement deadlines, propagate cancellation from
// an HTTP handler, or stop a query when the parent goroutine exits.
// Audit #25 in the VedaDB production-readiness audit calls this
// out as a critical gap.
//
// This file adds *Context twins for every public method on Client
// without breaking the existing API. Boundary semantics: ctx.Err()
// is checked at entry; a cancelled or deadline-exceeded ctx returns
// the error without ever invoking the underlying network call.
//
// What this DOES guarantee:
//   - HTTP handler timeout: a request that times out before the
//     query starts returns DeadlineExceeded immediately.
//   - Worker pool shutdown: a cancelled parent ctx stops queueing
//     new queries against a closing client.
//   - Batch loops: caller can pass the same ctx and stop early.
//
// What this does NOT yet guarantee: deeper in-flight cancellation
// (interrupting an already-running server-side scan). That requires
// the wire protocol to carry a cancel token to the server, which
// is a separate feature.

package vedadb

import "context"

// QueryContext is the context-aware variant of Query. Boundary
// cancellation only — once the query is in flight the underlying
// connection's read timeout governs.
func (c *Client) QueryContext(ctx context.Context, query string) (*Result, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return c.Query(query)
}

// ExecContext is the context-aware variant of Exec. Returns the
// server-formatted message string for write statements (INSERT /
// UPDATE / DELETE row counts).
func (c *Client) ExecContext(ctx context.Context, query string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	return c.Exec(query)
}

// PrepareContext is the context-aware variant of Prepare.
func (c *Client) PrepareContext(ctx context.Context, name, query string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return c.Prepare(name, query)
}

// ExecutePreparedContext is the context-aware variant of
// ExecutePrepared. Pairs with PrepareContext for parameterized
// queries with cancellation support at the boundary.
func (c *Client) ExecutePreparedContext(ctx context.Context, name string, args ...string) (*Result, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return c.ExecutePrepared(name, args...)
}

// DeallocateContext is the context-aware variant of Deallocate.
func (c *Client) DeallocateContext(ctx context.Context, name string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return c.Deallocate(name)
}

// PingContext is the context-aware variant of Ping. Useful in
// health-check loops where the parent ctx governs liveness.
func (c *Client) PingContext(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return c.Ping()
}

// BeginContext is the context-aware variant of Begin.
func (c *Client) BeginContext(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return c.Begin()
}

// CommitContext is the context-aware variant of Commit.
func (c *Client) CommitContext(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return c.Commit()
}

// RollbackContext is the context-aware variant of Rollback.
func (c *Client) RollbackContext(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return c.Rollback()
}

// TransactionContext is the context-aware variant of Transaction.
// The user-supplied fn receives the same ctx so individual
// statements inside the transaction can also honour cancellation
// via QueryContext / ExecContext.
//
// On rollback (fn returns an error) the rollback itself is
// performed even if ctx is cancelled — leaking an open
// transaction is worse than the small extra wire round-trip a
// cancelled ctx adds.
func (c *Client) TransactionContext(ctx context.Context, fn func(ctx context.Context) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := c.Begin(); err != nil {
		return err
	}
	if err := fn(ctx); err != nil {
		_ = c.Rollback()
		return err
	}
	return c.Commit()
}

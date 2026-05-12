using System;
namespace VedaDB;

/// <summary>
/// States for the circuit breaker pattern.
/// </summary>
public enum CircuitState
{
    /// <summary>Circuit is closed, requests flow through normally.</summary>
    Closed,
    /// <summary>Circuit is open, requests are rejected immediately.</summary>
    Open,
    /// <summary>Circuit is half-open, allowing a test request.</summary>
    HalfOpen
}

/// <summary>
/// Configuration for the circuit breaker.
/// </summary>
public class VedaCircuitBreakerConfig
{
    /// <summary>
    /// Number of failures before opening the circuit. Default is 5.
    /// </summary>
    public int FailureThreshold { get; set; } = 5;

    /// <summary>
    /// Time before transitioning from Open to HalfOpen in seconds. Default is 30.
    /// </summary>
    public int RecoveryTimeoutSeconds { get; set; } = 30;

    /// <summary>
    /// Number of consecutive successes in HalfOpen to close the circuit. Default is 2.
    /// </summary>
    public int SuccessThreshold { get; set; } = 2;

    /// <summary>
    /// Window duration for counting failures in seconds. Default is 60.
    /// </summary>
    public int FailureWindowSeconds { get; set; } = 60;
}

/// <summary>
/// Circuit breaker pattern implementation for VedaDB connections.
/// Prevents cascading failures by rejecting requests when the system is unhealthy.
/// </summary>
public class VedaCircuitBreaker
{
    private readonly VedaCircuitBreakerConfig _config;
    private readonly object _lock = new();
    private CircuitState _state = CircuitState.Closed;
    private int _consecutiveSuccesses;
    private DateTime _lastFailureTime = DateTime.MinValue;
    private DateTime _openedTime = DateTime.MinValue;
    private readonly Queue<DateTime> _failures = new();

    /// <summary>
    /// Current state of the circuit.
    /// </summary>
    public CircuitState State
    {
        get
        {
            lock (_lock)
            {
                MaybeTransitionToHalfOpen();
                return _state;
            }
        }
    }

    /// <summary>
    /// Number of failures in the current window.
    /// </summary>
    public int FailureCount
    {
        get
        {
            lock (_lock)
            {
                PruneFailures();
                return _failures.Count;
            }
        }
    }

    /// <summary>
    /// Event raised when the circuit state changes.
    /// </summary>
    public event EventHandler<CircuitState>? StateChanged;

    /// <summary>
    /// Create a circuit breaker with default configuration.
    /// </summary>
    public VedaCircuitBreaker() : this(new VedaCircuitBreakerConfig()) { }

    /// <summary>
    /// Create a circuit breaker with specified configuration.
    /// </summary>
    public VedaCircuitBreaker(VedaCircuitBreakerConfig config)
    {
        _config = config ?? throw new ArgumentNullException(nameof(config));
    }

    /// <summary>
    /// Execute an operation through the circuit breaker.
    /// </summary>
    public async Task<T> ExecuteAsync<T>(Func<Task<T>> operation, CancellationToken ct = default)
    {
        if (!CanExecute())
            throw new VedaCircuitBreakerOpenException("Circuit breaker is open");

        try
        {
            var result = await operation();
            RecordSuccess();
            return result;
        }
        catch (Exception ex)
        {
            RecordFailure();
            throw;
        }
    }

    /// <summary>
    /// Execute an operation without return value.
    /// </summary>
    public async Task ExecuteAsync(Func<Task> operation, CancellationToken ct = default)
    {
        await ExecuteAsync(async () => { await operation(); return true; }, ct);
    }

    /// <summary>
    /// Record a successful operation.
    /// </summary>
    public void RecordSuccess()
    {
        lock (_lock)
        {
            _consecutiveSuccesses++;

            if (_state == CircuitState.HalfOpen && _consecutiveSuccesses >= _config.SuccessThreshold)
            {
                TransitionTo(CircuitState.Closed);
            }

            _failures.Clear();
        }
        VedaMetrics.Gauge("vedadb_circuit_breaker_state", _state == CircuitState.Closed ? 0 : _state == CircuitState.HalfOpen ? 1 : 2);
    }

    /// <summary>
    /// Record a failed operation.
    /// </summary>
    public void RecordFailure()
    {
        lock (_lock)
        {
            var now = DateTime.UtcNow;
            _lastFailureTime = now;
            _consecutiveSuccesses = 0;
            _failures.Enqueue(now);
            PruneFailures();

            if (_state == CircuitState.HalfOpen || _failures.Count >= _config.FailureThreshold)
            {
                TransitionTo(CircuitState.Open);
                _openedTime = now;
            }
        }
        VedaMetrics.Gauge("vedadb_circuit_breaker_state", _state == CircuitState.Closed ? 0 : _state == CircuitState.HalfOpen ? 1 : 2);
        VedaMetrics.Increment("vedadb_circuit_breaker_failures");
    }

    /// <summary>
    /// Check if an operation can be executed.
    /// </summary>
    public bool CanExecute()
    {
        lock (_lock)
        {
            MaybeTransitionToHalfOpen();
            return _state == CircuitState.Closed || _state == CircuitState.HalfOpen;
        }
    }

    /// <summary>
    /// Manually reset the circuit to closed state.
    /// </summary>
    public void Reset()
    {
        lock (_lock)
        {
            TransitionTo(CircuitState.Closed);
            _consecutiveSuccesses = 0;
            _failures.Clear();
        }
    }

    private void MaybeTransitionToHalfOpen()
    {
        if (_state == CircuitState.Open)
        {
            var elapsed = DateTime.UtcNow - _openedTime;
            if (elapsed.TotalSeconds >= _config.RecoveryTimeoutSeconds)
            {
                TransitionTo(CircuitState.HalfOpen);
                _consecutiveSuccesses = 0;
            }
        }
    }

    private void TransitionTo(CircuitState newState)
    {
        if (_state == newState) return;
        var oldState = _state;
        _state = newState;
        StateChanged?.Invoke(this, newState);
        VedaMetrics.Increment("vedadb_circuit_breaker_transitions", 1,
            new() { { "from", oldState.ToString() }, { "to", newState.ToString() } });
    }

    private void PruneFailures()
    {
        var cutoff = DateTime.UtcNow.AddSeconds(-_config.FailureWindowSeconds);
        while (_failures.Count > 0 && _failures.Peek() < cutoff)
            _failures.Dequeue();
    }
}

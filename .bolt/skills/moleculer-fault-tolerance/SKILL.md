---
name: moleculer-fault-tolerance
description: Conventions for configuring Moleculer's fault tolerance features — circuit breaker, retry, timeout, bulkhead, fallback, and context tracking. Use whenever the user asks to make a service resilient, configure retry policies, set up circuit breakers, handle timeouts, limit concurrency, provide fallback responses, or troubleshoot cascading failures. Also use when the user asks about error handling, graceful shutdown, or request resilience in a Moleculer application.
---

# Moleculer Fault Tolerance

Guidance for configuring the five fault tolerance middlewares and the error handling pipeline. Based on Moleculer 0.15.x source.

## How they stack

The five fault tolerance middlewares wrap every action call in this order (internal registration order):

```
Request → ActionHook → Validator → Bulkhead → Cacher → ContextTracker → CircuitBreaker → Timeout → Retry → Fallback → ErrorHandler → Handler
```

First-registered middleware is the **outermost** wrapper. This means:
- `ErrorHandler` is closest to the handler — it's the last to catch errors
- `Bulkhead` is outermost — it rejects before any other middleware runs if the queue is full
- `CircuitBreaker` checks the endpoint state before `Timeout` or `Retry`

Each middleware can be configured at three levels: broker defaults, per-action overrides, and per-call options. Action-level overrides win over broker defaults. Per-call options win over both.

## Circuit breaker

Trips when the failure rate exceeds a threshold over a time window, preventing requests to a failing endpoint.

### Configuration

```js
// Broker level
circuitBreaker: {
  enabled: true,           // must be true to activate
  threshold: 0.5,          // 50% failure rate trips the breaker
  minRequestCount: 20,     // need at least 20 requests before evaluating
  windowTime: 60,          // reset counters every 60 seconds
  halfOpenTime: 10000,     // 10s in OPEN before HALF_OPEN trial
  check: err => err && err.code >= 500  // which errors count as failures
}

// Per-action override
actions: {
  risky: {
    circuitBreaker: { enabled: true, threshold: 0.3 },
    handler(ctx) { ... }
  }
}
```

### State machine

- **CLOSED** (normal): requests flow. Success increments count, failure increments count + failures. When `count >= minRequestCount && failures/count >= threshold` → trips to OPEN.
- **OPEN**: endpoint is marked unavailable (`ep.state = false`), removed from load balancing. After `halfOpenTime` ms → transitions to HALF_OPEN.
- **HALF_OPEN**: endpoint re-enabled. The next request triggers a transition to HALF_OPEN_WAIT (endpoint disabled again). If that request succeeds → CLOSED. If it fails → back to HALF_OPEN after another `halfOpenTime`.
- **HALF_OPEN_WAIT**: exactly one trial request is let through. An anti-stick timer re-arms `halfOpenTime` so that if the trial never returns, the breaker eventually retries.

### Key behaviors

- Only **locally-originated** errors trip the breaker. If `err.nodeID` doesn't match the local node (i.e., the error came from a remote call), it's not counted. This prevents one node's failures from tripping another node's breaker for the same endpoint.
- The window timer is a single shared `setInterval` (unref'd). All endpoints share one timer.
- The `check` predicate determines which errors count. The default counts any error with `code >= 500`. Override to exclude specific error types.
- Broadcasts `$circuit-breaker.opened`, `$circuit-breaker.half-opened`, `$circuit-breaker.closed` events.
- Both `localAction` and `remoteAction` are wrapped — the breaker protects both legs.

## Retry

Retries failed calls with exponential backoff.

### Configuration

```js
// Broker level
retryPolicy: {
  enabled: true,
  retries: 3,              // max retry attempts
  delay: 100,              // base delay in ms
  maxDelay: 2000,          // ceiling on computed delay
  factor: 2,               // exponential backoff multiplier
  check: err => err && !!err.retryable  // which errors trigger retry
}

// Per-action override
actions: {
  flaky: {
    retryPolicy: { enabled: true, retries: 5 },
    handler(ctx) { ... }
  }
}

// Per-call override
broker.call("flaky.action", params, { retries: 10 });
```

### Algorithm

1. Call handler. On rejection:
2. Skip if this is a remote call that executed locally (`ctx.nodeID != broker.nodeID && ctx.endpoint.local`) — the calling node's `remoteAction` wrapper handles retry instead. This prevents double-retry.
3. If `check(err)` is true and attempts remain:
4. Compute delay: `min(delay * factor^(attempt-1), maxDelay)`
5. Wait `delay` ms
6. Create a **new context** via `ctx.copy()` (preserves `_retryAttempts`)
7. Re-issue `broker.call` (or `ctx.service.actions[rawName]` for private actions) with the new context
8. The **full middleware stack re-runs** on each retry — timeout, bulkhead, circuit breaker, validator, hooks all re-execute

### Key behaviors

- The retry re-issues a fresh `broker.call`, not a direct handler re-invocation. This means each retry attempt gets fresh timeout, fresh validation, fresh circuit breaker checks.
- `ctx.copy()` preserves params, meta, requestID, level, parentID — but creates a new context ID.
- `_retryAttempts` is explicitly transferred to the copied context.
- The tracing span is finished and re-tagged before the retry so the new call starts a fresh span.
- `RequestSkippedError` (from distributed timeout) has `retryable = false` — it won't be retried.
- `MoleculerClientError` (4xx) has `retryable = false` — client errors won't retry by default.

## Timeout

Enforces a maximum duration for action execution.

### Configuration (precedence)

1. `ctx.options.timeout` — per-call (highest)
2. `action.timeout` — per-action
3. `broker.options.requestTimeout` — broker default (lowest)

If none are set (or all are 0), no timeout is enforced.

### Algorithm

1. Resolve timeout per the precedence above.
2. If `timeout > 0` and `ctx.startHrTime` is not set, set it to `process.hrtime()` (for distributed timeout propagation).
3. Call `handler(ctx)` → returns a promise.
4. If the promise has a `.timeout()` method (Bluebird feature): `p.timeout(timeout)`.
5. On `TimeoutError` catch: log warning, convert to `RequestTimeoutError` with action + nodeID. If `ctx.params` is a Stream, emit `"moleculer-timeout-middleware"` on it to signal upstream producers to stop.
6. If the promise lacks `.timeout()` (native Promise): **no timeout enforcement occurs** — the handler runs unbounded.

### Key behaviors

- Timeout relies on the Promise library having a `.timeout()` method. Native `Promise` does not have this. If you're using native Promise (the default), timeout **does not work** unless you've polyfilled it. The broker calls `utils.polyfillPromise` in the constructor which may add `.timeout()` to native Promise — verify in your environment.
- `ctx.startHrTime` is only set if absent, preserving the start time from the originating node for distributed timeout accounting.
- The distributed timeout in `Context.call` subtracts elapsed time from the remaining timeout — so the total chain time can't exceed the root timeout.

## Bulkhead

Limits concurrent execution per action/event.

### Configuration

```js
// Broker level
bulkhead: {
  enabled: true,
  concurrency: 10,        // max concurrent executions
  maxQueueSize: 100        // max queued (0 = unlimited — memory risk)
}

// Per-action override
actions: {
  heavy: {
    bulkhead: { enabled: true, concurrency: 3, maxQueueSize: 50 },
    handler(ctx) { ... }
  }
}
```

### Algorithm

1. If `currentInFlight < concurrency`: call handler directly. On settle, decrement and drain queue.
2. If at capacity: if `maxQueueSize > 0 && queue.length >= maxQueueSize` → reject with `QueueIsFullError` (code 429, retryable). Otherwise queue the request and return a new Promise.
3. Queue is FIFO. When a slot frees, the next queued request executes.

### Key behaviors

- **Local only** — no `remoteAction` hook. Bulkhead limits concurrency on the node that executes the handler.
- The queue is **per-action** (closure-scoped), not global. Each action has its own concurrency limit and queue.
- `maxQueueSize: 0` disables the queue-full check → unbounded queueing. Under sustained overload, memory grows until OOM. Always set a finite `maxQueueSize`.
- Events also support bulkhead (via `localEvent` hook) with the same algorithm.

## Fallback

Provides an alternative response when an action fails.

### Two mechanisms

1. **Per-call** (`ctx.options.fallbackResponse`): can be a function `(ctx, err) => value` or a static value. Works for **both** local and remote calls. Checked first.
2. **Action-level** (`action.fallback`): a function or a string naming a service method. Only fires **locally** (requires `action.service` to be present). For remote calls, the remote error propagates and only the caller's `fallbackResponse` can catch it.

### Algorithm

1. Call handler. On rejection:
2. If `ctx.options.fallbackResponse` is set: call it (if function) with `(ctx, err)`, or resolve the static value. Set `ctx.fallbackResult = true`.
3. Else if `action.fallback` exists with a service: resolve the fallback (string → look up `service[action.fallback]`). Call it with `(ctx, err)`. Set `ctx.fallbackResult = true`.
4. Else re-reject.

### Key behaviors

- `ctx.fallbackResult = true` is set so downstream code can detect that the result came from a fallback.
- The per-call `fallbackResponse` is the only way to provide fallback for remote calls — the action's own `fallback` won't fire on the caller side.
- String fallbacks that don't resolve to a service method throw `MoleculerError`.

## Error handler

The terminal error handler in the stack. Wraps every action and event.

### Algorithm

1. Call handler. On rejection:
2. If `err` is not an `instanceof Error`: wrap as `new MoleculerError(err, 500)`.
3. If remote request (`ctx.nodeID !== this.nodeID`) and transit exists: `transit.removePendingRequest(ctx.id)` — cleans up the pending request tracker.
4. Set `err.ctx = ctx` (non-enumerable).
5. Call `broker.errorHandler(err, { ctx, service, action })`.
6. If `broker.errorHandler` re-throws → error propagates. If it returns → that value becomes the response.

### Key behaviors

- The `errorHandler` is the broker's global handler (set via `options.errorHandler`). If not set, it re-throws.
- Non-Error rejections (strings, objects) are coerced to `MoleculerError` with code 500.
- `err.ctx` is non-enumerable so it doesn't serialize into transit or logs.
- This middleware should be ordered outermost (last applied / first in execution) — and it is, by internal registration order.

## Context tracking (graceful shutdown)

Tracks in-flight contexts for graceful shutdown.

### Configuration

```js
tracking: {
  enabled: true,
  shutdownTimeout: 5000  // ms
}
```

Per-service override: `settings.$shutdownTimeout`.

### Algorithm

- Every action and event context is added to a tracking list on creation and removed on settle.
- During shutdown: `serviceStopping` waits for `service._trackedContexts` (up to `$shutdownTimeout` or global `shutdownTimeout`).
- `stopping` waits for `broker._trackedContexts`.
- Polls every 100ms. On timeout: logs `GracefulStopTimeoutError`, force-clears the list, and resolves. Running contexts are **not cancelled** — they continue but their removal from the list is a harmless no-op.

## Common configuration mistakes

- **Enabling retry without timeout.** Without timeout, a hung service retries indefinitely (up to `retries` count) with no ceiling. Always set `requestTimeout` when using retry.
- **Setting `maxQueueSize: 0` on bulkhead.** This creates unbounded memory growth. Always set a finite value.
- **Expecting action-level `fallback` to work for remote calls.** It only fires locally. Use `ctx.options.fallbackResponse` for remote fallback.
- **Not understanding that retry re-runs the full stack.** Each retry attempt re-validates, re-checks the circuit breaker, re-applies timeout. This is correct behavior but means retry amplifies load — set reasonable `retries` and `delay`.
- **Forgetting that circuit breaker only counts local errors.** If node A calls node B and B returns an error, A's breaker for that endpoint doesn't trip — only B's local breaker counts B's handler failures.
- **Not setting `check` on circuit breaker.** The default counts `code >= 500`. If your service throws custom errors without a code, they won't trip the breaker. Ensure errors have proper codes.

## Source files

When moleculer is installed as a dependency, the full source is at `node_modules/moleculer/src/`. Read these files to verify behavior or dig deeper:

- `node_modules/moleculer/src/middlewares/circuit-breaker.js` — CB state machine (CLOSED/OPEN/HALF_OPEN/HALF_OPEN_WAIT), `resetStore`, `trip`, `halfOpen`, `checkThreshold`, per-endpoint state Map, window timer
- `node_modules/moleculer/src/middlewares/retry.js` — retry algorithm, exponential backoff computation, double-retry prevention guard, `ctx.copy()` on retry
- `node_modules/moleculer/src/middlewares/timeout.js` — timeout resolution precedence, `startHrTime` setting, Bluebird `.timeout()` dependency, stream timeout signaling
- `node_modules/moleculer/src/middlewares/bulkhead.js` — concurrency queue per-action, `QueueIsFullError` rejection, `callNext` drain logic
- `node_modules/moleculer/src/middlewares/fallback.js` — per-call `fallbackResponse` vs action-level `action.fallback`, `ctx.fallbackResult` flag
- `node_modules/moleculer/src/middlewares/error-handler.js` — non-Error coercion, `transit.removePendingRequest` cleanup, `broker.errorHandler` delegation
- `node_modules/moleculer/src/middlewares/context-tracker.js` — in-flight tracking, `waitingForActiveContexts` graceful shutdown polling, force-clear on timeout
- `node_modules/moleculer/src/errors.js` — full error hierarchy, `retryable` flags, `MoleculerError`/`MoleculerRetryableError`/`MoleculerClientError`/`RequestSkippedError`/`QueueIsFullError`

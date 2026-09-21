---
name: moleculer-observability
description: Conventions for configuring Moleculer's observability features — distributed tracing, metrics collection, logging, and error classes. Use whenever the user asks to add tracing, metrics, or logging to a Moleculer app, configure exporters or reporters, customize log formats, handle or create custom errors, or troubleshoot observability issues. Also use when the user asks about Jaeger, Zipkin, Datadog, Prometheus, OpenTelemetry, log levels, or error types in a Moleculer application.
---

# Moleculer Observability

Guidance for tracing, metrics, logging, and error handling. Based on Moleculer 0.15.x source.

## Tracing

Distributed tracing tracks request flow across services. Each action call creates a span; nested calls create child spans forming a trace tree.

### Enabling tracing

```js
tracing: {
  enabled: true,
  exporter: "Console",  // or "Jaeger", "Zipkin", "Datadog", "NewRelic", "Event", or array
  sampling: {
    rate: 1.0,            // 0 = never, 1.0 = always, 0.5 = 50% of traces
    tracesPerSecond: null, // if set, rate-limit sampling (overrides rate)
    minPriority: null      // reject spans with priority < this
  },
  actions: true,          // trace action calls (default true)
  events: false,          // trace event handlers (default false)
  stackTrace: false,      // include stack traces in error fields
  errorFields: ["name", "message", "code", "type", "data"],
  defaultTags: null,      // object or function(tracer) → tags added to every span
  tags: {
    action: null,          // function(ctx) → tags for action spans, or object
    event: null            // function(ctx) → tags for event spans, or object
  }
}
```

### Sampling algorithm

1. If `minPriority != null` and `span.priority < minPriority` → reject.
2. If `rateLimiter` exists (from `tracesPerSecond`) → `rateLimiter.check()`.
3. If `rate === 0` → reject. If `rate === 1.0` → accept.
4. Otherwise: probabilistic — increments a counter, accepts when `counter * rate >= 1.0`, then resets.

### Exporters

| Type | String | Notes |
|------|--------|-------|
| Console | `"Console"` | Logs spans to console. Good for development. |
| Jaeger | `"Jaeger"` | Sends to Jaeger via `jaeger-client`. |
| Zipkin | `"Zipkin"` | Sends to Zipkin. |
| Datadog | `"Datadog"` | Sends to Datadog via `dd-trace`. |
| NewRelic | `"NewRelic"` | Sends to New Relic. |
| Event | `"Event"` | Emits `$tracing.span` events for custom consumption. |

```js
tracing: {
  exporter: [
    { type: "Jaeger", options: { host: "jaeger.example.com", port: 6832 } },
    { type: "Console" }
  ]
}
```

String form instantiates with no options. Object form passes `opt.options`.

### Tracing middleware behavior

The tracing middleware wraps `localAction` (if `tracing.actions` is true) and `localEvent` (if `tracing.events` is true). For each call:

1. Creates a span via `ctx.startSpan` with `type: "action"` or `"event"`.
2. Default tags include: `callingLevel`, `action.name`, `action.rawName`, `remoteCall`, `callerNodeID`, `nodeID`, `requestID`, `options.timeout`, `options.retries`.
3. **Params are captured by default** (`params: true`) — this is a PII concern. Restrict with `tracing.tags.action` or per-action `action.tracing.tags`.
4. Tag resolution: local `action.tracing.tags` (function) > global `tracing.tags.action` (function) > merged object.
5. `params: true` → shallow clone if object, raw otherwise. `params: ["field1", "field2"]` → `_.pick` only those fields.
6. `action.tracing.safetyTags` → sanitization of sensitive fields.
7. On success: adds `fromCache` tag + response tags, finishes span.
8. On error: `span.setError(err)`, finishes span, rethrows.

### Per-action tracing control

```js
actions: {
  sensitive: {
    tracing: {
      tags: { params: ["id"], response: false }  // only capture id, no response
    },
    handler(ctx) { ... }
  },
  notTraced: {
    tracing: false,  // disable tracing for this action
    handler(ctx) { ... }
  }
}
```

### Span API (from context)

Inside a handler, you can create custom child spans:
```js
async handler(ctx) {
  const span = ctx.startSpan("database-query", { tags: { table: "users" } });
  const result = await this.queryDatabase();
  span.addTags({ rowCount: result.length });
  ctx.finishSpan(span);
  return result;
}
```

### Gotchas

- AsyncStorage-based scope is **disabled** in this version. `tracer.getCurrentTraceID()` returns `null`. Context-based active-span tracking relies on `ctx.requestID`/`ctx.parentID` being pre-populated.
- `opts === true/false` is normalized to `{enabled: opts}`.
- Default captures **all params** — a PII leak risk. Always restrict params in production.

## Metrics

Metrics collect quantitative data about the system — request counts, durations, error rates, circuit breaker states.

### Enabling metrics

```js
metrics: {
  enabled: true,
  reporter: "Console",  // or "Prometheus", "Datadog", "CSV", "StatsD", "Event", or array
  collectProcessMetrics: true,  // default: true (false in test env)
  collectInterval: 5,           // seconds
  defaultBuckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],  // ms
  defaultQuantiles: [0.5, 0.9, 0.95, 0.99, 0.999],
  defaultMaxAgeSeconds: 60,
  defaultAgeBuckets: 10,
  defaultAggregator: "sum"
}
```

### Metric types

| Type | String | Methods | Notes |
|------|--------|---------|-------|
| Counter | `"counter"` | increment, decrement | Monotonic counter. |
| Gauge | `"gauge"` | set, increment, decrement | Current value. |
| Histogram | `"histogram"` | observe | Distribution. Uses buckets + quantiles. |
| Info | `"info"` | set | Static info (version, hostname). |

### Reporters

| Type | String | Notes |
|------|--------|-------|
| Console | `"Console"` | Logs metrics to console. |
| Prometheus | `"Prometheus"` | Exposes `/metrics` endpoint. |
| Datadog | `"Datadog"` | Sends to Datadog API. |
| CSV | `"CSV"` | Writes to CSV file. |
| StatsD | `"StatsD"` | Sends via StatsD protocol. |
| Event | `"Event"` | Emits `$metrics.snapshot` events. |

### Built-in metrics (auto-registered)

When metrics are enabled, the middleware registers:

**Request metrics:**
- `moleculer.request.total` (counter) — total requests, labels: `service, action, type, caller`
- `moleculer.request.active` (gauge) — in-flight requests
- `moleculer.request.error.total` (counter) — errors, labels: `service, action, type, caller, errorName, errorCode, errorType`
- `moleculer.request.time` (histogram) — duration in ms
- `moleculer.request.levels` (counter) — call depth, label: `level`

**Event metrics:**
- `moleculer.event.emit.total`, `moleculer.event.broadcast.total`, `moleculer.event.broadcast-local.total` (counters)
- `moleculer.event.received.total` (counter), `.active` (gauge), `.error.total` (counter), `.time` (histogram)

**Transit/transporter metrics:**
- `moleculer.transit.publish.total`, `moleculer.transit.receive.total` (counters)
- `moleculer.transit.requests.active` (gauge)
- `moleculer.transporter.packets.sent.total`, `.bytes`, `.received.total`, `.bytes` (counters)

**Circuit breaker, bulkhead, retry, timeout, fallback, cacher metrics** — all auto-registered by their respective middlewares.

### Custom metrics

```js
// Register a custom metric
broker.metrics.register({
  name: "my.custom.counter",
  type: "counter",
  description: "Custom counter",
  labelNames: ["category"]
});

// Use it
broker.metrics.increment("my.custom.counter", 1, { labels: { category: "A" } });
```

### Gotchas

- `collectProcessMetrics` defaults **off in test env** (`NODE_ENV === "test"`) — behavior differs in tests.
- `register()` returns `null` when metrics are disabled — callers must null-check.
- `caller` label comes from `ctx.caller` — high cardinality if many different callers. Can explode label space in Prometheus.
- `type` label distinguishes `"local"` vs `"remote"` action invocations.

## Logging

### Configuration

```js
logger: {
  type: "Console",
  options: {
    level: "info",          // or "fatal", "error", "warn", "debug", "trace"
    colors: true,           // ANSI colors
    formatter: "full",      // "full", "short", "simple", "json", "jsonext", or custom string/function
    moduleColors: true,     // color per module name
    autoPadding: false      // pad module names to max width
  }
}
```

### Log levels

`fatal`, `error`, `warn`, `info`, `debug`, `trace` — in decreasing severity. Set the level to filter output.

Per-module log levels via object:
```js
logLevel: {
  "**": "info",            // default for all
  "broker": "debug",       // broker module
  "transit": "warn",       // transit module
  "math*": "debug"         // glob pattern
}
```

### Formatters

| Format | Output |
|--------|--------|
| `"full"` (default) | `[ISO] LEVEL nodeID/MOD: msg` |
| `"short"` | `[HH:MM:SS.mmmZ] LEVEL MOD: msg` |
| `"simple"` | `LEVEL - msg` |
| `"json"` | `{"ts":..., "level":..., "msg":..., ...bindings}` (disables colors globally) |
| `"jsonext"` | `{"time":"ISO", "level":..., "message":..., ...bindings}` |
| Custom string | `"{timestamp} {level} {nodeID} {mod}: {msg}"` |
| Function | `formatter.call(this, type, args, bindings, { printArgs })` |

### Built-in loggers

`Console` (default), `Formatted` (base for Console), `Bunyan`, `Datadog`, `Debug` (debug npm package), `File`, `Log4js`, `Pino`, `Winston`.

### Getting a logger in a service

```js
module.exports = {
  name: "math",
  created() {
    this.logger.info("Service created");  // this.logger is pre-configured
  }
};
```

The logger is automatically scoped with `nodeID`, `ns` (namespace), `mod` (service full name), `svc`, `ver`.

### Gotchas

- `"json"` and `"jsonext"` formatters **mutate `kleur.enabled = false` globally** — colors are force-disabled process-wide.
- `autoPadding` tracks `maxPrefixLength` dynamically — only `short` and `full` formatters update it.
- String form for logger resolution passes **no options**. Use object form `{ type: "Pino", options: { ... } }` to pass config.

## Error classes

All Moleculer errors extend `ExtendableError` (which extends `Error`).

### Error hierarchy

```
Error
  └─ ExtendableError
       ├─ MoleculerError (code=500, retryable=false)
       │    ├─ MoleculerClientError (code=400, retryable=false)
       │    └─ MoleculerRetryableError (retryable=true)
       │         ├─ MoleculerServerError
       │         ├─ ServiceNotFoundError (code=404, retryable=true)
       │         ├─ ServiceNotAvailableError (code=404, retryable=true)
       │         ├─ RequestTimeoutError (code=504, retryable=true)
       │         ├─ RequestRejectedError (code=503, retryable=true)
       │         ├─ QueueIsFullError (code=429, retryable=true)
       │         └─ BrokerDisconnectedError (code=502, retryable=true, stack="")
       ├─ RequestSkippedError (code=514, retryable=false)
       └─ TimeoutError
```

### Creating custom errors

```js
const { MoleculerError, MoleculerRetryableError } = require("moleculer").Errors;

class PaymentFailedError extends MoleculerError {
  constructor(message, data) {
    super(message, 402, "PAYMENT_FAILED", data);
  }
}

class TemporaryDBError extends MoleculerRetryableError {
  constructor(message) {
    super(message, 503, "DB_TEMPORARY_ERROR");
  }
}
```

The `retryable` flag determines whether the retry middleware will retry the error. Set `retryable = true` for transient failures (database timeouts, service unavailable). Set `retryable = false` for permanent failures (validation errors, not found).

### Error properties

- `message` — error message (non-enumerable)
- `name` — constructor name (non-enumerable)
- `code` — numeric HTTP-like code
- `type` — string error type identifier
- `data` — additional data payload
- `retryable` — whether retry should attempt this error
- `ctx` — set by the error handler middleware (non-enumerable) — the context that triggered the error

### Gotchas

- `MoleculerClientError` defaults code to **400** (not 500). Use for client-side errors (bad input, unauthorized).
- `BrokerDisconnectedError` wipes its own stack trace (`this.stack = ""`) to reduce log noise.
- `RequestSkippedError` explicitly sets `retryable = false` even though it extends `MoleculerError` (not `MoleculerRetryableError`). Distributed timeout produces this — retrying would just timeout again.
- Non-Error rejections (strings, objects) in action handlers are coerced to `MoleculerError(err, 500)` by the error handler middleware.

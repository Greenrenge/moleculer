---
name: moleculer-broker-config
description: Conventions for configuring the Moleculer ServiceBroker — broker options, middleware ordering, lifecycle management, and runner setup. Use whenever the user asks to create a broker configuration file, configure broker options, set up middleware, start or stop a broker, use the moleculer-runner CLI, or troubleshoot broker startup/shutdown issues. Also use when the user asks about namespace, nodeID, heartbeat, tracking, or internal services configuration.
---

# Moleculer Broker Configuration

Guidance for configuring the `ServiceBroker` — the central orchestrator that manages services, middleware, transit, caching, and lifecycle. Based on Moleculer 0.15.x source.

## Creating a broker

```js
const { ServiceBroker } = require("moleculer");
const broker = new ServiceBroker(options);
```

The constructor merges user options with defaults via `lodash.defaultsDeep`. Every option below has a default — you only need to specify what you want to change.

## Key configuration options

### Identity
- `namespace` (default `""`) — isolates clusters. Nodes with different namespaces never see each other. Use for staging vs. production, or multi-tenant isolation.
- `nodeID` (default auto-generated from hostname + PID) — unique node identifier. Set explicitly in production for predictable logging.

### Transport
- `transporter` (default `null`) — the message bus. `null` means single-node (no network). Common values: `"TCP"`, `"nats://localhost:4222"`, `"redis://localhost:6379"`, `"amqp://localhost"`. See the transport-network skill for full details.
- `disableBalancer` (default `false`) — when `true`, delegates load balancing to the transporter (only works with transporters that have a built-in balancer: NATS, AMQP, Redis, Kafka). If the transporter lacks a balancer, the broker logs a warning and keeps its own.

### Request behavior
- `requestTimeout` (default `0` = no timeout) — global default timeout for action calls in milliseconds. Per-action `action.timeout` and per-call `ctx.options.timeout` override this. Set to a reasonable value (e.g., `10000`) in production to prevent indefinite hangs.
- `maxCallLevel` (default `0` = unlimited) — maximum call chain depth. Prevents infinite recursion. When `ctx.level >= maxCallLevel`, the call rejects with `MaxCallLevelError`.
- `contextParamsCloning` (default `false`) — when `true`, params are deep-cloned (`structuredClone`) on each context creation. Prevents accidental mutation of shared params across nested calls, at a performance cost. Enable if you see bugs from param mutation in call chains.

### Retry policy
```js
retryPolicy: {
  enabled: false,       // must be true to enable retries
  retries: 5,           // max attempts
  delay: 100,           // base delay in ms
  maxDelay: 1000,       // ceiling on computed delay
  factor: 2,            // exponential backoff multiplier
  check: err => err && !!err.retryable  // predicate
}
```
The `check` function determines which errors trigger a retry. The default checks `err.retryable` — which is `true` on `MoleculerRetryableError` subclasses (timeout, service not found, server errors) and `false` on client errors. Override `check` to customize.

### Circuit breaker
```js
circuitBreaker: {
  enabled: false,
  threshold: 0.5,        // failure rate (0-1) that trips the breaker
  windowTime: 60,       // seconds — counter reset interval
  minRequestCount: 20,  // minimum requests before threshold is evaluated
  halfOpenTime: 10000,  // ms in OPEN state before transitioning to HALF_OPEN
  check: err => err && err.code >= 500
}
```
Only locally-originated errors trip the breaker (errors where `err.nodeID` matches the local node). Remote failures don't count. Per-action `action.circuitBreaker` overrides broker-level config.

### Bulkhead
```js
bulkhead: {
  enabled: false,
  concurrency: 10,      // max in-flight requests per action
  maxQueueSize: 100      // max queued requests (0 = unlimited — memory risk)
}
```
Bulkhead is **local-only** — it limits concurrency on the node executing the handler, not on the calling node. Per-action `action.bulkhead` overrides.

### Tracking (graceful shutdown)
```js
tracking: {
  enabled: false,
  shutdownTimeout: 5000  // ms to wait for in-flight contexts during shutdown
}
```
When enabled, the broker tracks all in-flight contexts and waits for them to complete (up to `shutdownTimeout`) before stopping. Per-service override with `settings.$shutdownTimeout`. The context tracker wraps both actions and events.

### Transit
```js
transit: {
  maxQueueSize: 50000,        // max queued transit packets
  maxChunkSize: 262144,      // 256KB — max packet chunk size
  disableReconnect: false,
  disableVersionCheck: false,
  serviceChangedDebounceTime: 1000  // ms — debounce for service change notifications
}
```

### Registry
```js
registry: {
  strategy: "RoundRobin",  // load balancing strategy
  preferLocal: true,       // prefer local endpoints over remote
  stopDelay: 100,          // ms delay before stopping services (lets pending requests drain)
  discoverer: "Local"      // service discovery mechanism
}
```
`preferLocal: true` means if the current node has the action, it calls locally without network overhead. Set to `false` for even distribution across nodes.

### Other options
- `logger` (default `true`) — `true` uses the console logger. Pass a string, object, or logger instance for other loggers. `false` disables logging.
- `logLevel` (default `null` = inherit) — `"fatal"`, `"error"`, `"warn"`, `"info"`, `"debug"`, `"trace"`. Can be a per-module map with glob keys.
- `cacher` (default `null`) — `true` for Memory, `"redis://..."` for Redis. See transport-network skill.
- `serializer` (default `null` = JSON) — `"JSON"`, `"MsgPack"`, `"CBOR"`, `"Notepack"`, `"JSONExt"`.
- `validator` (default `true`) — `true` uses fastest-validator. `false` disables validation.
- `metrics` (default `{ enabled: false }`) — see observability skill.
- `tracing` (default `{ enabled: false }`) — see observability skill.
- `hotReload` (default `false`) — enables hot-reloading of service files in development.
- `internalServices` (default `true`) — registers the `$node` internal service with actions like `$node.list`, `$node.services`, `$node.actions`.
- `internalMiddlewares` (default `true`) — registers all built-in middlewares. Set to `false` only if you want to manually control which middlewares are registered.
- `skipProcessEventRegistration` (default `false`) — when `true`, the broker does not register SIGINT/SIGTERM/beforeExit handlers. Set in environments that manage process lifecycle externally.
- `errorHandler` (default `null`) — global error handler `(err, info) => ...`. If it re-throws, the error propagates. If it returns a value, that becomes the response.
- `maxSafeObjectSize` (default `null`) — when set, objects larger than this (by `length` or `size` property) are trimmed during serialization to prevent memory issues.

## Middleware ordering

Internal middlewares are registered in this fixed order (when `internalMiddlewares` is `true`):

1. **ActionHook** — service-level before/after/error hooks for actions
2. **Validator** — params validation via fastest-validator
3. **Bulkhead** — concurrency limiting (local only)
4. **Cacher** — cache get/set
5. **ContextTracker** — in-flight context tracking for graceful shutdown
6. **CircuitBreaker** — failure rate monitoring and circuit opening
7. **Timeout** — request timeout enforcement
8. **Retry** — retry with exponential backoff
9. **Fallback** — fallback response on failure
10. **ErrorHandler** — global error handler delegation
11. **Tracing** — distributed tracing span creation
12. **Metrics** — request/event metrics collection
13. **Debounce** — event debouncing (events only)
14. **Throttle** — event throttling (events only)

User middlewares registered via `options.middlewares` array are added **before** internal middlewares. In `wrapHandler` (used for `localAction`, `remoteAction`, `localEvent`), first-registered = outermost wrapper. So user middlewares wrap outside the internal stack.

Custom middleware shape:
```js
{
  name: "MyMiddleware",
  localAction(next, action) {
    return (ctx) => next(ctx);
  },
  // Also: remoteAction, localEvent, localMethod
  // Broker method wrappers: call, emit, broadcast, createService, etc.
  // Lifecycle: created(broker), starting(broker), started(broker), stopping(broker), stopped(broker)
  // Service lifecycle: serviceCreating, serviceCreated, serviceStarting, serviceStarted, serviceStopping, serviceStopped
}
```

Middleware can be a plain object, a string (built-in name), or a factory function `(broker) => middlewareObject`.

## Broker lifecycle

### Start sequence
1. `starting` middleware hooks (async, in registration order)
2. `transit.connect()` — connect transporter
3. All services' `_start()` — each service waits for dependencies, then runs `started` hooks
4. `this.started = true`
5. `transit.ready()` — send INFO packets to other nodes
6. `started` middleware hooks (async)
7. `options.started(broker)` — if defined

### Stop sequence
1. Send empty node INFO (blocks incoming requests)
2. Wait `registry.stopDelay` ms (default 100)
3. `stopping` middleware hooks (async, **reverse** order)
4. All services' `_stop()` — each runs `stopped` hooks (reversed if array)
5. `transit.disconnect()`
6. `cacher.close()`
7. `metrics.stop()`, `tracer.stop()`
8. `registry.stop()`
9. `stopped` middleware hooks (async, **reverse** order)
10. `options.stopped(broker)` — if defined

The broker registers SIGINT/SIGTERM handlers that call `stop()` then `process.exit(0)`. Set `skipProcessEventRegistration: true` to disable this.

## Using the moleculer-runner

The `moleculer-runner` CLI (in `bin/`) starts a broker from a config file and loads services. Usage:

```bash
moleculer-runner [options] [service files/globs]
```

Config file via `-c` or `--config`:
- `moleculer.config.js` — CommonJS, exports broker options
- `moleculer.config.mjs` — ESM
- `moleculer.config.ts` — TypeScript (requires ts-node)

The runner loads the config, creates a broker, loads services from the specified paths (or `services/` directory by default), and starts the broker. It supports hot-reloading when `hotReload: true` is set in the config.

## Common configuration mistakes

- **Enabling retry without timeout.** Without `requestTimeout` set, a hung action has no ceiling. Retry will keep retrying indefinitely (up to `retries` count) with no base timeout to cut it short.
- **Setting `maxQueueSize: 0` on bulkhead.** This disables the queue-full check, creating unbounded memory growth under sustained load. Always set a finite `maxQueueSize`.
- **Not setting `requestTimeout` in production.** The default is `0` (no timeout). A slow or dead service will hang callers indefinitely.
- **Using `disableBalancer: true` with TCP transporter.** TCP has no built-in balancer. The broker will log a warning and keep its own balancer regardless.
- **Forgetting that `stop()` waits for in-flight contexts.** If `tracking.enabled` is `true` and a handler is stuck, shutdown blocks for `shutdownTimeout` ms. Set a reasonable timeout.

## Source files

When moleculer is installed as a dependency, the full source is at `node_modules/moleculer/src/`. Read these files to verify behavior or dig deeper:

- `node_modules/moleculer/src/service-broker.js` — `ServiceBroker` class, `defaultOptions` (lines 60-165 for every option with defaults), `start()` (lines 500-549), `stop()` (lines 556-641), `call()` (lines 1216-1275), `mcall()` (lines 1405-1438), `emit()` (lines 1450-1539), `INTERNAL_MIDDLEWARES` array (lines 167-182)
- `node_modules/moleculer/src/middleware.js` — `MiddlewareHandler`, `registerMiddlewares`, `wrapMethod`, `wrapHandler`, `callHandlers` (middleware ordering and wrapping logic)
- `node_modules/moleculer/src/runner.js` — moleculer-runner CLI logic (config loading, service globbing, broker creation)
- `node_modules/moleculer/bin/moleculer-runner.js` — CLI entry point, argument parsing via `args` package

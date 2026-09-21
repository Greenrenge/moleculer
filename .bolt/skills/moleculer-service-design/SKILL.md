---
name: moleculer-service-design
description: Conventions for architecting and structuring Moleculer microservices — service boundaries, domain logic separation, mixin design, and schema patterns. Use whenever the user asks to create, design, refactor, or split a Moleculer service, define service schemas, work with mixins, or organize a multi-service application. Also use when the user asks about where business logic should live, how to keep actions thin, or how to structure a Moleculer project.
---

# Moleculer Service Design

Guidance for structuring Moleculer services so they stay maintainable as the system grows. Based on the Moleculer 0.15.x source.

## Service as a thin adapter

The most common failure mode in Moleculer apps is bloating action handlers with business logic. A service's `.service.js` file should be a **transport adapter** — it receives requests via actions/events and delegates to domain logic. The action handler validates input, calls a domain function, and shapes the response. It should not contain business rules, data transformations beyond simple mapping, or orchestration of multiple domain operations.

Keep domain logic in plain JavaScript modules (or classes) that have no Moleculer imports. This makes them testable without a broker and reusable outside the framework. The service schema wires them into actions.

### Canonical structure

```
services/
  math.service.js          # thin adapter: actions, events, hooks
src/
  domain/
    math.js                # pure domain logic, no Moleculer dependency
    math.test.js            # tests for domain logic, no broker needed
```

The service file:
```js
const { add, multiply } = require("../domain/math");

module.exports = {
  name: "math",
  actions: {
    add: {
      params: { a: "number", b: "number" },
      handler(ctx) { return add(ctx.params.a, ctx.params.b); }
    }
  }
};
```

The domain module:
```js
// No Moleculer import — pure function
function add(a, b) { return a + b; }
module.exports = { add };
```

This separation matters because Moleculer actions are wrapped by middleware (validation, caching, circuit breaker, tracing). If business logic lives inside the handler, it gets entangled with transport concerns and becomes impossible to test in isolation.

## Service boundaries

Split services by **domain ownership**, not by technical layer. A `users` service owns user data and user operations; a `posts` service owns post data. They communicate via `broker.call` or events, not by sharing database tables.

Signs you should split a service:
- The schema has more than ~15 actions — it's probably doing too much.
- Two groups of actions never call each other — they're separate domains.
- The service has settings for unrelated concerns (e.g., SMTP config and S3 config in the same service).

Signs you should NOT split:
- Two services always call each other synchronously and never scale independently — they're one domain.
- The split would create a distributed transaction where a local function call suffices.

## Mixins

Mixins are Moleculer's composition mechanism. They merge schemas together with defined precedence rules. Use them for **cross-cutting service capabilities** (authentication, database access, CRUD scaffolding), not for splitting domains.

### How mixin merging works (from the source)

When a service has `mixins: [A, B]`, the framework:
1. Reverses the array → `[B, A]`
2. Reduces left-to-right, merging each mixin into the accumulator
3. Finally merges the service's own schema on top

This means **later mixins in the array take precedence**. If both A and B define `actions.add`, B's version wins. The service's own definition wins over all mixins.

Per-key merge strategy:
- `settings`: `lodash.defaultsDeep` — mixin settings fill gaps, service settings override
- `metadata`: same `defaultsDeep`
- `actions`: `defaultsDeep` — mixin actions provide defaults, service overrides. Setting an action to `false` in the service schema **deletes** it from the merged result
- `events`: handlers are **concatenated** into an array — both mixin and service handlers run
- `methods`: `Object.assign` — source (service) overwrites target (mixin)
- `hooks`: before-hooks concatenate as `[mixin, service]` order; after-hooks concatenate as `[service, mixin]` order
- `dependencies`: unique-merged, deduplicated by deep equality
- Lifecycle hooks (`created`, `started`, `stopped`): concatenated as `[mixin, service]` — all run in sequence

### When to use mixins vs. dependencies

Use **mixins** when you want to share implementation — a CRUD mixin that provides `list`, `get`, `create`, `update`, `remove` actions that the service can override or extend.

Use **dependencies** (`dependencies: ["users"]`) when you need another service to be available before yours starts, but you don't share code. The broker's `waitForServices` blocks `_start` until dependencies register.

### Mixin design rules

- A mixin should have a `name` — it becomes the service name if the consuming schema doesn't override it.
- Don't create mixins that define the same action name with different semantics — the merge silently picks one.
- If a mixin provides hooks, document the execution order — consumers need to know their hooks run after the mixin's before-hooks and before its after-hooks.
- Use `settings.$secureSettings` to prevent sensitive config from being exposed in the service specification that gets sent over the network.

## Service naming and versioning

- Service `name` is required and must be non-empty.
- `version` is optional. When set, the full name becomes `v2.posts` (for numeric versions) or `beta.posts` (for string versions).
- Setting `settings.$noVersionPrefix = true` omits the version from the full name.
- By default, action names are prefixed with the full service name: `posts.create`. Setting `settings.$noServiceNamePrefix = true` removes this prefix — use cautiously, it makes action name collisions likely.
- Version a service when you're making breaking changes to its action signatures or event contracts. Run both versions simultaneously during migration.

## Dependencies

Declare dependencies so the broker waits for them:
```js
module.exports = {
  name: "orders",
  dependencies: ["users", "inventory"]
};
```

The `_start` lifecycle method calls `broker.waitForServices(dependencies, timeout, interval)` before running the `started` hook. Override the timeout per-service with `settings.$dependencyTimeout` (ms) and interval with `settings.$dependencyInterval` (ms).

Dependencies can specify versions:
```js
dependencies: [{ name: "users", version: 2 }]
```

Or accept multiple versions:
```js
dependencies: [{ name: "users", version: [1, 2] }]
```

## Lifecycle hooks

Four lifecycle hooks, in order:
1. `merged(schema)` — sync, called after all mixins are merged but before the service is created. Use to inspect or modify the final merged schema.
2. `created()` — sync, called after the service instance is created. Use to initialize local state, connect to resources that don't need async.
3. `started()` — async, called when the broker starts. Use to open database connections, start servers, warm caches.
4. `stopped()` — async, called when the broker stops (reversed order if multiple). Use to close connections, flush buffers.

All hooks can be a single function or an array. Arrays run sequentially. The `stopped` array runs in **reverse** order (last-defined first).

## Settings vs. metadata

- `settings` are published to the service registry and visible to other nodes. Use them for configuration that other services might need to inspect (e.g., `settings.maxPageSize`).
- `metadata` is also published. Use it for descriptive info (e.g., `metadata.version`, `metadata.description`).
- Use `settings.$secureSettings` (array of keys) to strip sensitive settings from the published spec. The keys listed in `$secureSettings` are omitted, and `$secureSettings` itself is removed.
- `this.settings` is available inside action handlers. Don't confuse it with `ctx.meta` — settings are static per-service, meta is per-request.

## Common mistakes to avoid

- **Putting domain logic in action handlers.** If the handler is more than 3 lines of delegation, extract the logic.
- **Using `this.settings` for per-request config.** Settings are shared across all requests. Use `ctx.meta` for request-scoped data.
- **Deep call chains inside a single action.** If `orders.create` calls `users.get` which calls `auth.check` synchronously, consider whether these should be events or whether the orchestration belongs in a dedicated saga service.
- **Blocking the event loop in an action.** Action handlers run on the main event loop. CPU-heavy work (image processing, large JSON parsing) blocks all other requests. Offload to a worker thread or child process.
- **Not handling event handler errors.** Event handler errors are caught and logged by the broker but don't propagate to the emitter. If your event handler must not silently fail, add explicit error handling and consider using a dead-letter pattern.

## Source files

When moleculer is installed as a dependency, the full source is at `node_modules/moleculer/src/`. Read these files to verify behavior or dig deeper:

- `node_modules/moleculer/src/service.js` — Service class, `parseServiceSchema`, `applyMixins`, `mergeSchemas` (all per-key merge strategies), lifecycle hooks (`_init`, `_start`, `_stop`), action/event/method creation
- `node_modules/moleculer/src/service-broker.js` — `createService`, `loadService`, `loadServices`, `waitForServices`, `destroyService` (lines 876-989 for service management)
- `node_modules/moleculer/src/middlewares/action-hook.js` — hook resolution, `sanitizeHooks`, execution order chain

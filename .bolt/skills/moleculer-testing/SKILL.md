---
name: moleculer-testing
description: Conventions for testing Moleculer services and applications — unit tests, integration tests, test service patterns, and test configuration. Use whenever the user asks to write tests for a Moleculer service, set up test infrastructure, mock broker calls, test actions or events, or troubleshoot test failures in a Moleculer project. Also use when the user asks about Jest configuration, test services, or testing patterns for microservices.
---

# Moleculer Testing

Guidance for testing Moleculer services and applications. Based on the Moleculer 0.15.x test suite and source.

## Test infrastructure

Moleculer uses **Jest** as its test runner. The Jest config is in `package.json`:

```json
{
  "jest": {
    "coverageDirectory": "../coverage",
    "coveragePathIgnorePatterns": [
      "/node_modules/",
      "/test/services/",
      "/test/typescript/",
      "/test/unit/utils.js"
    ],
    "transform": {},
    "testEnvironment": "node",
    "rootDir": "./src",
    "roots": ["../test"]
  }
}
```

Key points:
- `rootDir` is `./src` with `roots` pointing to `../test` — tests live in `test/` but reference `src/`.
- `transform: {}` — no Babel or TypeScript transform. Tests are plain JavaScript (CommonJS).
- `testEnvironment: "node"` — Node.js environment, not jsdom.
- `coveragePathIgnorePatterns` excludes test services, TypeScript tests, and test utilities from coverage.

## Test structure

```
test/
  unit/           # Unit tests (one per source file)
  integration/    # Integration tests (cross-component)
  e2e/            # End-to-end tests (multi-node scenarios)
  leak-detection/ # Memory leak tests
  typescript/     # TypeScript type tests (tsd)
  services/       # Test service schemas used across tests
  unit/utils.js   # Shared test utilities
```

### Test commands

```bash
npm test              # Full suite with coverage
npm run test:unit     # Unit tests only
npm run test:int      # Integration tests only
npm run test:e2e      # E2E tests (requires external services)
npm run test:leak     # Memory leak detection
npm run test:ts       # TypeScript + tsd type tests
npm run test:esm      # ESM module tests
```

## Unit testing services

### Creating a broker for tests

```js
const { ServiceBroker } = require("moleculer");

describe("Math service", () => {
  let broker;

  beforeEach(() => {
    broker = new ServiceBroker({
      logger: false,        // disable logging in tests
      validator: false      // skip validation for speed
    });
    broker.createService(require("../../src/math.service"));
  });

  afterEach(() => broker.stop());

  it("should add numbers", async () => {
    const result = await broker.call("math.add", { a: 2, b: 3 });
    expect(result).toBe(5);
  });
});
```

### Testing patterns from the codebase

The Moleculer test suite uses these patterns consistently:

**Service factory pattern** — test services are defined inline:
```js
const broker = new ServiceBroker({ logger: false });
broker.createService({
  name: "test",
  actions: {
    hello: ctx => `Hello ${ctx.params.name}`
  }
});
await broker.start();
```

**Event testing** — use `broadcastLocal` or capture via `on`:
```js
broker.localBus.on("$broker.started", () => { /* assert */ });
```

**Middleware testing** — register middleware and verify wrapping:
```js
const mw = {
  localAction(next) {
    return ctx => { /* modify */ return next(ctx); }
  }
};
const broker = new ServiceBroker({ logger: false, middlewares: [mw] });
```

### Testing with fake timers

The test suite uses `@sinonjs/fake-timers` for time-dependent tests (circuit breaker windows, retry delays, heartbeat timers):

```js
const FakeTimers = require("@sinonjs/fake-timers");

let clock;
beforeEach(() => { clock = FakeTimers.install(); });
afterEach(() => { clock.uninstall(); });

it("should trip after timeout", async () => {
  const promise = broker.call("slow.action");
  clock.tick(5000);
  await expect(promise).rejects.toThrow();
});
```

### Testing with clock-mock

For tests that need precise time control (cacher TTL, heartbeat):
```js
const ClockMock = require("clock-mock");
// Used in cacher and discoverer tests for TTL/heartbeat behavior
```

## Integration testing

Integration tests verify cross-component behavior — broker lifecycle, transit, registry, middleware chains.

### Key integration test files

| File | Tests |
|------|-------|
| `broker.spec.js` | Broker creation, start/stop, service loading, call/mcall, emit/broadcast |
| `broker-transit.spec.js` | Transit connect/disconnect, packet routing |
| `circuit-breaker.spec.js` | CB state machine, threshold, half-open transitions |
| `retry.spec.js` | Retry with backoff, double-retry prevention |
| `event-balancer.spec.js` | Event grouping, balanced vs. broadcast delivery |
| `middlewares.spec.js` | Middleware registration order, wrapping, hooks |
| `service-mixins.spec.js` | Mixin merge precedence, settings, hooks, actions |
| `service.lifecycle.spec.js` | Service start/stop order, dependencies, waitForServices |
| `validator.spec.js` | Parameter validation, custom validators |
| `tracing.spec.js` | Span creation, sampling, exporter integration |
| `stream.spec.js` | Stream handling in actions |

### Pattern: testing the full middleware chain

```js
const broker = new ServiceBroker({
  logger: false,
  requestTimeout: 1000,
  retryPolicy: { enabled: true, retries: 2, delay: 10 },
  circuitBreaker: { enabled: true, threshold: 0.5, minRequestCount: 3 }
});

broker.createService({
  name: "flaky",
  actions: {
    call: {
      handler(ctx) {
        if (Math.random() > 0.3) throw new Error("fail");
        return "ok";
      }
    }
  }
});

await broker.start();
// Test that retry/circuit-breaker interact correctly
```

## E2E testing

E2E tests run multiple broker instances with real transporters. They live in `test/e2e/scenarios/`.

### Scenario structure

```
test/e2e/scenarios/
  basic/
    node1.js          # Broker instance 1
    scenario.js       # Test assertions (calls across nodes)
    start.sh          # Shell script to start all nodes
  balancing/
    node1.js, node2.js, node3.js  # Multiple nodes for load balancing tests
    scenario.js
    start.sh
  compression/
    node1.js, scenario.js, start.sh
  dependencies/
    scenario.js, start.sh
```

### E2E test pattern

```js
// node1.js
const { ServiceBroker } = require("moleculer");
const broker = new ServiceBroker({
  nodeID: "node-1",
  transporter: "TCP",
  logger: false
});
broker.createService({ name: "math", actions: { add: ctx => ctx.params.a + ctx.params.b } });
broker.start();
```

```js
// scenario.js — runs against a running cluster
const { ServiceBroker } = require("moleculer");
const broker = new ServiceBroker({ nodeID: "client", transporter: "TCP", logger: false });
await broker.start();
await broker.waitForServices("math");
const result = await broker.call("math.add", { a: 2, b: 3 });
assert(result === 5);
await broker.stop();
```

## TypeScript type testing

Type tests use `tsd` to verify type definitions:

```bash
npm run test:ts  # runs tsd + tsc + ts-node
```

`tsd` tests live in `test/typescript/tsd/` and verify that the TypeScript types exported in `index.d.ts` are correct:

```ts
// test/typescript/tsd/ServiceActions.test-d.ts
import { ServiceBroker } from "moleculer";
const broker = new ServiceBroker();
expectType<Promise<number>>(broker.call<number>("math.add", { a: 1, b: 2 }));
```

## Memory leak detection

Leak detection tests use a special test runner (`test/leak-detection/`):

```bash
npm run test:leak  # runs leak detection tests in-band
```

These tests create and destroy brokers/services repeatedly and check that memory doesn't grow. They verify that event listeners, timers, and references are properly cleaned up during `broker.stop()`.

## Testing gotchas

- **`collectProcessMetrics` is off in test env.** `NODE_ENV === "test"` disables process metric collection. Don't assert on process metrics in tests.
- **`logger: false` in tests.** Always disable logging in unit tests to keep output clean. Use `logger: false` (not `logger: { level: "fatal" }`).
- **Fake timers and real timers don't mix.** If you install fake timers, ensure all timers (including heartbeat intervals, circuit breaker windows, cacher TTL checks) are controlled by the fake clock. Unref'd intervals still fire under fake timers.
- **`broker.stop()` is async.** Always `await broker.stop()` in `afterEach`. Not stopping the broker leaks timers and event listeners — the leak detection tests will catch this.
- **Test services are excluded from coverage.** Files in `test/services/` are in `coveragePathIgnorePatterns`. Don't put testable logic there.
- **Jest config has `rootDir: "./src"`.** Import paths in tests use `../` to reference the test directory, and `../../src/` to reference source files.
- **No transform.** Tests are plain CommonJS. `import/export` syntax won't work in test files without a transform configured.
- **`waitForServices` needs the registry to be populated.** In unit tests with no transporter, services are immediately available. In integration tests with a transporter, you may need to wait for INFO packets.

# Moleculer Framework - Codebase Documentation

> A comprehensive guide for contributors, especially those looking to migrate the codebase to TypeScript.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Maintainer's Vision & Architecture](#maintainers-vision--architecture)
3. [Core Abstractions](#core-abstractions)
4. [Directory Structure](#directory-structure)
5. [Key Design Patterns](#key-design-patterns)
6. [Communication Flow](#communication-flow)
7. [Plugin System (Middlewares & Mixins)](#plugin-system-middlewares--mixins)
8. [TypeScript Status](#typescript-status)
9. [Testing Strategy](#testing-strategy)
10. [Contributing Guidelines](#contributing-guidelines)
11. [Migration Path to TypeScript](#migration-path-to-typescript)

---

## Project Overview

**Moleculer** is a fast, modern, and powerful microservices framework for Node.js. It provides a comprehensive set of features for building efficient, reliable, and scalable distributed systems.

### Key Features

- Promise-based solution (async/await compatible)
- Request-reply and event-driven architecture
- Built-in service registry & dynamic service discovery
- Load balancing (round-robin, random, CPU-usage, latency, sharding)
- Fault tolerance (Circuit Breaker, Bulkhead, Retry, Timeout, Fallback)
- Master-less architecture (all nodes are equal)
- Multiple transporters (TCP, NATS, MQTT, Redis, Kafka, AMQP)
- Multiple serializers (JSON, Avro, MsgPack, Protocol Buffers, Thrift)
- Built-in caching, metrics, and tracing

### Package Information

- **Version**: 0.14.35
- **Node.js Support**: >= 10.x.x
- **License**: MIT
- **Main Entry**: `index.js`

---

## Maintainer's Vision & Architecture

### Core Philosophy

1. **Simplicity with Power**: The framework provides a simple, intuitive API while offering enterprise-grade features under the hood.

2. **Pluggability**: Everything is pluggable and swappable:
    - Transporters (communication layer)
    - Serializers (data format)
    - Cachers (caching layer)
    - Loggers (logging output)
    - Load balancing strategies

3. **Convention over Configuration**: Sensible defaults for quick start, with extensive configuration options when needed.

4. **No Single Point of Failure**: Master-less architecture where all nodes are equal. No central coordinator required.

5. **Type Safety Awareness**: The framework includes TypeScript definitions (`index.d.ts`) and was designed with type safety in mind, even though the implementation is JavaScript.

### Architectural Decisions

#### 1. **Service-Centric Design**

Services are the fundamental building blocks. A service encapsulates:

- Actions (RPC methods)
- Events (pub/sub handlers)
- Methods (internal utility functions)
- Settings (configuration)
- Lifecycle hooks (created, started, stopped)

#### 2. **ServiceBroker as Central Hub**

The `ServiceBroker` is the orchestrator:

- Manages services lifecycle
- Handles inter-service communication
- Manages the service registry
- Provides access to shared resources (cachers, transporters, etc.)

#### 3. **Context Pattern**

Every action call receives a `Context` object containing:

- Request metadata (params, meta)
- Execution context (level, parentID, requestID)
- Tracing information (span)
- Utility methods (`call`, `emit`, `broadcast`)

#### 4. **Registry-Driven Service Discovery**

Services don't communicate directly. They use the registry:

- Services register themselves with the broker
- The registry maintains catalogs of services, actions, events, and nodes
- Service discovery happens through the registry layer

#### 5. **Transit Protocol**

The Transit layer abstracts network communication:

- Packets are serialized using configurable serializers
- Sent via configurable transporters
- Supports request/response and event patterns
- Handles heartbeats, node discovery, and health checks

---

## Core Abstractions

### 1. ServiceBroker (`src/service-broker.js`)

The central orchestrator class (1847 lines). Key responsibilities:

```javascript
class ServiceBroker {
  // Lifecycle
  start()
  stop()
  repl()

  // Service Management
  createService(schema)
  destroyService(service)

  // Communication
  call(actionName, params, opts)
  emit(eventName, payload, opts)
  broadcast(eventName, payload, opts)

  // Utilities
  getLogger()
  getCurrentContext()
}
```

**Key Design Points**:

- Uses deep defaults merging for configuration (`_.defaultsDeep`)
- Supports custom Promise libraries
- Has a sophisticated options structure with 20+ configurable areas
- Internal middlewares are predefined but extensible

### 2. Service (`src/service.js`)

Service instances are created from service schemas (844 lines):

```javascript
class Service {
  constructor(broker, schema, schemaMods)

  // Schema processing
  parseServiceSchema(schema)
  applyMixins(schema)
  mergeSchemas(mergedSchema, mixinSchema)

  // Lifecycle hooks
  created()
  started()
  stopped()
}
```

**Key Design Points**:

- Supports mixins for code reuse
- Methods are bound to the service instance
- Actions are wrapped by middleware handlers
- Supports schema merging with conflict resolution

### 3. Context (`src/context.js`)

The execution context for all service calls (492 lines):

```javascript
class Context {
  // Identity
  id
  requestID
  parentID
  level
  nodeID

  // Data
  params
  meta
  locals

  // References
  broker
  action
  service

  // Tracing
  span
  tracing

  // Methods
  call(actionName, params, opts)
  emit(eventName, data, opts)
  broadcast(eventName, data, opts)
}
```

**Key Design Points**:

- Context is the vehicle for request metadata propagation
- Supports context cloning and nesting (for nested calls)
- Context IDs are used for distributed tracing
- Metadata flows across service boundaries

### 4. Transit (`src/transit.js`)

Handles network communication between nodes (1479 lines):

**Key Design Points**:

- Abstracts the actual transport mechanism
- Manages pending requests/streams
- Handles packet serialization/deserialization
- Implements heartbeat and health checking
- Uses event-driven architecture for packet processing

**Packet Types**:

- `PACKET_REQUEST` - Action invocation
- `PACKET_RESPONSE` - Action response
- `PACKET_EVENT` - Event broadcast
- `PACKET_INFO` - Service info exchange
- `PACKET_HEARTBEAT` - Health checking
- `PACKET_DISCOVER` - Node discovery
- `PACKET_PING/PONG` - Latency checks

### 5. Registry (`src/registry/`)

The service discovery and catalog system:

```
src/registry/
├── registry.js          # Main registry coordinator (560 lines)
├── service-catalog.js   # Service registration
├── action-catalog.js    # Action registration
├── event-catalog.js     # Event registration
├── node-catalog.js      # Node management (127 lines)
├── endpoint-list.js     # Load-balanced endpoint lists
├── endpoint-action.js   # Action endpoints
├── endpoint-event.js    # Event endpoints
├── endpoint.js          # Base endpoint
├── node.js              # Node representation
├── service-item.js      # Service metadata
└── discoverers/         # Service discovery mechanisms
    ├── base.js
    ├── local.js
    ├── redis.js
    └── etcd3.js
```

**Key Design Points**:

- Separate catalogs for different entity types
- Endpoints wrap actions/events with load balancing
- Discoverers handle node discovery across different backends

### 6. Transporters (`src/transporters/`)

Pluggable communication layer:

```
src/transporters/
├── base.js         # Abstract base class (386 lines)
├── tcp.js          # TCP implementation (610 lines)
├── tcp/            # TCP transporter internals
│   ├── udp-broadcaster.js
│   └── tcp-reader.js
├── nats.js         # NATS transporter (277 lines)
├── mqtt.js         # MQTT transporter (143 lines)
├── redis.js        # Redis transporter (147 lines)
├── amqp.js         # AMQP 0.9 transporter (456 lines)
├── amqp10.js       # AMQP 1.0 transporter (483 lines)
├── kafka.js        # Kafka transporter (230 lines)
├── stan.js         # NATS Streaming transporter (159 lines)
├── fake.js         # Mock transporter for testing (69 lines)
└── index.js        # Exports and resolver
```

**Key Design Points**:

- All transporters extend `BaseTransporter`
- Handle connection lifecycle (connect, disconnect, reconnect)
- Subscribe/unsubscribe from topics/channels
- Support request/response and publish/subscribe patterns

### 7. Serializers (`src/serializers/`)

Pluggable serialization:

```
src/serializers/
├── base.js       # Abstract base (161 lines)
├── json.js       # JSON serializer (38 lines - default)
├── msgpack.js    # MessagePack serializer (36 lines)
├── avro.js       # Avro serializer (238 lines)
├── protobuf.js   # Protocol Buffers serializer (95 lines)
├── thrift.js     # Thrift serializer (100 lines)
├── cbor.js       # CBOR serializer (39 lines)
├── notepack.js   # Notepack serializer (32 lines)
├── proto/        # Protobuf schemas
└── thrift/       # Thrift schemas
```

**Key Design Points**:

- Base class defines interface with `serialize()` / `deserialize()`
- Must handle Moleculer packet types
- Some support binary serialization
- Custom type encoding for Buffer, undefined, null

### 8. Middleware System (`src/middleware.js`, `src/middlewares/`)

The plugin system for extending broker behavior (384 lines in middleware.js):

```
src/middlewares/
├── index.js            # Middleware exports (25 lines)
├── action-hook.js      # Action lifecycle hooks (189 lines)
├── validator.js        # Parameter validation (24 lines)
├── bulkhead.js         # Concurrency limiting (293 lines)
├── circuit-breaker.js  # Fault tolerance (329 lines)
├── timeout.js          # Request timeouts (79 lines)
├── retry.js            # Retry logic (98 lines)
├── fallback.js         # Fallback handling (97 lines)
├── error-handler.js    # Error processing (68 lines)
├── cacher.js           # Response caching (21 lines)
├── tracing.js          # Distributed tracing (287 lines)
├── metrics.js          # Metrics collection (425 lines)
├── context-tracker.js  # Request tracking (110 lines)
├── debounce.js         # Debouncing (21 lines)
├── throttle.js         # Rate limiting (20 lines)
├── hot-reload.js       # Hot reload support (400 lines)
├── debugging/          # Debug middlewares
│   └── action-logger.js
└── transmit/           # Transport middlewares
    ├── encryption.js
    └── compression.js
```

**Key Design Points**:

- Middlewares wrap handlers at different stages
- `localAction` and `remoteAction` hooks for local vs remote calls
- `serviceCreating`, `serviceStarted`, `serviceStopped` hooks
- Custom middlewares can be registered
- 17 built-in middlewares in specific order

---

## Directory Structure

```
moleculer/
├── index.js                 # Main entry point
├── index.mjs                # ESM entry point
├── index.d.ts               # TypeScript definitions (2065+ lines)
├── src/
│   ├── service-broker.js    # Core broker (1847 lines)
│   ├── service.js           # Service class (844 lines)
│   ├── context.js           # Context class (492 lines)
│   ├── transit.js           # Network layer (1479 lines)
│   ├── middleware.js        # Middleware system (384 lines)
│   ├── packets.js           # Protocol packets (57 lines)
│   ├── errors.js            # Error classes (579 lines)
│   ├── utils.js             # Utilities (556 lines)
│   ├── constants.js         # Constants (74 lines)
│   ├── logger-factory.js    # Logger management (123 lines)
│   ├── cpu-usage.js         # CPU monitoring (60 lines)
│   ├── health.js            # Health checks (36 lines)
│   ├── internals.js         # Internal metrics (128 lines)
│   ├── lock.js              # Lock utility (26 lines)
│   ├── async-storage.js     # Async context storage (54 lines)
│   ├── runner.js            # CLI runner (501 lines)
│   ├── runner-esm.mjs       # ESM CLI runner
│   ├── cachers/             # Caching implementations
│   ├── transporters/        # Communication implementations
│   ├── serializers/         # Serialization implementations
│   ├── registry/            # Service registry
│   ├── strategies/          # Load balancing strategies
│   ├── validators/          # Validation implementations
│   ├── loggers/             # Logger implementations
│   ├── metrics/             # Metrics system
│   ├── tracing/             # Tracing system
│   └── middlewares/         # Built-in middlewares
├── test/
│   ├── unit/                # Unit tests
│   ├── integration/         # Integration tests
│   ├── e2e/                 # End-to-end tests
│   └── typescript/          # TypeScript tests
├── examples/                # Example services
├── benchmark/               # Performance benchmarks
├── bin/                     # CLI tools
└── dev/                     # Development utilities
```

---

## Key Design Patterns

### 1. **Mixin Pattern**

Services can use mixins to share common functionality:

```javascript
const dbMixin = {
    methods: {
        findById(id) {
            /* ... */
        }
    }
};

broker.createService({
    name: "users",
    mixins: [dbMixin],
    actions: {
        get(ctx) {
            return this.findById(ctx.params.id);
        }
    }
});
```

**Implementation**: `Service.applyMixins(schema)` in `src/service.js`

### 2. **Plugin Pattern (Middlewares)**

Middlewares wrap behavior at specific hook points:

```javascript
const myMiddleware = {
    localAction(handler, action) {
        return async function (ctx) {
            console.log("Before action");
            const result = await handler(ctx);
            console.log("After action");
            return result;
        };
    }
};

broker.use(myMiddleware);
```

**Implementation**: `MiddlewareHandler` in `src/middleware.js`

### 3. **Factory Pattern**

Various factories for creating instances:

- `LoggerFactory` - Creates loggers with proper bindings
- Service factories (configurable via `ServiceFactory` option)
- Context factories (configurable via `ContextFactory` option)
- Resolver pattern in each module for string -> instance resolution

### 4. **Strategy Pattern**

Load balancing strategies:

- `RoundRobin` - Sequential distribution
- `Random` - Random selection
- `CpuUsage` - Based on CPU load
- `Latency` - Based on response latency
- `Shard` - Sharding by key

**Implementation**: `src/strategies/`

### 5. **Observer Pattern**

Event-driven architecture:

- Broker emits events
- Services subscribe to events
- Transit emits packet events

### 6. **Chain of Responsibility**

Middleware wrapping creates a chain of handlers:

```
request → ActionHook → Validator → Bulkhead → Cacher →
          ContextTracker → CircuitBreaker → Timeout →
          Retry → Fallback → ErrorHandler → Tracing →
          Metrics → Handler
```

### 7. **ExtendableError Pattern**

Custom error hierarchy:

```javascript
class MoleculerError extends ExtendableError
class MoleculerRetryableError extends MoleculerError
class ServiceNotFoundError extends MoleculerError
```

**Implementation**: `src/errors.js` (579 lines)

### 8. **Circuit Breaker Pattern**

Built into middleware for fault tolerance:

```
CLOSE → (failures > threshold) → OPEN → (timeout) →
HALF_OPEN → (success) → CLOSE
HALF_OPEN → (failure) → OPEN
```

**Implementation**: `src/middlewares/circuit-breaker.js`

---

## Communication Flow

### Action Call Flow

```
1. Client calls: broker.call("users.get", { id: 1 })
2. Broker finds action in registry action-catalog
3. Registry returns endpoint list
4. Strategy picks endpoint based on load balancing
5. Context is created with metadata
6. Middlewares wrap the handler (chain of 17 middlewares)
7. Handler executes
8. Response travels back through middlewares
9. Response returned to caller
```

### Remote Call Flow

```
1. Client calls broker.call("users.get", { id: 1 })
2. Broker determines target node via registry
3. Context serialized into packet by Serializer
4. Transit sends packet via Transporter
5. Target node receives packet
6. Packet deserialized
7. Context recreated on target
8. Handler executes locally on target
9. Response packet serialized and sent back
10. Client receives response and deserializes
```

### Event Broadcasting Flow

```
1. Service emits event: ctx.emit("user.created", user)
2. Broker broadcasts to registry event-catalog
3. Registry finds subscribing services
4. Event packet sent to each node via Transit
5. Each node delivers to local services via localEvent
```

---

## Plugin System (Middlewares & Mixins)

### Middleware Lifecycle Hooks

#### Service Hooks

- `serviceCreating(service, schema)`
- `serviceCreated(service)`
- `serviceStarting(service)`
- `serviceStarted(service)`
- `serviceStopping(service)`
- `serviceStopped(service)`

#### Action Hooks

- `localAction(handler, action)` - Wrap local action calls
- `remoteAction(handler, action)` - Wrap remote action calls
- `localEvent(handler, event)` - Wrap event handlers

#### Transit Hooks

- `transitPublish(packet)` - Before sending packet
- `transitMessageHandler(cmd, packet)` - After receiving packet
- `transporterSend(packet)` - Before transport send
- `transporterReceive(packet)` - After transport receive

#### Broker Hooks

- `created(broker)` - After broker creation
- `starting(broker)` - Before broker start
- `started(broker)` - After broker started
- `stopping(broker)` - Before broker stop
- `stopped(broker)` - After broker stopped

### Mixin Schema Merging

When using mixins, schemas are merged with these rules:

1. **Properties that merge**: `settings`, `metadata`, `dependencies`
2. **Properties that concatenate**: `actions`, `events`, `methods`, `hooks`
3. **Properties that overwrite**: `name`, `version`
4. **Lifecycle hooks**: Called in order of mixins then service

**Conflict Resolution**: Later mixins override earlier ones

---

## TypeScript Status

### Current State: **Partial TypeScript Support**

**TypeScript Definitions**: Comprehensive (`index.d.ts`, ~2065 lines)

- All public APIs are typed
- Generic support for custom settings and methods
- Context types support typed params and meta
- Service schemas can be fully typed

### Coverage Analysis

| Component         | Types    | Notes                                  |
| ----------------- | -------- | -------------------------------------- |
| **ServiceBroker** | Complete | Full options, methods typed            |
| **Service**       | Complete | Schema, actions, events typed          |
| **Context**       | Complete | ctx.params, ctx.meta, ctx.call typed   |
| **Errors**        | Complete | Full error hierarchy                   |
| **Middlewares**   | Complete | Hook signatures defined                |
| **Cachers**       | Complete | All cacher types                       |
| **Loggers**       | Complete | Logger interface + implementations     |
| **Transporters**  | Basic    | Base class covered, some options vague |
| **Serializers**   | Basic    | Base class covered                     |
| **Strategies**    | Basic    | Base class covered                     |
| **Validators**    | Good     | fastest-validator integration          |
| **Metrics**       | Good     | Types, reporters, registries           |
| **Tracing**       | Good     | Spans, exporters                       |
| **Registry**      | Partial  | Catalog classes defined                |
| **Utils**         | Complete | Utility functions typed                |

### TypeScript Testing

```json
"test:ts": "tsd && tsc -p test/typescript/hello-world"
```

- Uses `tsd` for type testing
- Has example TypeScript project
- Tests type definitions match implementation

**Test Files**:

- `test/typescript/hello-world/greeter.service.ts` - Full typed service example
- `test/typescript/hello-world/index.ts` - Broker setup in TypeScript
- `test/typescript/tsd/*.test-d.ts` - Type definition tests

### TypeScript Service Example

```typescript
import { Service, Context, ServiceSchema } from "moleculer";

interface UserSettings {
    dbUrl: string;
}

interface UserMethods {
    findById(id: string): Promise<any>;
}

type UserThis = Service<UserSettings> & UserMethods;

const UserService: ServiceSchema<UserSettings, UserThis> = {
    name: "users",

    settings: {
        dbUrl: "mongodb://localhost"
    },

    methods: {
        async findById(this: UserThis, id: string) {
            // Implementation
        }
    },

    actions: {
        async get(this: UserThis, ctx: Context<{ id: string }>) {
            return this.findById(ctx.params.id);
        }
    }
};
```

### Gaps & Limitations

1. **Transporters** - Missing detailed options for each transporter type
2. **Registry internals** - Some internal classes use `any`
3. **Plugin middleware types** - Could be more specific
4. **No JSDoc in source** - Types only in `.d.ts`, not inline

---

## Testing Strategy

### Test Structure

```
test/
├── unit/              # Unit tests for individual modules
│   ├── service-broker.spec.js
│   ├── service.spec.js
│   ├── context.spec.js
│   ├── transit.spec.js
│   └── ...
├── integration/       # Integration tests
├── e2e/              # End-to-end tests (full cluster)
│   └── start.sh
└── typescript/       # TypeScript definition tests
    ├── hello-world/
    │   ├── greeter.service.ts
    │   ├── index.ts
    │   └── tsconfig.json
    └── tsd/
        ├── *.test-d.ts
```

### Test Patterns

**Unit Tests**: Mock dependencies extensively

```javascript
describe("Test ServiceBroker", () => {
    it("should create a broker", () => {
        const broker = new ServiceBroker({ logger: false });
        expect(broker).toBeDefined();
    });
});
```

**TypeScript Tests**: Use `tsd` for type testing

```typescript
import { expectType } from "tsd";
import { ServiceBroker } from "moleculer";

expectType<Promise<any>>(broker.call("test"));
```

### Running Tests

```bash
npm test                    # Full test suite with coverage
npm run test:unit          # Unit tests only
npm run test:int           # Integration tests only
npm run test:ts            # TypeScript tests
npm run test:esm           # ESM module tests
npm run ci                 # Watch mode for development
```

### Jest Configuration

```json
"jest": {
  "coverageDirectory": "../coverage",
  "coveragePathIgnorePatterns": [
    "/node_modules/",
    "/test/services/",
    "/test/typescript/"
  ],
  "transform": {},
  "testEnvironment": "node",
  "rootDir": "./src",
  "roots": ["../test"]
}
```

---

## Contributing Guidelines

### Code Style (from CONTRIBUTING.md)

- **Indentation**: Tabs with size of 4
- **Strict Mode**: Always use strict mode
- **Semicolons**: Always required
- **Quotes**: Double quotes preferred

### Development Workflow

```bash
# 1. Fork and clone
git clone https://github.com/<username>/moleculer.git
cd moleculer
npm install

# 2. Start development mode
npm run dev

# 3. Or run continuous tests
npm run ci

# 4. Make changes, add tests

# 5. Run full test suite
npm test

# 6. Lint
npm run lint

# 7. Commit and push
```

### Adding New Features

1. **Add implementation** in appropriate `src/` directory
2. **Add tests** in corresponding `test/` directory
3. **Update TypeScript definitions** in `index.d.ts`
4. **Add TypeScript tests** if needed
5. **Update documentation** if public API changed
6. **Ensure 100% test coverage** for new code

---

## Migration Path to TypeScript

### Phase 1: Foundation (Preparation)

1. **Set up TypeScript infrastructure**:

    ```bash
    npm install -D typescript @types/node
    npx tsc --init
    ```

2. **Configure tsconfig.json**:

    ```json
    {
        "compilerOptions": {
            "target": "ES2020",
            "module": "commonjs",
            "lib": ["ES2020"],
            "outDir": "./dist",
            "rootDir": "./src",
            "strict": true,
            "esModuleInterop": true,
            "skipLibCheck": true,
            "forceConsistentCasingInFileNames": true,
            "declaration": true,
            "declarationMap": true,
            "sourceMap": true
        }
    }
    ```

3. **Create type declaration strategy**:
    - Decide between inline types vs `.d.ts` files
    - Consider using the existing `index.d.ts` as a starting point

### Phase 2: Core Modules (High Priority)

Migrate in this order (dependency-based):

1. **`src/constants.js`** - Simple, no dependencies
2. **`src/errors.js`** - Simple, few dependencies
3. **`src/utils.js`** - Many dependents, but self-contained
4. **`src/packets.js`** - Protocol definitions
5. **`src/context.js`** - Core abstraction
6. **`src/service.js`** - Depends on context, errors
7. **`src/service-broker.js`** - Main orchestrator

### Phase 3: Infrastructure Modules

8. **`src/transit.js`** - Network layer
9. **`src/registry/`** - Service discovery
10. **`src/middleware.js`** - Plugin system

### Phase 4: Pluggable Components

11. **`src/transporters/`** - One at a time
12. **`src/serializers/`** - One at a time
13. **`src/cachers/`** - One at a time
14. **`src/strategies/`** - One at a time
15. **`src/validators/`** - One at a time
16. **`src/loggers/`** - One at a time
17. **`src/metrics/`** - Subsystem
18. **`src/tracing/`** - Subsystem
19. **`src/middlewares/`** - One at a time

### Phase 5: Integration

20. **`src/runner.js`** and `src/runner-esm.mjs`
21. **`index.js`** and `index.mjs`
22. **Update package.json** entry points
23. **Convert tests to TypeScript**

### Migration Best Practices

1. **Preserve Existing Behavior**: Maintain exact same runtime behavior
2. **Incremental Commits**: One module per PR for easier review
3. **Update Type Definitions**: Keep `index.d.ts` in sync
4. **Add Type Tests**: Ensure types work as expected
5. **Maintain Performance**: Don't introduce runtime overhead
6. **Backward Compatibility**: Keep same public API

### TypeScript-Specific Considerations

#### Handling `this` Context

Service methods need proper `this` typing:

```typescript
interface MyService extends Service {
    myMethod(): void;
}

const MyServiceSchema: ServiceSchema = {
    name: "myService",
    methods: {
        myMethod(this: MyService) {
            // this is properly typed
        }
    }
};
```

#### Dynamic Property Access

JavaScript uses many dynamic patterns:

```javascript
// Before
service[name] = value;

// After - need type assertions or index signatures
(service as any)[name] = value;
// OR define index signature in interface
```

#### Mixin System

Mixins need careful typing:

```typescript
function createDbMixin<T>(opts: T) {
    return {
        methods: {
            find(this: Service & { db: any }) {
                return this.db.find();
            }
        }
    };
}
```

#### EventEmitter2

The framework uses `EventEmitter2`:

```typescript
import { EventEmitter2 } from "eventemitter2";

class ServiceBroker extends EventEmitter2 {
    // ...
}
```

#### Lodash Usage

Lodash has its own types:

```typescript
import _ from "lodash";

// Use proper generics
const merged = _.defaultsDeep<BrokerOptions>(options, defaults);
```

---

## Key Files for TypeScript Contributors

### Most Important Files to Understand

| File                    | Purpose           | Complexity | Lines |
| ----------------------- | ----------------- | ---------- | ----- |
| `src/service-broker.js` | Main orchestrator | High       | 1847  |
| `src/service.js`        | Service class     | Medium     | 844   |
| `src/context.js`        | Request context   | Medium     | 492   |
| `src/transit.js`        | Network layer     | High       | 1479  |
| `src/middleware.js`     | Plugin system     | Medium     | 384   |
| `src/errors.js`         | Error hierarchy   | Low        | 579   |
| `src/utils.js`          | Utilities         | Medium     | 556   |
| `index.d.ts`            | Type definitions  | High       | 2065+ |

### Files with TypeScript Examples

| File                                             | What to Learn      |
| ------------------------------------------------ | ------------------ |
| `test/typescript/hello-world/greeter.service.ts` | Full typed service |
| `test/typescript/hello-world/index.ts`           | Broker setup in TS |
| `test/typescript/tsd/*.test-d.ts`                | Type tests         |

---

## Common Pitfalls

1. **Circular Dependencies**: The codebase has some circular dependencies that TypeScript might flag
2. **Dynamic Imports**: Some modules are loaded dynamically
3. **Prototype Manipulation**: Some code modifies prototypes
4. **Global State**: Event emitters and singletons
5. **Mixed Module Systems**: CommonJS with ESM wrapper
6. **`this` Context**: Service methods rely heavily on `this` binding
7. **Mixin Merging**: Complex schema merging rules
8. **Middleware Wrapping**: Chain of wrapper functions

---

## Resources

### Documentation

- **Official Docs**: https://moleculer.services/docs
- **API Reference**: https://moleculer.services/docs/0.14/api/service-broker.html

### Community

- **GitHub**: https://github.com/moleculerjs/moleculer
- **Discord**: https://discord.gg/TSEcDRP
- **NPM**: https://www.npmjs.com/package/moleculer

### Related Projects

- **API Gateway**: moleculer-web
- **Database**: moleculer-db
- **CLI**: moleculer-cli
- **REPL**: moleculer-repl

---

## Summary

Moleculer is a mature, well-architected microservices framework. The maintainers have put significant thought into:

1. **Modularity**: Clean separation of concerns
2. **Extensibility**: Plugin system throughout
3. **Performance**: Efficient async patterns
4. **Type Safety**: Comprehensive type definitions

**Architecture Highlights**:

- **Master-less** distributed architecture
- **Middleware pipeline** for extensibility (17 built-in middlewares)
- **Schema-based services** for declarative APIs
- **Promise-based** for async/await
- **Pluggable everything** (transports, serializers, strategies)
- **Built-in observability** (metrics, tracing)

**Key Statistics**:

- ~12,000+ lines of core code
- 29 source directories
- 17 built-in middlewares
- 8+ transporters
- 8+ serializers
- 5 load balancing strategies
- 14+ error types

For TypeScript migration contributors:

- Start with the simpler modules (`constants`, `errors`, `packets`)
- Understand the class hierarchies before migrating
- Use the existing `index.d.ts` as your guide
- Test thoroughly to maintain backward compatibility
- Consider the impact on the ecosystem of community modules

The framework's design prioritizes **developer experience** and **runtime performance**. Any TypeScript migration should preserve both.

---

_This documentation was generated for contributors looking to understand and contribute to the Moleculer framework, especially for TypeScript migration efforts._

_Generated: 2024_
_Version: 0.14.35_

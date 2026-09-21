---
name: moleculer-transport-network
description: Conventions for configuring Moleculer's transport layer — transporters (NATS, TCP, Redis, AMQP, Kafka, MQTT), cachers (Memory, Redis), serializers, load balancing strategies, and service discoverers. Use whenever the user asks to set up inter-node communication, configure a transporter, choose a cacher, select a serializer, configure load balancing strategies, set up service discovery, or troubleshoot network/transport issues. Also use when the user asks about Redis caching, NATS, TCP transport, AMQP, Kafka, consistent hashing, or shard-based routing.
---

# Moleculer Transport and Network

Guidance for the transport, caching, serialization, strategy, and discovery layers. Based on Moleculer 0.15.x source.

## Transporters

The transporter is the message bus that connects nodes. Without one (`transporter: null`), the broker runs as a single node with no network communication.

### Supported transporters

| Type | String | URL scheme | Built-in balancer | Notes |
|------|--------|-----------|-------------------|-------|
| TCP | `"TCP"` | `tcp://` | No | Default for simple multi-node. Uses UDP for discovery, TCP for data. No external broker needed. |
| NATS | `"NATS"` | `nats://` | Yes | Most common production choice. Requires a NATS server. |
| Redis | `"Redis"` | `redis://` / `rediss://` | Yes | Uses Redis pub/sub. Good if you already have Redis. |
| MQTT | `"MQTT"` | `mqtt://` / `mqtts://` | Yes | IoT-focused. Requires an MQTT broker. |
| AMQP | `"AMQP"` | `amqp://` / `amqps://` | Yes | RabbitMQ. Supports durable queues. |
| AMQP10 | `"AMQP10"` | `amqp10://` | Yes | ActiveMQ / Qpid. Uses rhea-promise. |
| Kafka | `"Kafka"` | `kafka://` | Yes | Uses @platformatic/kafka. High-throughput streaming. |

### Resolution

Transporters accept string, URL, or object config:
```js
// String (by name)
transporter: "NATS"

// URL (auto-detected by scheme)
transporter: "nats://nats.example.com:4222"

// Object with options
transporter: {
  type: "NATS",
  options: {
    url: "nats://localhost:4222",
    user: "admin",
    pass: "secret"
  }
}

// Custom class (must inherit from Transporters.Base)
transporter: new MyTransporter({ ... })
```

### Built-in balancer vs. Moleculer balancer

Moleculer has its own request/event load balancer. Some transporters (NATS, Redis, AMQP, Kafka, MQTT) have built-in balancers (queue groups, consumer groups).

Set `disableBalancer: true` to use the transporter's built-in balancer instead of Moleculer's. This is more efficient for supported transporters but means Moleculer's `RoundRobin`/`Random`/`CpuUsage`/`Latency`/`Shard` strategies don't apply. If the transporter lacks a built-in balancer (TCP, Fake), the broker logs a warning and keeps its own.

### Topic naming

All transporter topics use a prefix: `"MOL"` by default, or `"MOL-" + namespace` if a namespace is set. Topics follow the pattern `prefix.command.nodeID` (e.g., `MOL.REQUEST.node-1`).

### Transit configuration

```js
transit: {
  maxQueueSize: 50000,        // max queued transit packets (memory bound)
  maxChunkSize: 262144,       // 256KB — max packet chunk for TCP
  disableReconnect: false,    // if true, no reconnection on disconnect
  disableVersionCheck: false, // if true, don't check protocol version mismatch
  serviceChangedDebounceTime: 1000  // ms — debounce for service change broadcasts
}
```

### Connection and reconnection

On `broker.start()`:
1. `transit.connect()` calls `transporter.connect()`
2. On success: `makeSubscriptions()` (subscribe to all packet types), `discoverer.discoverAllNodes()`, wait 500ms for INFO packets, set `connected = true`
3. On failure: if `disableReconnect` is false, retry after 5 seconds

On reconnect (transporter fires `onConnected(true)`):
1. Send local node INFO to all nodes
2. Re-make balanced subscriptions if balancer is disabled

## Cachers

Caching stores action results to avoid recomputation.

### Supported cachers

| Type | String | URL scheme | TTL | Locking | Notes |
|------|--------|-----------|-----|---------|-------|
| Memory | `"Memory"` | — | Configurable | Built-in (Lock class) | Default when `cacher: true`. 30s TTL check interval. |
| MemoryLRU | `"MemoryLRU"` | — | Configurable | Built-in | LRU eviction. |
| Redis | `"Redis"` | `redis://` / `rediss://` | Configurable | Redlock | Requires `ioredis`. Supports cluster mode. |

### Resolution

```js
// Boolean shorthand — Memory cacher
cacher: true

// String
cacher: "Memory"
cacher: "redis://localhost:6379"

// Object with options
cacher: {
  type: "Redis",
  options: {
    redis: { host: "localhost", port: 6379 },
    ttl: 30,              // seconds
    prefix: "myapp",
    maxParamsLength: 100  // truncate long cache keys
  }
}
```

### Cache configuration on actions

```js
actions: {
  list: {
    cache: true,                    // simple: cache with default TTL
    cache: {                        // full: with options
      enabled: true,
      ttl: 60,                      // seconds, overrides cacher default
      keys: ["page", "limit"],       // cache key components from params
      lock: { enabled: true, ttl: 15 }  // prevent thundering herd
    },
    handler(ctx) { return this.getUsers(); }
  }
}
```

Setting `settings.$cache` on a service provides a default `cache` value for all actions that don't specify their own.

### Cache key generation

The default keygen builds: `action.name + ":" + hashed(params)`.

- If `keys` is specified: only those param/meta/header values are included in the key. Keys prefixed with `#` read from `ctx.meta`, `@` from `ctx.headers`, otherwise from `ctx.params`.
- If `keys` has one entry: fast path — reads that one value.
- If `keys` has multiple: joins values with `|`, hashes objects individually.
- If no `keys`: hashes the entire params object.
- `maxParamsLength`: if set (and >= 44), keys longer than this are truncated + SHA256-hashed to keep Redis keys manageable.

### Cache lock (thundering herd prevention)

When `lock.enabled` is true:
1. Try to get cached value. If found → return it.
2. If not found: `tryLock(cacheKey)`. If locked by another process → return stale data if available (if `lock.staleTime` is set and data is stale enough), otherwise wait.
3. If lock acquired: **double-check** the cache (another process may have set it while we were locking). If still missing → call handler, set cache, release lock.
4. On handler error: release lock, reject.

Redis cacher uses `redlock` for distributed locking. Memory cacher uses a local `Lock` class.

### Per-call cache control

- `ctx.meta.$cache = false` → bypass cache for this call (don't read, don't write)
- `action.cache` as a function: `cache: { enabled: (ctx) => ctx.params.useCache }` — per-request dynamic enable/disable
- Unhealthy cacher (`this.connected === false`): cache is bypassed, handler runs directly

### Memory cacher specifics

- Clones data on get/set if `opts.clone` is `true` (uses `_.cloneDeep`) or a custom function.
- Listens to `"$transporter.connected"` → clears all entries (in case `cache.clear` events were missed during disconnection).
- TTL check runs every 30 seconds (unref'd interval).
- `getWithTTL(key)`: returns `{ data, ttl }`. **Side effect**: if `opts.ttl` is set, refreshes the expiration on access (sliding expiration).

### Redis cacher specifics

- Values are serialized via the configured serializer (default JSON) before storage, deserialized on retrieval.
- Supports cluster mode via `opts.cluster.nodes`.
- `pingInterval`: if set, periodically pings Redis to detect connection drops.
- `redlock` is enabled by default (can be disabled with `opts.redlock: false`).
- `clean(match)` uses SCAN-based pattern deletion (not KEYS, which blocks Redis).
- `monitor` option enters Redis MONITOR mode for debugging.

## Serializers

Serializers encode/decode packets for transport. Only matters for remote (multi-node) setups.

### Supported serializers

| Type | String | Binary | Notes |
|------|--------|--------|-------|
| JSON | `"JSON"` | No | Default. Universal but no Buffer/Date support. |
| JSONExt | `"JSONExt"` | No | Extended JSON with Buffer/Date/RegExp support. |
| MsgPack | `"MsgPack"` | Yes | Binary, compact. Requires `msgpack5`. |
| Notepack | `"Notepack"` | Yes | Fast MessagePack. Requires `notepack.io`. |
| CBOR | `"CBOR"` | Yes | Binary, compact. Requires `cbor-x`. |

```js
serializer: "JSON"
serializer: { type: "MsgPack", options: {} }
```

For high-throughput deployments, `Notepack` or `CBOR` offer better performance than JSON. Use `JSONExt` if you need JSON but also need Buffer/Date serialization.

## Load balancing strategies

Strategies determine which endpoint handles a call when multiple nodes offer the same action.

### Supported strategies

| Type | String | Notes |
|------|--------|-------|
| RoundRobin | `"RoundRobin"` | Default. Cycles through endpoints. |
| Random | `"Random"` | Picks a random endpoint. |
| CpuUsage | `"CpuUsage"` | Picks the node with lowest CPU usage. |
| Latency | `"Latency"` | Picks the node with lowest measured latency. |
| Shard | `"Shard"` | Consistent hashing based on a shard key. |

```js
registry: {
  strategy: "RoundRobin",
  preferLocal: true  // prefer local endpoint if available
}
```

### Shard strategy

Consistent hashing for affinity-based routing. Use when the same key should always route to the same node (e.g., user sessions, cache locality).

```js
registry: {
  strategy: "Shard",
  strategyOptions: {
    shardKey: "userId",       // field from ctx.params (or "#metaKey" for meta, or a function)
    vnodes: 10,               // virtual nodes per real node
    ringSize: null,           // null = 2^32
    cacheSize: 1000           // LRU cache for key→nodeID lookups
  }
}
```

- If `shardKey` starts with `#`: reads from `ctx.meta`.
- If `shardKey` is a function: called with `this` context.
- Otherwise: reads from `ctx.params`.
- If no key or node not found: falls back to random selection.
- The ring is rebuilt on node topology changes (`$node.**` events set `needRebuild = true`).

## Service discoverers

Discoverers handle node discovery and heartbeat monitoring.

### Supported discoverers

| Type | String | URL scheme | Notes |
|------|--------|-----------|-------|
| Local | `"Local"` | — | Default. Uses transporter's gossip/discovery. No external dependency. |
| Etcd3 | `"Etcd3"` | `etcd3://` | External service discovery. Requires `etcd3`. |
| Redis | `"Redis"` | `redis://` / `rediss://` | External discovery via Redis. Requires `ioredis`. |

```js
registry: {
  discoverer: "Local",
  // or
  discoverer: "redis://localhost:6379",
  // or
  discoverer: { type: "Etcd3", options: { ... } }
}
```

### Heartbeat configuration

Heartbeats are managed by the discoverer, not the transporter (except TCP, which has its own mechanism and calls `disableHeartbeat()`).

```js
heartbeatInterval: 10,  // seconds between heartbeats (±500ms jitter)
heartbeatTimeout: 30   // seconds — node marked offline if no heartbeat
```

- `heartbeatInterval`: send a heartbeat every N seconds (with random ±500ms jitter to avoid synchronization).
- `heartbeatTimeout`: if no heartbeat received from a node within N seconds, mark it unavailable.
- `cleanOfflineNodesTimeout` (default 600 seconds): permanently remove offline nodes after this long.
- `disableHeartbeatChecks`: if true, never mark nodes offline for missing heartbeats.
- `disableOfflineNodeRemoving`: if true, never permanently remove offline nodes.

## Common configuration mistakes

- **Using TCP transporter with `disableBalancer: true`.** TCP has no built-in balancer. The broker will log a warning and keep its own balancer.
- **Forgetting to install peer dependencies.** Transporters and cachers are optional peer dependencies. `npm install nats` for NATS, `npm install ioredis` for Redis cacher, etc. The framework lazily requires them and calls `broker.fatal` if missing.
- **Not setting `maxParamsLength` on Redis cacher with complex params.** Long cache keys waste Redis memory and slow lookups. Set `maxParamsLength` to 100-200 to truncate and hash long keys.
- **Using `cacher: true` (Memory) in a multi-node setup.** Memory cacher is per-node — each node has its own cache. Use Redis for shared caching across nodes.
- **Not configuring `heartbeatTimeout` appropriately.** The default 30s is generous. On fast networks, a lower value detects failures quicker. On unreliable networks, keep it high to avoid false positives.
- **Setting `preferLocal: false` for no reason.** Local calls skip serialization and network. Only set `false` if you need even distribution for testing or if local endpoints are intentionally degraded.

## Source files

When moleculer is installed as a dependency, the full source is at `node_modules/moleculer/src/`. Read these files to verify behavior or dig deeper:

- `node_modules/moleculer/src/transporters/index.js` — transporter registry, `resolve()` (string/URL/object/class), `getByName`, URL-scheme matching, `register()` for custom transporters
- `node_modules/moleculer/src/transporters/base.js` — `Base` transporter, `init()`, `publish()`, `subscribe()`, topic naming (`getTopicName`), balanced request/event topics, `makeBalancedSubscriptions`
- `node_modules/moleculer/src/transporters/nats.js`, `tcp.js`, `redis.js`, `amqp.js`, `kafka.js`, `mqtt.js` — individual transporter implementations
- `node_modules/moleculer/src/transit.js` — `Transit` class, `connect()`/`disconnect()`/`ready()`, `afterConnect()`, reconnection logic, pending request/stream maps, `makeSubscriptions()` (packet types subscribed)
- `node_modules/moleculer/src/cachers/index.js` — cacher registry, `resolve()` (boolean/string/URL/object/class)
- `node_modules/moleculer/src/cachers/base.js` — `Base` cacher, `middleware()` (cache get/set wrapping, lock logic), `defaultKeygen`, `getCacheKey`, `_hashedKey`, `middlewareWithLock`/`middlewareWithoutLock` (thundering herd prevention)
- `node_modules/moleculer/src/cachers/memory.js` — Memory cacher, TTL check interval, `getWithTTL` sliding expiration, cloning, `Lock` usage
- `node_modules/moleculer/src/cachers/redis.js` — Redis cacher, ioredis integration, cluster mode, redlock, ping interval, serializer for values
- `node_modules/moleculer/src/serializers/index.js` — serializer registry, `resolve()`, built-in types
- `node_modules/moleculer/src/strategies/index.js` — strategy registry, `resolve()` (returns class, not instance)
- `node_modules/moleculer/src/strategies/shard.js` — consistent hashing, `rebuild()` ring construction, `getNodeIDByKey` ceiling lookup, LRU cache, `getKeyFromContext` (#meta vs params)
- `node_modules/moleculer/src/registry/discoverers/index.js` — discoverer registry, `resolve()`
- `node_modules/moleculer/src/registry/discoverers/base.js` — heartbeat timers, `checkRemoteNodes`, `checkOfflineNodes`, `heartbeatReceived` (seq/instanceID change detection), `startHeartbeatTimers`/`stopHeartbeatTimers`

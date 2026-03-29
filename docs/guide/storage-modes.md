# Storage Modes

vite-plugin-monitor supports four storage modes, each designed for a different deployment scenario. The mode is selected via `storage.mode` (default: `'auto'`).

## Comparison

| Mode | Transport | Server | Ideal for |
|------|-----------|--------|-----------|
| `middleware` | HTTP (same-origin) | Vite dev server | Local development |
| `standalone` | HTTP (separate port) | Plugin-managed Node.js server | Multi-process dev setups |
| `http` | HTTP (custom endpoint) | Your own backend | Production |
| `websocket` | WebSocket | Your own backend | Production with real-time needs |

## Auto Mode

When `mode` is not set (or set to `'auto'`), the plugin picks the best mode automatically:

- **During `vite dev` or `vite preview`**: selects `middleware`
- **During `vite build`**: **throws an error** if `writeEndpoint` is not set

```typescript
trackerPlugin({
  appId: 'my-app',
  // storage.mode defaults to 'auto'
})
```

::: warning Production builds require explicit mode
Running `vite build` with `mode: 'auto'` and no `writeEndpoint` throws:
```
[vite-plugin-monitor] Production build requires storage.mode = "http" with a valid writeEndpoint.
```
Always set `storage.mode` explicitly for production builds.
:::

---

## Middleware Mode

Events are handled directly by Vite's built-in dev server. No external processes are needed.

```typescript
trackerPlugin({
  appId: 'my-app',
  storage: {
    mode: 'middleware',
  },
})
```

**How it works:**

1. The plugin registers a Connect middleware on Vite's `server.middlewares`.
2. The browser POSTs events to `/_tracker/events` (same-origin).
3. The middleware stores events in an in-memory **ring buffer** (default: 500,000 events, FIFO eviction).
4. The dashboard reads from `/_tracker?since=...&until=...`.
5. Events are also written to log files via the logger worker.
6. On startup, existing log files are **replayed** into the ring buffer so the dashboard retains history across Vite restarts.

**Endpoints (auto-configured):**

| Endpoint | Description |
|----------|-------------|
| `/_tracker/events` | POST — ingest events |
| `/_tracker` | GET — read events (dashboard) |
| `/_tracker/ping` | GET — health check |

**Limitations:**
- Stops working when the Vite dev server is not running.
- In-memory only between server restarts (unless log files exist for replay).

---

## Standalone Mode

The plugin spins up its own HTTP server on a separate port (default: `4242`). This is useful when:

- The Vite dev server and the app backend run on different ports/processes.
- You want the tracker server to remain running independently of Vite HMR cycles.

```typescript
trackerPlugin({
  appId: 'my-app',
  storage: {
    mode: 'standalone',
    port: 4242,  // default
  },
})
```

**How it works:**

1. Plugin starts a Node.js HTTP server on the configured `port`.
2. The browser POSTs events to `http://localhost:4242/_tracker/events`.
3. The server maintains its own ring buffer and responds to dashboard queries.
4. Also supports a WebSocket endpoint at `ws://localhost:4242/_tracker/ws`.
5. Log replay on startup works the same as in middleware mode.

**Endpoints (auto-configured):**

| Endpoint | Description |
|----------|-------------|
| `http://localhost:4242/_tracker/events` | POST — ingest events |
| `http://localhost:4242/_tracker` | GET — read events (dashboard) |
| `http://localhost:4242/_tracker/ping` | GET — health check |
| `ws://localhost:4242/_tracker/ws` | WebSocket — optional WS ingest |

::: tip CORS
The standalone server adds permissive CORS headers (`Access-Control-Allow-Origin: *`) to accommodate cross-origin requests from the browser.
:::

::: warning Port conflicts
If port `4242` is in use, the server will fail to start with an `EADDRINUSE` error in the Vite terminal. Use `storage.port` to configure a different port.
:::

---

## HTTP Mode

Events are sent to your own REST API endpoint. This is the mode for **production**.

```typescript
trackerPlugin({
  appId: 'my-app',
  storage: {
    mode:          'http',
    writeEndpoint: 'https://api.myapp.com/tracker/ingest',  // required
    readEndpoint:  'https://api.myapp.com/tracker/events',  // optional
    pingEndpoint:  'https://api.myapp.com/health',          // optional
    apiKey:        process.env.TRACKER_API_KEY,             // optional
    batchSize:     50,                                       // default: 25
    flushInterval: 5000,                                    // default: 3000ms
  },
})
```

**Your backend must implement:**

```
POST <writeEndpoint>
Content-Type: application/json
X-Tracker-Key: <apiKey>   (only when configured)

{ "events": TrackerEvent[] }
```

Any `2xx` response is treated as success. Non-`2xx` causes the batch to be re-queued and retried on the next flush interval.

**Optional — read endpoint for the dashboard:**

```
GET <readEndpoint>?since=<ISO8601>&until=<ISO8601>
Accept: application/json
X-Tracker-Key: <apiKey>

Response:
{ "events": TrackerEvent[], "total": 123 }
```

If `readEndpoint` is not set, it is inferred by stripping `/events` from `writeEndpoint`.

See [API Contracts](/reference/api-contracts) for the full specification.

---

## WebSocket Mode

All traffic — event ingest and dashboard queries — flows over a single persistent WebSocket connection.

```typescript
trackerPlugin({
  appId: 'my-app',
  storage: {
    mode:         'websocket',
    wsEndpoint:   'wss://api.myapp.com/tracker/ws',  // required
    pingEndpoint: 'https://api.myapp.com/health',     // optional
    apiKey:       process.env.TRACKER_API_KEY,        // optional
    batchSize:    25,
    flushInterval: 3000,
  },
})
```

Your server must implement the tracker WebSocket sub-protocol:

| Direction | Message |
|-----------|---------|
| Browser → Server | `{ "type": "ingest", "events": TrackerEvent[] }` |
| Server → Browser | `{ "type": "ack", "saved": 42 }` |
| Dashboard → Server | `{ "type": "events:query", "reqId": "uuid", "query": { "since": "...", "until": "..." } }` |
| Server → Dashboard | `{ "type": "events:response", "reqId": "uuid", "response": { "events": [...], "total": 123 } }` |
| Server → Browser (push) | `{ "type": "push", "events": TrackerEvent[] }` (optional) |

See [WebSocket Protocol](/reference/api-contracts#websocket-protocol) for the full specification.

---

## Ring Buffer & Log Replay

Both `middleware` and `standalone` modes use an in-memory **ring buffer** to store recent events for fast dashboard queries.

- Default capacity: **500,000 events** (configurable via `storage.maxBufferSize`).
- When capacity is exceeded, the **oldest events are evicted** (FIFO).
- On server startup, existing **log files are replayed** into the ring buffer, so the dashboard retains history even after a Vite restart.

Log replay reads all `.log` files matching the configured transport paths and their rotation archives, inserting them into the buffer in chronological order.

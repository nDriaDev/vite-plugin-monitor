# Storage

The `storage` option controls how events are transported from the browser to the backend and how they are stored. See [Storage Modes](/guide/storage-modes) for a conceptual overview.

## HTTP Storage Options

Used with modes `'auto'`, `'middleware'`, and `'http'`.

```typescript
trackerPlugin({
  appId: 'my-app',
  storage: {
    mode:          'http',
    writeEndpoint: 'https://api.myapp.com/tracker/events',
    readEndpoint:  'https://api.myapp.com/tracker',
    pingEndpoint:  'https://api.myapp.com/health',
    apiKey:        process.env.TRACKER_API_KEY,
    batchSize:     25,
    flushInterval: 5000,
    maxBufferSize: 500000,
  },
})
```

### `mode`

**Type:** `'auto' | 'middleware' | 'http' | 'websocket'` · **Default:** `'auto'`

Selects the storage backend. See [Storage Modes](/guide/storage-modes) for full details.

| Mode | Description |
|------|-------------|
| `'auto'` | Dev: `middleware`. Build: throws if no `writeEndpoint`. |
| `'middleware'` | Vite handles everything. No external process needed. |
| `'http'` | Send to your own REST API. Required for production. |
| `'websocket'` | All traffic over a persistent WebSocket. |

---

### `writeEndpoint`

**Type:** `string` · **Required when:** `mode = 'http'`

URL that receives batched events via `POST`.

**Request format:**
```
POST <writeEndpoint>
Content-Type: application/json
X-Tracker-Key: <apiKey>  (if configured)

{ "type": "ingest", "events": TrackerEvent[] }
```

Any `2xx` response is treated as success. Non-`2xx` causes the batch to be **re-queued** and retried on the next flush interval.

In `middleware` mode, this is **auto-configured** (same-origin `/_tracker/events`).

---

### `readEndpoint`

**Type:** `string` · **Optional**

URL queried by the dashboard for events. Must honour `?since=<ISO8601>&until=<ISO8601>` query parameters.

If omitted, it is **inferred** by stripping `/events` from `writeEndpoint`, if it ends with /events:
- `https://api.myapp.com/tracker/events` → `https://api.myapp.com/tracker`

**Request format:**
```
GET <readEndpoint>?since=2024-01-01T00:00:00.000Z&until=2024-01-02T00:00:00.000Z
Accept: application/json
X-Tracker-Key: <apiKey>  (if configured)
```

**Response format:**
```json
{ "events": TrackerEvent[], "total": 123, "page": 1, "limit": 5 }
```

::: info Gzip compression in middleware mode
In `middleware` mode the built-in read endpoint (`/_tracker`) returns a **gzip-compressed** response (`Content-Encoding: gzip`). Browsers decompress it automatically. Custom backends using `mode: 'http'` are not required to compress — plain JSON is fully supported.
:::

---

### `pingEndpoint`

**Type:** `string` · **Optional**

URL polled by the dashboard health check indicator (the coloured dot in the header). Any `2xx` response is treated as "online".

If omitted, no ping request is made and the backend is **assumed to be online** (the indicator always shows green). The health indicator is hidden only when a ping request explicitly fails with a non-`2xx` response.

---

### `apiKey`

**Type:** `string` · **Optional**

Sent as the `X-Tracker-Key` header on all requests (ingest, read, ping). Your backend can use this to authenticate tracker traffic.

```typescript
storage: {
  apiKey: process.env.TRACKER_API_KEY,
}
```

::: warning Security note
The API key is injected into `window.__TRACKER_CONFIG__` and is visible in the browser. Use it as a shared secret for basic traffic filtering, not as a substitute for proper authentication.
:::

---

### `batchSize`

**Type:** `number` · **Default:** `25`

Maximum number of events accumulated client-side before an automatic flush. When the queue reaches this size, all queued events are sent immediately regardless of `flushInterval`.

Increase for high-traffic pages. Decrease for near-real-time dashboard updates.

---

### `flushInterval`

**Type:** `number` · **Default:** `5000`

Maximum milliseconds between automatic flushes. Even if `batchSize` hasn't been reached, a flush is triggered after this interval.

```typescript
storage: {
  batchSize:     50,
  flushInterval: 5000, // flush every 5s or every 50 events, whichever comes first
}
```

::: tip Page unload
On page unload, all remaining queued events are sent via `navigator.sendBeacon` **regardless** of `batchSize` or `flushInterval`. Beacon delivery is guaranteed by the browser even if the page is closing.
:::

---

### `maxBufferSize`

**Type:** `number` · **Default:** `500000`

Maximum events kept in the **server-side in-memory ring buffer**. Only used in `middleware` mode.

When capacity is exceeded, the **oldest events are evicted** (FIFO). The ring buffer is the data source for dashboard queries.

```typescript
storage: {
  maxBufferSize: 100000, // keep 100k events in memory
}
```

---

## WebSocket Storage Options

Used with `mode = 'websocket'`. Replaces the HTTP batch transport with a single persistent WebSocket connection.

```typescript
trackerPlugin({
  appId: 'my-app',
  storage: {
    mode:         'websocket',            // required discriminant
    wsEndpoint:   'wss://api.myapp.com/tracker/ws', // required
    pingEndpoint: 'https://api.myapp.com/health',   // optional
    apiKey:       process.env.TRACKER_API_KEY,      // optional
    batchSize:    25,
    flushInterval: 5000,
  },
})
```

### `wsEndpoint` <Badge type="danger" text="required" />

**Type:** `string`

WebSocket URL. Must start with `ws://` or `wss://`. Required when `mode = 'websocket'`.

Your server must implement the [tracker WebSocket protocol](/reference/api-contracts#websocket-protocol).

---

## Endpoint Auto-Configuration

In `middleware` mode, endpoints are **automatically configured** — you don't need to set them manually:

| Mode | `writeEndpoint` | `readEndpoint` |
|------|-----------------|----------------|
| `middleware` | `/_tracker/events` (same-origin) | `/_tracker` (same-origin) |

The `pingEndpoint` in dev is always served at `/_tracker/ping` by the Vite middleware.

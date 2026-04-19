# API Contracts

This page describes the HTTP and WebSocket contracts that vite-plugin-monitor's client uses to communicate with the backend. Implement these contracts when using `mode: 'http'` or `mode: 'websocket'`.

## Ingest Endpoint (HTTP)

Used when `storage.mode = 'http'`. The browser POSTs batched events to this endpoint.

### Request

```
POST <storage.writeEndpoint>
Content-Type: application/json
X-Tracker-Key: <storage.apiKey>    (only when apiKey is configured)

{
  "type": "ingest",
  "events": TrackerEvent[]
}
```

**Headers:**

| Header | Value | When |
|--------|-------|------|
| `Content-Type` | `application/json` | Always |
| `X-Tracker-Key` | The configured `apiKey` | Only when `storage.apiKey` is set |

**Body:**

The `events` array contains one or more `TrackerEvent` objects. A single flush can contain up to `storage.batchSize` events (default: 25).

::: warning Assign `id` on every ingested event
The browser client always sends events with `id: ""` (an empty string). Your ingest handler **must** assign a unique, non-empty `id` to every event before persisting it — for example:

```typescript
// Node.js / TypeScript
import { randomUUID } from 'node:crypto'

for (const event of body.events) {
  event.id = randomUUID()
  await db.collection('events').insertOne(event)
}
```

Any unique string format is valid: UUID v4, MongoDB ObjectId, ULID, etc. The dashboard requires a non-empty `id` on every event to identify table rows without serializing the full payload. The built-in middleware mode handles this automatically.
:::

### Response

| Status | Behavior |
|--------|----------|
| `2xx` (any) | **Success** — batch is acknowledged and removed from the client queue |
| Non-`2xx` | **Failure** — batch is re-queued and retried on the next flush interval |

**Minimal success response:**
```
HTTP/1.1 200 OK
```

No response body is required. The client ignores the response body for the ingest endpoint.

### Page Unload

On page unload (`beforeunload`), the client sends remaining events via `navigator.sendBeacon` using a `Blob` with `Content-Type: application/json`:

```
POST <writeEndpoint>
Content-Type: application/json

{ "type": "ingest", "events": TrackerEvent[] }
```

::: info `Content-Type` on Beacon requests
The plugin wraps the payload in a `Blob({ type: 'application/json' })` before passing it to `navigator.sendBeacon`. This causes the browser to send the request with `Content-Type: application/json`, the same header used by regular fetch flushes. Your backend does not need special handling for beacon requests.
:::

---

## Read Endpoint (HTTP)

Used by the dashboard to query events. Required if you want the dashboard to display events in `mode: 'http'`.

### Request

```
GET <storage.readEndpoint>?since=<ISO8601>&until=<ISO8601>
Accept: application/json
X-Tracker-Key: <storage.apiKey>    (only when apiKey is configured)
```

**Query Parameters:**

| Parameter | Format | Description |
|-----------|--------|-------------|
| `since` | ISO 8601 UTC | Start of time range (inclusive) |
| `until` | ISO 8601 UTC | End of time range (inclusive) |

The dashboard **always** sends both `since` and `until`. Your server must filter events to the `[since, until]` window and return them **newest first** (descending by timestamp).

**Example request:**
```
GET /tracker/events?since=2024-03-15T00:00:00.000Z&until=2024-03-15T23:59:59.999Z
Accept: application/json
X-Tracker-Key: tk_prod_xxxx
```

### Response

```
HTTP/1.1 200 OK
Content-Type: application/json
Access-Control-Allow-Origin: *

{
  "events": TrackerEvent[],
  "total":  123,
  "page": 1,
  "limit": 5
}
```

| Field | Type | Description |
|-------|------|-------------|
| `events` | `TrackerEvent[]` | Events in the time range, newest first |
| `total` | `number` | Total count of events in the time range |

::: info Gzip compression in middleware mode
The built-in middleware (`mode: 'middleware'`) compresses the read endpoint response with **gzip** (level 1) and adds `Content-Encoding: gzip` to the response headers. The dashboard handles this transparently via the browser's native fetch decompression.

If you implement a **custom backend** (`mode: 'http'` or `mode: 'websocket'`), you may return an uncompressed response — gzip is optional. The dashboard's `fetch` call sets no `Accept-Encoding` header explicitly and relies on the browser's default negotiation.
:::

::: tip Pagination
The dashboard currently does **not** use server-side pagination — it loads all events for the selected time range in a single request. For large time ranges (e.g. 30d with millions of events), you may want to implement server-side aggregation or return a limited sample.

The `total` field should reflect the full count even if you return a subset of events.
:::

::: info Client-side filtering
Your server only needs to implement **time-range filtering** (`since`/`until`). All other filtering (by type, level, userId, route, full-text search) and all aggregations (KPI cards, charts, top lists) are performed **client-side in the browser dashboard**. Do not implement these on the server.
:::

---

## Ping Endpoint (HTTP)

Used by the dashboard's health check indicator. Any URL that returns `2xx` is sufficient.

```
GET <storage.pingEndpoint>

→ 200 OK (or any 2xx)
```

The dashboard polls this endpoint to determine whether the backend is reachable and shows a coloured status dot (🟢 online / 🔴 offline).

If `pingEndpoint` is not configured, no request is made and the backend is **assumed to be online** — the status dot always shows 🟢 green.

---

## WebSocket Protocol

Used when `storage.mode = 'websocket'`. All messages are JSON strings sent over a single persistent WebSocket connection.

The client connects to `storage.wsEndpoint` (`wss://...`) and uses the same connection for both event ingest and dashboard queries.

### Connection

When apiKey is configured, immediately after the connection is established, the client sends:
{
  "type": "auth",
  "key": "<storage.apiKey>"
}

The server must respond with:
{ "type": "auth_ok" }

Until authentication succeeds, the server must reject all other messages
and may close the connection with code 1008.

If no apiKey is configured, no auth message is sent and the connection
is immediately ready for ingest and query messages.
The client reconnects automatically with a fixed 3-second delay on disconnect.

---

### Ingest — Browser → Server

The browser sends batched events:

```json
{
  "type": "ingest",
  "events": TrackerEvent[]
}
```

::: warning Assign `id` on every ingested event
Events arrive with `id: ""`. Your server must assign a unique `id` to each event before persisting it (e.g. `randomUUID()`). See the [Ingest Endpoint](#ingest-endpoint-http) warning for a complete example.
:::

---

### Ingest ACK — Server → Browser

The server acknowledges receipt:

```json
{
  "type":  "ack",
  "saved": 42
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"ack"` | Message discriminant |
| `saved` | `number` | Number of events successfully persisted |

If no ACK is received within the flush timeout, the batch is re-queued.

---

### Dashboard Query — Dashboard → Server

The dashboard requests events for a time range:

```json
{
  "type":  "events:query",
  "reqId": "550e8400-e29b-41d4-a716-446655440000",
  "query": {
    "since": "2024-03-15T00:00:00.000Z",
    "until": "2024-03-15T23:59:59.999Z"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"events:query"` | Message discriminant |
| `reqId` | `string` | UUID — correlates the response to this request |
| `query.since` | ISO 8601 | Start of time range |
| `query.until` | ISO 8601 | End of time range |

---

### Dashboard Response — Server → Dashboard

The server responds to a query:

```json
{
  "type":  "events:response",
  "reqId": "550e8400-e29b-41d4-a716-446655440000",
  "response": {
    "events": TrackerEvent[],
    "total":  123
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"events:response"` | Message discriminant |
| `reqId` | `string` | Must match the `reqId` from the query |
| `response.events` | `TrackerEvent[]` | Events in range, newest first |
| `response.total` | `number` | Total count in range |

---

### Real-Time Push — Server → Browser (Optional)

The server can push new events to all connected clients in real time:

```json
{
  "type":   "push",
  "events": TrackerEvent[]
}
```

When the dashboard receives a `push` message while in **Live** mode, it merges the new events into the current dataset without a full re-query. This enables true real-time updates without polling.

This message is **optional** — the dashboard works correctly without it (it falls back to polling).

---

## Middleware Mode Endpoints

In `middleware` mode, the plugin implements all endpoints internally on the Vite dev server. These are the auto-configured values:

| Endpoint | Value |
|----------|-------|
| Ingest (POST) | `/_tracker/events` |
| Read (GET) | `/_tracker` |
| Ping (GET) | `/_tracker/ping` |

::: info Read endpoint response compression
`GET /_tracker` returns a **gzip-compressed** JSON response (`Content-Encoding: gzip`, level 1). Browsers decompress it transparently. This is handled automatically by the built-in dashboard — no configuration required.
:::

The ping endpoint in middleware mode returns:

```json
{
  "ok":    true,
  "appId": "my-app",
  "mode":  "middleware",
  "version": "0.1.0"
}
```

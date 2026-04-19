# Event Types & Payloads

Every interaction captured by vite-plugin-monitor is represented as a `TrackerEvent` — a typed envelope that flows through the entire system.

## TrackerEvent (Envelope)

```typescript
interface TrackerEvent {
  id:         string           // Unique event identifier. Set to "" by the browser client; assigned by the backend on ingest.
  timestamp:  string           // ISO 8601 UTC: "2024-03-15T10:23:45.123Z"
  level:      LogLevel         // 'debug' | 'info' | 'warn' | 'error'
  type:       TrackerEventType // Discriminant for the payload union
  appId:      string           // From trackerPlugin({ appId })
  sessionId:  string           // Per-tab lifetime ID, e.g. "sess_abc123"
  userId:     string           // Identified or anonymous user ID
  groupId?:   string           // Optional — links related events
  context?:   Record<string, unknown> // From tracker.setContext()
  payload:    EventPayload     // Type-specific data (discriminated union)
  meta:       EventMeta        // Browser metadata
}
```

::: info `id` field and external backends
The browser client always sends events with `id: ""` (an empty string). The built-in middleware server assigns a `crypto.randomUUID()` to each event at ingest time, before storing it in the ring buffer and writing it to the log file.

**If you are using an external backend** (`mode: 'http'` or `mode: 'websocket'`), your ingest handler **must** assign a unique, non-empty `id` to every event before persisting it. Any unique string format is acceptable — UUID v4, MongoDB ObjectId, ULID, etc. The dashboard uses `id` to identify table rows without serializing the full event payload.
:::

### `LogLevel`

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error'
```

Levels are ordered: `debug < info < warn < error`.

Automatic level assignment by trackers:
- HTTP 5xx → `'error'`
- HTTP 4xx → `'warn'`
- Unhandled JS errors → `'error'`
- Everything else → `'info'`

### `TrackerEventType`

```typescript
type TrackerEventType =
  | 'click'
  | 'http'
  | 'error'
  | 'navigation'
  | 'console'
  | 'custom'
  | 'session'
```

---

## EventMeta

Browser metadata captured at event emission time and attached to every event.

```typescript
interface EventMeta {
  userAgent:        string                    // navigator.userAgent
  route:            string                    // location.pathname + location.search
  viewport:         string                    // "1440x900" (CSS pixels)
  language:         string                    // navigator.language — e.g. "en-US"
  referrer?:        string                    // document.referrer (may be empty)
  buildVersion?:    string                    // Application build version injected at build time
  userAttributes?:  Record<string, unknown>  // From tracker.setUser(id, { attributes })
}
```

---

## Payload Types

### `click`

Emitted by the click tracker on every `click` event reaching `document` via event delegation.

```typescript
interface ClickPayload {
  tag:         string                   // lowercase tag name: "button", "a", "div"
  text?:       string                   // innerText (trimmed, max 100 chars)
  id?:         string                   // element.id attribute
  classes?:    string                   // Space-separated CSS class names of the clicked element
  xpath?:       string                   // Abbreviated XPath expression that uniquely identifies the element in the DOM
  coordinates:       {x: number, y: number}                   // Viewport-relative click coordinates in CSS pixels.
}
```

**Example:**
```json
{
  "type": "click",
  "level": "info",
  "payload": {
    "tag":     "button",
    "text":    "Add to cart",
    "id":      "add-to-cart-btn",
    "classes": "btn btn-primary",
    "xpath": "/html/body/div/h3[3]/code[1]",
    "coordinates": {"x": 48, "y": 50}
  }
}
```

---

### `http`

Emitted by the HTTP tracker for every `fetch` and `XMLHttpRequest` call.

```typescript
interface HttpPayload {
  method:            string    // "GET", "POST", "PUT", "PATCH", "DELETE"
  url:               string    // Full absolute URL including query string
  status?:           number    // HTTP status code (absent on network error)
  duration?:         number    // Round-trip ms (absent on early error)
  error?:            string    // Network/parsing error (mutually exclusive with status)
  requestHeaders?:   Record<string, string>   // Sanitized (requires captureRequestHeaders)
  requestBody?:      unknown   // Redacted body (requires captureRequestBody)
  requestSize?:      number    // Byte length of raw request body (before redaction)
  responseHeaders?:  Record<string, string>   // Sanitized (requires captureResponseHeaders)
  responseBody?:     unknown   // Redacted body (requires captureResponseBody)
  responseSize?:     number    // Byte length of raw response body (before redaction)
}
```

**Example (success):**
```json
{
  "type": "http",
  "level": "info",
  "payload": {
    "method":   "POST",
    "url":      "https://api.myapp.com/orders",
    "status":   201,
    "duration": 312
  }
}
```

**Example (error):**
```json
{
  "type": "http",
  "level": "error",
  "payload": {
    "method":   "GET",
    "url":      "https://api.myapp.com/users",
    "status":   500,
    "duration": 45
  }
}
```

**Example (network failure):**
```json
{
  "type": "http",
  "level": "error",
  "payload": {
    "method": "GET",
    "url":    "https://api.myapp.com/users",
    "error":  "TypeError: Failed to fetch"
  }
}
```

---

### `error`

Emitted by the error tracker for unhandled JavaScript errors and unhandled Promise rejections.

```typescript
interface ErrorPayload {
  message:    string    // Error message
  stack?:     string    // Stack trace (may be absent for cross-origin errors)
  filename?:  string    // Source file URL (synchronous errors only)
  lineno?:    number    // Line number in source file (synchronous errors only)
  colno?:     number    // Column number in source file (synchronous errors only)
  errorType:  string    // Constructor name: "TypeError", "ReferenceError", "UnhandledRejection"
}
```

**Example:**
```json
{
  "type": "error",
  "level": "error",
  "payload": {
    "message":   "Cannot read properties of undefined (reading 'id')",
    "stack":     "TypeError: Cannot read properties of undefined...\n    at Component (/src/App.tsx:42:18)",
    "filename":  "https://myapp.com/assets/index-abc123.js",
    "lineno":    42,
    "colno":     18,
    "errorType": "TypeError"
  }
}
```

---

### `navigation`

Emitted by the navigation tracker on every client-side route change.

```typescript
interface NavigationPayload {
  from:     string    // Previous route (pathname + search)
  to:       string    // New route (pathname + search)
  trigger:  'pushState' | 'replaceState' | 'popstate' | 'hashchange' | 'load'
  duration?: number  // Time on previous route in ms (~0 for 'load' trigger)
}
```

| trigger | Cause |
|---------|-------|
| `'pushState'` | `history.pushState()` — typical SPA link click |
| `'replaceState'` | `history.replaceState()` — silent URL rewrite |
| `'popstate'` | Browser back/forward button or `history.go()` |
| `'hashchange'` | Anchor `#fragment` change without full reload |
| `'load'` | Initial page load — emitted synchronously at tracker setup time, not via a DOM `load` event; `from` is the previous route if known (MPA `sessionStorage` key or same-origin referrer), otherwise equals `to` |

**Example:**
```json
{
  "type": "navigation",
  "level": "info",
  "payload": {
    "from":     "/products?category=shoes",
    "to":       "/products/42",
    "trigger":  "pushState",
    "duration": 4230
  }
}
```

---

### `console`

Emitted by the console tracker for intercepted `console.*` calls.

```typescript
interface ConsolePayload {
  method:     ConsoleMethod       // Which console method was called
  message:    string              // Human-readable summary derived from the first argument.
  args:       SerializedArg[]     // Serialized arguments (up to maxArgs)
  stack?:     string              // Stack trace (console.error when captureStackOnError: true)
  groupDepth: number              // Nesting depth of `console.group()` / `console.groupCollapsed()` calls at the moment this event was emitted.
}

type ConsoleMethod =
  | 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace'
  | 'dir' | 'dirxml' | 'group' | 'groupCollapsed' | 'groupEnd'
  | 'table' | 'time' | 'timeEnd' | 'timeLog' | 'assert'
  | 'clear' | 'count' | 'countReset'

interface SerializedArg {
  type:  'string' | 'number' | 'boolean' | 'null' | 'undefined' | 'object' | 'array' | 'function' | 'symbol'
  value: unknown    // Serialized value (truncated to maxArgLength)
}
```

**Example:**
```json
{
  "type": "console",
  "level": "warn",
  "payload": {
    "message": "this is an example",
    "method": "warn",
    "args": [
      { "type": "string", "value": "Deprecated API called:" },
      { "type": "string", "value": "useOldMethod()" }
    ],
    "groupDepth": 0
  }
}
```

---

### `custom`

Emitted by `tracker.track()` and `tracker.timeEnd()`.

```typescript
interface CustomPayload {
  name:       string                    // Event name (e.g. "checkout:completed")
  data:       Record<string, unknown>  // Caller-provided data
  duration?:  number                   // Populated by tracker.timeEnd() (ms)
}
```

**Example (tracker.track):**
```json
{
  "type": "custom",
  "level": "info",
  "payload": {
    "name": "checkout:completed",
    "data": { "orderId": "ORD-123", "total": 49.99, "currency": "EUR" }
  }
}
```

**Example (tracker.timeEnd):**
```json
{
  "type": "custom",
  "level": "info",
  "payload": {
    "name":     "api:load-users",
    "duration": 142,
    "data":     { "count": 15 }
  }
}
```

---

### `session`

Automatically emitted at key identity lifecycle moments.

```typescript
interface SessionPayload {
  action:          'start' | 'end'
  trigger:         'init' | 'userId-change' | 'unload' | 'destroy'
  previousUserId?: string  // Only on 'end' events from userId-change
  newUserId?:      string  // Only on 'start' events from userId-change
}
```

| trigger | action | trigger value |
|---------|--------|-----------|
| `tracker.init()` | `start` | `init` |
| `tracker.setUser()` called | `end` then `start` | `userId-change` |
| Page unload (`beforeunload`) | `end` | `unload` |
| `tracker.destroy()` | `end` | `destroy` |

**Example (init):**
```json
{
  "type": "session",
  "level": "info",
  "userId": "user_123",
  "payload": {
    "action": "start",
    "trigger": "init"
  }
}
```

**Example (user change):**
```json
{ "type": "session", "payload": { "action": "end", "trigger": "userId-change", "previousUserId": "anon_xyz" } }
{ "type": "session", "payload": { "action": "start", "trigger": "userId-change", "newUserId": "user_456" } }
```

---

## TypeScript Narrowing

Use the `type` field to narrow the `EventPayload` union in TypeScript:

```typescript
import type { TrackerEvent, ClickPayload, HttpPayload } from '@ndriadev/vite-plugin-monitor'

function processEvent(event: TrackerEvent) {
  switch (event.type) {
    case 'click':
      // event.payload is ClickPayload
      console.log(event.payload.tag, event.payload.text)
      break
    case 'http':
      // event.payload is HttpPayload
      console.log(event.payload.method, event.payload.status)
      break
    case 'error':
      // event.payload is ErrorPayload
      console.log(event.payload.message, event.payload.errorType)
      break
    case 'custom':
      // event.payload is CustomPayload
      console.log(event.payload.name, event.payload.data)
      break
  }
}
```

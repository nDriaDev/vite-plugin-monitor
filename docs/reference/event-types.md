# Event Types & Payloads

Every interaction captured by vite-plugin-monitor is represented as a `TrackerEvent` — a typed envelope that flows through the entire system.

## TrackerEvent (Envelope)

```typescript
interface TrackerEvent {
  id?:        string           // Assigned by backend on ingest (absent on client)
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
  userAgent:    string    // navigator.userAgent
  route:        string    // location.pathname + location.search
  viewport:     string    // "1440x900" (CSS pixels)
  language:     string    // navigator.language — e.g. "en-US"
  referrer?:    string    // document.referrer (may be empty)
  appVersion?:  string    // From package.json or custom build config
  connection?:  string    // navigator.connection.effectiveType — "4g" | "3g" | "2g" | "slow-2g"
}
```

---

## Payload Types

### `click`

Emitted by the click tracker on every `click` event reaching `document` via event delegation.

```typescript
interface ClickPayload {
  tag:         string    // lowercase tag name: "button", "a", "div"
  text?:       string    // innerText (trimmed, max 100 chars)
  id?:         string    // element.id attribute
  classes?:    string[]  // element.className split by space
  href?:       string    // href attribute (anchor elements only)
  attributes?: Record<string, string>  // data-* and aria-* attributes
  route:       string    // meta.route at click time
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
    "classes": ["btn", "btn-primary"],
    "attributes": {
      "data-product-id": "42",
      "aria-label":      "Add product to cart"
    },
    "route": "/products/42"
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
  requestBody?:      string    // Redacted JSON string (requires captureRequestBody)
  responseHeaders?:  Record<string, string>   // Sanitized (requires captureResponseHeaders)
  responseBody?:     string    // Redacted JSON string (requires captureResponseBody)
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
  duration?: number  // Time on previous route in ms (absent for 'load' trigger)
}
```

| trigger | Cause |
|---------|-------|
| `'pushState'` | `history.pushState()` — typical SPA link click |
| `'replaceState'` | `history.replaceState()` — silent URL rewrite |
| `'popstate'` | Browser back/forward button or `history.go()` |
| `'hashchange'` | Anchor `#fragment` change without full reload |
| `'load'` | Initial page load; `from === to` |

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
  method:  ConsoleMethod       // Which console method was called
  args:    SerializedArg[]     // Serialized arguments (up to maxArgs)
  stack?:  string              // Stack trace (console.error when captureStackOnError: true)
}

type ConsoleMethod =
  | 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace'
  | 'dir' | 'dirxml' | 'group' | 'groupCollapsed' | 'groupEnd'
  | 'table' | 'time' | 'timeEnd' | 'timeLog' | 'timeStamp'
  | 'assert' | 'clear' | 'count' | 'countReset'

interface SerializedArg {
  type:  'string' | 'number' | 'boolean' | 'null' | 'undefined' | 'object' | 'array' | 'function' | 'symbol'
  value: string    // Serialized value (truncated to maxArgLength)
}
```

**Example:**
```json
{
  "type": "console",
  "level": "warn",
  "payload": {
    "method": "warn",
    "args": [
      { "type": "string", "value": "Deprecated API called:" },
      { "type": "string", "value": "useOldMethod()" }
    ]
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
    "data":     { "durationMs": 142, "count": 15 },
    "duration": 142
  }
}
```

---

### `session`

Automatically emitted at key identity lifecycle moments.

```typescript
interface SessionPayload {
  action:      'start' | 'end'
  source:      'init' | 'userId-change' | 'unload' | 'destroy'
  userId?:     string    // New user ID (on 'start' events)
  previousUserId?: string  // Previous user ID (on 'end' events from userId-change)
}
```

| trigger | action | source |
|---------|--------|--------|
| `tracker.init()` | `start` | `init` |
| `tracker.setUser()` called | `end` then `start` | `userId-change` |
| Page unload (`beforeunload`) | `end` | `unload` |
| `tracker.destroy()` | `end` | `destroy` |

**Example (init):**
```json
{
  "type": "session",
  "level": "info",
  "payload": {
    "action": "start",
    "source": "init",
    "userId": "user_123"
  }
}
```

**Example (user change):**
```json
{ "type": "session", "payload": { "action": "end", "source": "userId-change", "previousUserId": "anon_xyz" } }
{ "type": "session", "payload": { "action": "start", "source": "userId-change", "userId": "user_456" } }
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

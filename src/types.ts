// INFO Shared primitives

/**
* Discriminant field that identifies the category of a tracked event.
*
* @remarks
* Every {@link TrackerEvent} carries a `type` field whose value is one of
* these literals. The type acts as the discriminant of the {@link EventPayload}
* union: given `event.type === 'click'` TypeScript narrows `event.payload` to
* {@link ClickPayload}, and so on. It is also the primary axis for filtering
* events in the dashboard query API.
*
* | Value           | Payload type               | Emitted by                                    |
* |-----------------|----------------------------|-----------------------------------------------|
* | `'click'`       | {@link ClickPayload}       | Click tracker                                 |
* | `'http'`        | {@link HttpPayload}        | HTTP tracker (fetch + XHR)                    |
* | `'error'`       | {@link ErrorPayload}       | Error tracker                                 |
* | `'navigation'`  | {@link NavigationPayload}  | Navigation tracker                            |
* | `'console'`     | {@link ConsolePayload}     | Console tracker                               |
* | `'custom'`      | {@link CustomPayload}      | `tracker.track()` / `timeEnd()`               |
* | `'session'`     | {@link SessionPayload}     | Lifecycle hooks (`init`, `setUser`, unload)   |
*
*/
export type TrackerEventType =
	| 'click'
	| 'http'
	| 'error'
	| 'navigation'
	| 'console'
	| 'custom'
	| 'session'

/**
* Severity level attached to every tracked event.
*
* @remarks
* The level is used in two independent ways:
*
* 1. **Client-side filtering** - events below `track.level` (default `'info'`)
*    are discarded before being queued, reducing noise and bandwidth.
* 2. **Server-side filtering** - events below `logging.level` are not written
*    to any log transport, regardless of what the client sends.
*
* Levels are ordered: `debug < info < warn < error`. Setting a threshold of
* `'warn'` means only `'warn'` and `'error'` events pass through.
*
* Automatic trackers assign levels heuristically:
* - HTTP 5xx responses -> `'error'`
* - HTTP 4xx responses -> `'warn'`
* - Unhandled JS errors -> `'error'`
* - Everything else -> `'info'`
*
*/
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

// INFO Event envelope, payloads and metadata

/**
* The envelope that wraps every tracked event regardless of its type.
*
* @remarks
* `TrackerEvent` is the single unit of data flowing through the entire system:
* captured in the browser, queued in the `EventQueue`, flushed to the backend,
* stored in the ring buffer or database, and displayed in the dashboard.
*
* The `type` + `payload` pair forms a discriminated union. Always narrow on
* `type` before accessing payload-specific fields:
*
* @example
* ```ts
* function handleEvent(event: TrackerEvent) {
*   if (event.type === 'http') {
*     console.log(event.payload.status)   // HttpPayload
*   } else if (event.type === 'click') {
*     console.log(event.payload.tag)      // ClickPayload
*   }
* }
* ```
*
* @see {@link EventPayload} for the discriminated union of all payload shapes.
* @see {@link EventMeta} for the browser metadata attached to every event.
*/
export interface TrackerEvent {
	/**
	* Unique identifier assigned by the backend on ingest.
	*
	* @remarks
	* Not set by the browser client. Populated by the standalone server or an
	* external backend immediately before the event is persisted. Its format is
	* backend-specific (MongoDB ObjectId string, UUID, etc.).
	*
	* Absent while the event lives in the client-side queue or in in-memory ring
	* buffer entries that predate the first persistence write.
	*/
	id?: string

	/**
	* ISO 8601 UTC timestamp of when the event was captured on the client.
	*
	* @remarks
	* Set to `new Date().toISOString()` at the moment the tracker emits the
	* event - not when it is flushed to the backend. This means the timestamp
	* reflects the true time of occurrence even if the network is slow or the
	* queue is full.
	*
	* Used as the primary sort key for all queries and as the polling cursor
	* value in {@link EventsQuery.after}.
	*
	* @example `'2024-03-15T10:23:45.123Z'`
	*/
	timestamp: string

	/**
	* Severity classification of the event.
	*
	* @remarks
	* Assigned automatically by each tracker based on context (e.g. HTTP status
	* code, error type). Can be overridden via
	* `tracker.track(name, data, { level: 'warn' })`.
	*
	* @see {@link LogLevel}
	* @default 'info'
	*/
	level: LogLevel

	/**
	* Category of the event. Acts as the discriminant for {@link EventPayload}.
	*
	* @see {@link TrackerEventType}
	*/
	type: TrackerEventType

	/**
	* Application identifier, mirroring `trackerPlugin({ appId })`.
	*
	* @remarks
	* Allows a single backend deployment to receive and distinguish events from
	* multiple independent frontend applications. Attached to every event so
	* cross-app queries can filter by this field without joining on a session table.
	*/
	appId: string

	/**
	* Random identifier generated once per browser tab lifetime.
	*
	* @remarks
	* Created by `TrackerSession` on first load with a `sess_` prefix followed by
	* a random identifier, stored in `sessionStorage` so it survives soft navigations.
	*
	* Used to group all events emitted from a single continuous browser session,
	* enabling session replay, funnel analysis, and duration calculations.
	*/
	sessionId: string

	/**
	* Identifier of the user who triggered the event.
	*
	* @remarks
	* Set to the current user identifier at event emission time. Resolved from
	* the value stored in {@link TrackerSession}, which is initialized from the
	* `track.userId` function at startup and updated by {@link ITrackerClient.setUser}.
	* Falls back to an anonymous session-scoped ID when no user is identified.
	*/
	userId: string

	/**
	* Optional group ID linking a set of related events into a logical operation.
	*
	* @remarks
	* Obtained by calling `tracker.group('label')`, which returns a UUID. Pass
	* the returned ID to subsequent `tracker.track()` calls via `{ groupId }` to
	* associate them with the same logical flow (e.g. a checkout sequence).
	*
	* All events sharing a `groupId` can be retrieved together with
	* {@link EventsQuery.groupId}.
	*
	* @example
	* ```ts
	* const gid = tracker.group('checkout')
	* tracker.track('step:address',  { ... }, { groupId: gid })
	* tracker.track('step:payment',  { ... }, { groupId: gid })
	* tracker.track('step:complete', { ... }, { groupId: gid })
	* ```
	*/
	groupId?: string

	/**
	* Arbitrary key-value pairs attached to every event after `tracker.setContext()`.
	*
	* @remarks
	* Persists across all subsequent events until explicitly cleared.
	* Individual keys can be removed by passing `null`:
	* `tracker.setContext({ tenant: null })`.
	*
	* Keys set in a per-event `context` option are merged on top of the
	* persistent context for that single event only.
	*
	* Typical uses: A/B test variant IDs, feature flags, tenant IDs, environment labels.
	*
	* @example `{ tenant: 'acme', abVariant: 'checkout-v2', featureFlag: 'new-ui' }`
	*/
	context?: Record<string, unknown>

	/**
	* Type-specific event data whose shape is determined by `type`.
	*
	* @remarks
	* TypeScript narrows this field automatically when `type` is checked:
	* `if (e.type === 'http') e.payload  // -> HttpPayload`
	*
	* @see {@link EventPayload}
	*/
	payload: EventPayload

	/**
	* Browser and runtime metadata captured once per event at emission time.
	*
	* @see {@link EventMeta}
	*/
	meta: EventMeta
}

/**
* Discriminated union of all possible event payload shapes.
*
* @remarks
* Selecting the correct member is done by matching `TrackerEvent.type`.
* TypeScript narrows this union automatically in type guards and `switch` statements.
*
* @see {@link TrackerEvent}
*/
export type EventPayload =
	| ClickPayload
	| HttpPayload
	| ErrorPayload
	| NavigationPayload
	| ConsolePayload
	| CustomPayload
	| SessionPayload

/**
* Payload for events with `type === 'click'`.
*
* @remarks
* Emitted by the click tracker on every `click` event reaching `document`
* via event delegation (a single passive listener, no per-element binding).
* The tracker walks the DOM upward from the event target to collect element
* metadata without performing expensive layout queries.
*
* @see {@link TrackerEvent}
*/
export interface ClickPayload {
	/**
	* Lowercase HTML tag name of the element that received the click.
	*
	* @remarks
	* Sourced from `element.tagName.toLowerCase()`. For SVG elements this may
	* be a qualified name such as `'svg'` or `'path'`.
	*
	* @example `'button'`, `'a'`, `'div'`, `'svg'`
	*/
	tag: string

	/**
	* Trimmed text content of the clicked element, truncated to 100 characters.
	*
	* @remarks
	* Sourced from `element.innerText?.trim()`. Useful for identifying buttons
	* and links by their visible label without relying on DOM structure.
	* Absent for elements with no visible text (e.g. icon-only buttons).
	*
	* @example `'Add to cart'`, `'← Back'`
	*/
	text?: string

	/**
	* Value of the `id` attribute of the clicked element, if present and non-empty.
	*
	* @example `'submit-btn'`, `'nav-toggle'`
	*/
	id?: string

	/**
	* Space-separated CSS class names of the clicked element, if any.
	*
	* @remarks
	* Sourced from `element.className` as a raw string.
	*
	* @example `'btn btn-primary disabled'`
	*/
	classes?: string

	/**
	* Abbreviated XPath expression that uniquely identifies the element in the DOM.
	*
	* @remarks
	* Built by walking the ancestor chain up to `<html>`, limited to a maximum
	* depth of **8** to prevent unbounded recursion on deeply nested structures.
	* A sibling index (e.g. `[2]`) is appended only when two or more siblings
	* share the same tag name.
	*
	* @example `'/html/body/main/section/ul/li[3]/button'`
	*/
	xpath?: string

	/**
	* Viewport-relative click coordinates in CSS pixels.
	*
	* @remarks
	* Sourced from `MouseEvent.clientX` / `clientY`. These are relative to the
	* viewport, not the document. Add `window.scrollX/scrollY` for document-absolute coords.
	*/
	coordinates: {
		/** Horizontal distance from the left edge of the viewport, in CSS pixels. */
		x: number
		/** Vertical distance from the top edge of the viewport, in CSS pixels. */
		y: number
	}
}

/**
* Payload for events with `type === 'http'`.
*
* @remarks
* Emitted after every `fetch` or `XMLHttpRequest` call completes (successfully
* or not). The tracker patches `window.fetch` and `XMLHttpRequest.prototype.open/send`
* once at initialization; all subsequent network calls are intercepted transparently.
*
* Headers and bodies are **only** included when explicitly enabled via
* {@link HttpTrackOptions} and are always sanitized before storage:
* - Sensitive headers (`Authorization`, `Cookie`, etc.) are stripped.
* - JSON body keys matching built-in patterns (`password`, `token`, etc.)
*   are replaced with `'[REDACTED]'`.
* - Bodies are truncated to {@link HttpTrackOptions.maxBodySize} bytes after redaction.
*
* @see {@link HttpTrackOptions} for the full list of capture and redaction options.
*/
export interface HttpPayload {
	/**
	* HTTP method in uppercase.
	*
	* @example `'GET'`, `'POST'`, `'PUT'`, `'PATCH'`, `'DELETE'`
	*/
	method: string

	/**
	* Full URL of the request, including query string.
	*
	* @remarks
	* Relative URLs are resolved against `window.location.href` before storage.
	*
	* @example `'https://api.myapp.com/users?page=2'`
	*/
	url: string

	/**
	* HTTP response status code.
	*
	* @remarks
	* Absent when the request failed at the network level (no HTTP response received).
	* The tracker derives the event level from this value:
	* 5xx -> `'error'`, 4xx -> `'warn'`, 2xx/3xx -> `'info'`.
	*
	* @example `200`, `201`, `400`, `404`, `500`, `503`
	*/
	status?: number

	/**
	* Total round-trip duration in milliseconds, from request initiation to full response body received.
	*
	* @remarks
	* Measured using `performance.now()` brackets. Absent if the request threw
	* before any timing could be established.
	*
	* @example `142`, `3200`
	*/
	duration?: number

	/**
	* Network or parsing error description.
	*
	* @remarks
	* Present only when the request threw an exception before any HTTP response
	* was received (CORS failure, DNS error, timeout, etc.).
	* Mutually exclusive with `status`.
	*
	* @example `'TypeError: Failed to fetch'`, `'NetworkError: net::ERR_NAME_NOT_RESOLVED'`
	*/
	error?: string

	/**
	* Sanitized request headers.
	*
	* @remarks
	* Only present when {@link HttpTrackOptions.captureRequestHeaders} is `true`.
	* Sensitive headers (`Authorization`, `Cookie`, `X-Api-Key`, etc.) are always
	* stripped regardless of configuration. Header names are lowercased.
	*
	* @example `{ 'content-type': 'application/json', 'x-request-id': 'abc123' }`
	*/
	requestHeaders?: Record<string, string>

	/**
	* Sanitized and redacted request body.
	*
	* @remarks
	* Only present when {@link HttpTrackOptions.captureRequestBody} is `true`.
	* Pipeline: parse JSON -> redact sensitive keys -> re-serialize -> truncate to `maxBodySize`.
	* Non-JSON bodies are stored as plain strings. `ReadableStream` bodies -> `'[ReadableStream]'`.
	*/
	requestBody?: unknown

	/**
	* Byte length of the raw request body string before redaction or truncation.
	*
	* @remarks
	* Useful for spotting large payloads even when body capture is disabled.
	*/
	requestSize?: number

	/**
	* Sanitized response headers.
	*
	* @remarks
	* Only present when {@link HttpTrackOptions.captureResponseHeaders} is `true`.
	* `Set-Cookie` is always stripped to prevent credential leakage.
	*
	* @example `{ 'content-type': 'application/json', 'x-ratelimit-remaining': '42' }`
	*/
	responseHeaders?: Record<string, string>

	/**
	* Sanitized and redacted response body.
	*
	* @remarks
	* Only present when {@link HttpTrackOptions.captureResponseBody} is `true`.
	* Captured via `response.clone()` so the original `Response` is not consumed.
	* Same parse -> redact -> truncate pipeline as `requestBody`.
	*/
	responseBody?: unknown

	/**
	* Byte length of the raw response body string before redaction or truncation.
	*
	* @remarks
	* Useful for bandwidth analysis even when body capture is disabled.
	*/
	responseSize?: number
}

/**
* Payload for events with `type === 'error'`.
*
* @remarks
* Emitted by the error tracker for two categories of failures:
*
* 1. **Synchronous errors** - caught via `window.addEventListener('error', ...)`.
*    These are unhandled exceptions thrown in the main thread, including syntax
*    errors in dynamically evaluated code and resource load failures.
*
* 2. **Unhandled promise rejections** - caught via
*    `window.addEventListener('unhandledrejection', ...)`.
*    The `reason` field is inspected: if it is an `Error` instance its `message`
*    and `stack` are used; otherwise the rejection value is coerced to a string.
*
* Errors caught by application `try/catch` are **not** captured automatically.
* Use `tracker.track('error', { ... }, { level: 'error' })` for those.
*
*/
export interface ErrorPayload {
	/**
	* Human-readable description of the error.
	*
	* @remarks
	* Sourced from `ErrorEvent.message` for synchronous errors, or from
	* `event.reason.message` for promise rejections. If the rejection reason is
	* not an `Error` instance, it is coerced via `String(reason)`.
	*
	* @example `'Cannot read properties of undefined (reading "id")'`
	* @example `'ChunkLoadError: Loading chunk 12 failed'`
	*/
	message: string

	/**
	* Stack trace string as provided by the JavaScript engine.
	*
	* @remarks
	* May be absent for cross-origin errors (browser security restriction) or
	* for rejections with non-Error reasons. Stored as-is; no source-map
	* resolution is performed by the client.
	*/
	stack?: string

	/**
	* URL of the script file where the error originated.
	*
	* @remarks
	* Sourced from `ErrorEvent.filename`. Only present for synchronous errors.
	*
	* @example `'https://cdn.myapp.com/assets/index-4f3a2b.js'`
	*/
	filename?: string

	/**
	* 1-based line number in the source file where the error was thrown.
	*
	* @remarks
	* Sourced from `ErrorEvent.lineno`. Only present for synchronous errors.
	* Refers to the minified/bundled output in production builds.
	*/
	lineno?: number

	/**
	* 1-based column number in the source file where the error was thrown.
	*
	* @remarks
	* Sourced from `ErrorEvent.colno`. Only present for synchronous errors.
	*/
	colno?: number

	/**
	* Constructor name of the original error object.
	*
	* @remarks
	* Derived from `error.constructor.name`. For promise rejections where the
	* reason is not an `Error` instance, set to `'UnhandledRejection'`.
	*
	* @example `'TypeError'`, `'ReferenceError'`, `'SyntaxError'`, `'ChunkLoadError'`, `'UnhandledRejection'`
	*/
	errorType: string
}

/**
* Payload for events with `type === 'navigation'`.
*
* @remarks
* Emitted by the navigation tracker on every client-side route change.
* Four interceptors are installed at startup:
*
* 1. Monkey-patch of `history.pushState` and `history.replaceState`.
* 2. `popstate` listener - browser back/forward button presses.
* 3. `hashchange` listener - anchor-only URL changes.
* 4. A single `load` listener - initial page load event.
*
* All interceptors are removed on `TrackerClient` teardown.
*
*/
export interface NavigationPayload {
	/**
	* The URL `pathname + search` the user navigated **away from**.
	*
	* @remarks
	* For the initial `'load'` event, `from` and `to` are identical.
	* Fragment (`#hash`) is excluded.
	*
	* @example `'/products?category=shoes&page=2'`
	*/
	from: string

	/**
	* The URL `pathname + search` the user navigated **to**.
	*
	* @example `'/products/42'`
	*/
	to: string

	/**
	* The browser mechanism that triggered this navigation.
	*
	* @remarks
	* | Value           | Cause                                                   |
	* |-----------------|---------------------------------------------------------|
	* | `'pushState'`   | `history.pushState()` - typical SPA link click          |
	* | `'replaceState'`| `history.replaceState()` - silent URL rewrite            |
	* | `'popstate'`    | Browser back / forward button or `history.go()`         |
	* | `'hashchange'`  | Anchor `#fragment` change without full reload            |
	* | `'load'`        | Initial page load; `from === to`                        |
	*/
	trigger: 'pushState' | 'replaceState' | 'popstate' | 'hashchange' | 'load'

	/**
	* Milliseconds the user spent on the **previous** route.
	*
	* @remarks
	* Calculated as `Date.now() - previousNavigationTimestamp`.
	* Absent for the initial `'load'` event (no previous route exists).
	*
	* @example `4230` - user spent ~4.2 seconds on the previous page
	*/
	duration?: number
}

/**
* Payload for events with `type === 'custom'`.
*
* @remarks
* Emitted by two public API methods:
* - `tracker.track(name, data, options?)` - explicit application event.
* - `tracker.timeEnd(label, data?)` - timed operation; `duration` is populated automatically.
*
* Use for business events the automatic trackers cannot infer: form submissions,
* checkout completions, feature usage, search queries, etc.
*
* @example
* ```ts
* tracker.track('checkout:complete', { orderId: 'ORD-123', total: 49.99 })
* tracker.track('search:query', { term: 'red shoes', resultCount: 42 })
* ```
*
*/
export interface CustomPayload {
	/**
	* Caller-provided event name.
	*
	* @remarks
	* A colon-namespaced convention (`'domain:action'`) is recommended for
	* readability and filtering.
	*
	* @example `'checkout:complete'`, `'search:query'`, `'feature:toggle'`
	*/
	name: string

	/**
	* Arbitrary structured data attached by the caller.
	*
	* @remarks
	* Serialized as-is. Avoid PII or secrets - this data is stored in log files
	* and sent to the backend.
	*
	* @example `{ orderId: 'ORD-123', total: 49.99, currency: 'EUR' }`
	*/
	data: Record<string, unknown>

	/**
	* Elapsed time in milliseconds for timed operations.
	*
	* @remarks
	* Populated automatically by `tracker.timeEnd('label')` from the matching
	* `tracker.time('label')` call. Can also be set manually.
	*
	* @example `142`, `3200`
	*/
	duration?: number
}

/**
* Payload for events with `type === 'session'`.
*
* @remarks
* Automatically emitted by the tracker at key identity lifecycle moments.
* Session events form a timeline of user identity segments within the log:
* each segment starts with `action === 'start'` and ends with `action === 'end'`.
* Together they allow the dashboard and log analysis tools to reconstruct the
* complete sequence of tracked interactions for each user, from first contact
* to page close.
*
* **Emission points:**
* | Trigger          | action  | When                                                       |
* |------------------|---------|------------------------------------------------------------|
* | `'init'`         | `start` | `tracker.init()` is called (autoInit or manual)            |
* | `'userId-change'`| `end`   | `tracker.setUser()` is called : ends the previous identity |
* | `'userId-change'`| `start` | `tracker.setUser()` is called : starts the new identity    |
* | `'unload'`       | `end`   | The page is being unloaded (`beforeunload`)                |
* | `'destroy'`      | `end`   | `tracker.destroy()` is called explicitly                   |
*
* @example Reconstructing a user session from log events:
* ```
* session:start  init          userId=anon_xyz    10:00:00
* navigation     load          from=''  to=/home  10:00:00
* http           GET /api/...  200  42ms           10:00:01
* session:end    userId-change userId=anon_xyz    10:00:05  ← user logged in
* session:start  userId-change userId=user_42     10:00:05
* click          button#buy                       10:00:08
* session:end    unload        userId=user_42     10:00:12  ← page closed
* ```
*/
export interface SessionPayload {
	/**
	* Whether this marks the beginning or end of an identity segment.
	*
	* @remarks
	* Every `start` event should be paired with a subsequent `end` event for the
	* same `sessionId`. The duration of the segment can be computed as
	* `end.timestamp - start.timestamp`.
	*/
	action: 'start' | 'end'

	/**
	* The event that caused this session boundary to be emitted.
	*
	* @remarks
	* | Value            | Description                                                    |
	* |------------------|----------------------------------------------------------------|
	* | `'init'`         | `tracker.init()` was called : first start of the session.      |
	* | `'userId-change'`| `tracker.setUser()` changed the active identity.               |
	* | `'unload'`       | The browser fired `beforeunload` : page is being navigated away.|
	* | `'destroy'`      | `tracker.destroy()` was called explicitly by the application.  |
	*/
	trigger: 'init' | 'userId-change' | 'unload' | 'destroy'

	/**
	* The `userId` that is ending its segment.
	*
	* @remarks
	* Only present on `action === 'end'` events caused by `trigger === 'userId-change'`.
	* Allows correlating the closing segment with its earlier `session:start` event.
	*
	* @example `'anon_xyz'`, `'user_42'`
	*/
	previousUserId?: string

	/**
	* The `userId` that is opening a new segment.
	*
	* @remarks
	* Only present on `action === 'start'` events caused by `trigger === 'userId-change'`.
	* Mirrors the `userId` field on the event envelope for convenience.
	*
	* @example `'user_42'`, `'anon_newxyz'`
	*/
	newUserId?: string
}

/**
* All `console` methods that the tracker can intercept and capture.
*
* @remarks
* Passed to {@link ConsoleTrackOptions.methods} to restrict capture to a
* subset of methods. When not specified, all 19 methods are intercepted.
*
* The tracker wraps each method by replacing `console[method]` with a proxy
* that calls the original implementation first (so browser devtools still
* receives the output) and then emits a tracked event.
*
*/
export type ConsoleMethod =
	| 'log'
	| 'warn'
	| 'error'
	| 'debug'
	| 'info'
	| 'trace'
	| 'table'
	| 'group'
	| 'groupCollapsed'
	| 'groupEnd'
	| 'count'
	| 'countReset'
	| 'time'
	| 'timeEnd'
	| 'timeLog'
	| 'assert'
	| 'dir'
	| 'dirxml'
	| 'clear'

/**
* Payload for events with `type === 'console'`.
*
* @remarks
* Emitted once per intercepted `console.*` call. The original call is
* **always forwarded** to the real browser console - the tracker only
* observes, never suppresses.
*
* `console.assert` is handled specially: calls where the condition is `true`
* are ignored; only failing assertions produce an event, and the boolean
* first argument is removed from `args`.
*
* @see {@link ConsoleTrackOptions}
*/
export interface ConsolePayload {
	/**
	* The `console` method that was called.
	*
	* @example `'warn'`, `'error'`, `'group'`, `'table'`
	*/
	method: ConsoleMethod

	/**
	* Human-readable summary derived from the first argument.
	*
	* @remarks
	* Resolution rules (in order):
	* 1. String first arg -> used directly, truncated to `maxArgLength`.
	* 2. Non-string primitive -> coerced to string.
	* 3. Object/array -> brief type descriptor, e.g. `'[Object]'`, `'[Array(3)]'`.
	* 4. `console.assert(false, msg)` -> assertion message (second arg), not the boolean.
	*
	* Indexed by the backend for full-text search.
	*/
	message: string

	/**
	* All arguments passed to the console call, each safely serialized.
	*
	* @remarks
	* Serialization is defensive:
	* - Circular references -> `'[Circular]'`
	* - DOM nodes -> `'[HTMLDivElement]'`
	* - Functions -> `'[Function: name]'`
	* - Symbols -> `'[Symbol(description)]'`
	* - BigInt -> `'[BigInt: 12345n]'`
	*
	* Capped to {@link ConsoleTrackOptions.maxArgs} entries. If exceeded, the
	* last element becomes `{ type: 'truncated', value: '[N more args]' }`.
	*
	* @see {@link SerializedArg}
	*/
	args: SerializedArg[]

	/**
	* Call-site stack trace.
	*
	* @remarks
	* Present for `console.trace` (always) and for `console.error` when
	* {@link ConsoleTrackOptions.captureStackOnError} is `true`. Generated via
	* `new Error().stack`; the first two wrapper frames are stripped.
	*/
	stack?: string

	/**
	* Nesting depth of `console.group()` / `console.groupCollapsed()` calls
	* at the moment this event was emitted.
	*
	* @remarks
	* `0` = top level. Increments on `group`/`groupCollapsed`, decrements on
	* `groupEnd`, clamped to `0` to handle unbalanced calls.
	* Used in the dashboard to visually indent grouped log entries.
	*/
	groupDepth: number
}

/**
* A single safely-serialized argument from a `console.*` call.
*
* @remarks
* Each element in {@link ConsolePayload.args} is one `SerializedArg`.
* The `type` / `value` split allows the dashboard to apply type-specific
* rendering without re-parsing the value.
*
*/
export interface SerializedArg {
	/**
	* Human-readable label describing the JavaScript type of the original value.
	*
	* @remarks
	* Primitives use `typeof`. Objects use the constructor name (`'Array'`, `'Date'`,
	* `'Map'`, `'Error'`, etc.) or the DOM element tag (`'HTMLButtonElement'`).
	*
	* Special sentinels: `'null'`, `'undefined'`, `'[Circular]'`, `'[Function]'`,
	* `'[Symbol]'`, `'[BigInt]'`.
	*
	* @example `'string'`, `'number'`, `'Array'`, `'Error'`, `'HTMLDivElement'`
	*/
	type: string

	/**
	* Serialized representation of the original value.
	*
	* @remarks
	* Primitives are stored as-is. Objects/arrays are JSON-stringified with
	* circular reference protection, truncated to `maxArgLength`. DOM nodes and
	* functions are stored as their sentinel string.
	*/
	value: unknown
}

/**
* Browser and environment metadata captured once per event at emission time.
*
* @remarks
* Attached to every {@link TrackerEvent} regardless of type. All fields are
* read synchronously at emission to guarantee they reflect the exact browser
* state when the event occurred.
*
*/
export interface EventMeta {
	/**
	* Full `navigator.userAgent` string of the browser.
	*
	* @remarks
	* Stored as-is for maximum compatibility with server-side UA parsing libraries.
	* Modern browsers may return a reduced UA string if User-Agent Client Hints is active.
	*
	* @example `'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ... Chrome/123.0.0.0'`
	*/
	userAgent: string

	/**
	* URL `pathname + search` at the moment the event was emitted.
	*
	* @remarks
	* Captured via `location.pathname + location.search`. Fragment (`#hash`) excluded.
	* For SPAs, reflects the current virtual route.
	*
	* @example `'/dashboard?tab=metrics'`, `'/products/42'`
	*/
	route: string

	/**
	* Viewport dimensions as `'<width>x<height>'` in CSS pixels.
	*
	* @remarks
	* Sourced from `window.innerWidth` × `window.innerHeight` at emission time.
	*
	* @example `'1440x900'`, `'390x844'` (iPhone 14)
	*/
	viewport: string

	/**
	* Browser UI language tag from `navigator.language`.
	*
	* @remarks
	* Follows BCP 47 format. Useful for locale-specific UX analysis.
	*
	* @example `'en-US'`, `'it-IT'`, `'de-DE'`
	*/
	language: string

	/**
	* `document.referrer` captured at event emission time.
	*
	* @remarks
	* Empty string if navigated directly (typed URL, bookmark, `no-referrer` policy).
	* Cross-origin referrers may be stripped to the origin by the browser.
	*
	* @example `'https://google.com/'`, `''`
	*/
	referrer?: string

	/**
	* Application build version string injected at build time.
	*
	* @remarks
	* Sourced from `package.json` version or a custom string. Useful for
	* correlating event spikes to specific deployments.
	*
	* @example `'1.4.2'`, `'2024-03-15-abc123f'`
	*/
	buildVersion?: string

	/**
	* Arbitrary user attributes set via `tracker.setUser(id, { attributes })`.
	*
	* @remarks
	* Attached to every event after the call until `tracker.setUser(null)` clears them.
	* Do not include PII or sensitive data.
	*
	* @example `{ plan: 'pro', role: 'admin', orgId: 'org_123' }`
	*/
	userAttributes?: Record<string, unknown>
}

// INFO Plugin options (vite.config.ts)

/**
* Options accepted by `tracker.track(name, data, options?)`.
*
* @remarks
* All fields are optional and affect only the single event being tracked.
* Persistent state (userId, context) is managed via `setUser` / `setContext`.
*
* @example
* ```ts
* tracker.track('payment:failed', { code: 'INSUFFICIENT_FUNDS' }, {
*   level:   'error',
*   groupId: checkoutGroupId,
*   context: { retryAttempt: 2 },
* })
* ```
*
*/
export interface TrackEventOptions {
	/**
	* Override the default log level for this specific event.
	*
	* @remarks
	* Use `'warn'` or `'error'` to elevate events that represent degraded states
	* without raising an actual JavaScript exception.
	*
	* @default 'info'
	*/
	level?: LogLevel

	/**
	* Associate this event with an active group started by `tracker.group()`.
	*
	* @remarks
	* Pass the UUID returned by `tracker.group('label')`. Multiple events sharing
	* the same `groupId` can be queried together via {@link EventsQuery.groupId}.
	*/
	groupId?: string

	/**
	* One-off key-value pairs merged into this single event's context only.
	*
	* @remarks
	* Merged on top of the persistent context set by `tracker.setContext()` for
	* this event only. Does not modify persistent context.
	* Per-event keys take precedence over persistent keys on conflict.
	*/
	context?: Record<string, unknown>
}

/**
* Options accepted by `tracker.setUser(id, options?)`.
*
* @remarks
* Call `tracker.setUser(id, options)` after login to attach identity to events.
* Call `tracker.setUser(null)` after logout to revert to anonymous tracking.
*
* @example
* ```ts
* tracker.setUser('user_42', { attributes: { plan: 'enterprise', orgId: 'org_7' } })
* tracker.setUser(null)  // logout
* ```
*
*/
export interface SetUserOptions {
	/**
	* Key-value pairs attached to {@link EventMeta.userAttributes} on every
	* subsequent event until `tracker.setUser(null)` is called.
	*
	* @remarks
	* Overwritten entirely on each `setUser` call - no deep merge with previous attributes.
	* Keep values serializable (no class instances, DOM nodes, or functions).
	*
	* @example `{ plan: 'enterprise', role: 'admin', orgId: 'org_42', locale: 'it-IT' }`
	*/
	attributes?: Record<string, unknown>
}

/**
* Determines where events are stored and how they are served to the dashboard.
*
* @remarks
* | Mode           | When to use                                                                                   | Requires         |
* |----------------|-----------------------------------------------------------------------------------------------|------------------|
* | `'http'`       | Production - POSTs to an external backend                                                     | `writeEndpoint`  |
* | `'standalone'` | Dev/preview - dedicated port, file logging, no backend. It's a specification of http mode.    | Nothing extra    |
* | `'middleware'` | Dev/preview - API on the same Vite dev server port                                            | Nothing extra    |
* | `'websocket'`  | Production/Dev - bidirectional via WebSocket                                                  | `wsEndpoint`     |
* | `'auto'`       | Default - `middleware` in dev, enforces `http` at build                                       | Depends          |
*
* In `'auto'` mode, the plugin expands to `'middleware'` when `vite dev` or
* `vite preview` is running, and throws a build error if `writeEndpoint` is
* not set when `vite build` runs.
*
* @default 'auto'
*/
export type StorageMode = 'http' | 'standalone' | 'middleware' | 'websocket' | 'auto'

/**
* HTTP transport configuration - used when `mode` is `'http'`, `'standalone'`,
* `'middleware'`, or `'auto'`.
*/
export interface HttpStorageOptions {
	/**
	* Storage backend to use.
	*
	* @see {@link StorageMode}
	* @default 'auto'
	*/
	mode?: Exclude<StorageMode, 'websocket'>

	/**
	* URL that receives batched events from the browser via HTTP POST.
	*
	* @remarks
	* **Request** (browser -> server):
	* - Method: `POST`
	* - Content-Type: `application/json`
	* - Header: `X-Tracker-Key: <apiKey>` (only when `apiKey` is configured)
	* - Body: `{ "events": TrackerEvent[] }`  - see {@link IngestRequest}
	*
	* **Response** (server -> browser):
	* - Any `2xx` status is treated as success - the response body is ignored.
	* - Non-`2xx` responses cause the batch to be requeued and retried on the
	*   next flush interval.
	*
	* @example `'https://api.myapp.com/monitor/events'`, `'/api/tracking/ingest'`
	*/
	writeEndpoint?: string

	/**
	* Full URL of the event reading endpoint queried by the dashboard.
	*
	* @remarks
	* **Request** (dashboard -> server):
	* ```
	* GET <readEndpoint>?since=<ISO8601>&until=<ISO8601>
	* Accept: application/json
	* X-Tracker-Key: <apiKey> (optional, only if configured)
	* ```
	*
	* The dashboard **always** sends `since` and `until` as ISO 8601 UTC query
	* parameters matching the time range selected by the user. Your server
	* **must** honour these parameters and return only events whose `timestamp`
	* falls within `[since, until]`, sorted from newest to oldest, in the
	* {@link EventsResponse} format.
	*
	* All further filtering (type, level, userId, full-text search) and all
	* aggregations (charts, KPI cards, top lists) are performed client-side in
	* the browser after receiving the time-windowed dataset, so your server does
	* not need to implement any additional query logic beyond the time range.
	*
	* @example `'https://api.myapp.com/tracker/events'`
	*/
	readEndpoint?: string

	/**
	* Optional URL used by the dashboard health check.
	*
	* @remarks
	* When provided, the dashboard polls this URL periodically to verify
	* backend reachability and shows an online/offline indicator in the header.
	* When omitted, no health check is performed and the backend is assumed online.
	*
	* @example `'https://api.myapp.com/ping'`, `'https://api.myapp.com/health'`
	*/
	pingEndpoint?: string

	/**
	* API key sent as `X-Tracker-Key` on every request (write and read).
	*
	* @remarks
	* Omit to disable authentication - suitable for local development only.
	*/
	apiKey?: string

	/**
	* TCP port for the built-in standalone HTTP server.
	*
	* @remarks
	* Only used when `mode = 'standalone'`. The plugin warns and skips if the
	* port is in use (`EADDRINUSE`).
	*
	* @default 4242
	*/
	port?: number

	/**
	* Maximum number of events accumulated client-side before flushing.
	*
	* @remarks
	* The queue flushes when `batchSize` **or** `flushInterval` is reached first.
	* On page unload, remaining events are flushed via `navigator.sendBeacon`.
	*
	* @default 25
	*/
	batchSize?: number

	/**
	* Maximum time in milliseconds between automatic queue flushes.
	*
	* @remarks
	* Timer resets on each flush. The 3 000 ms default stays well within the
	* 30-second ingress timeout common in Kubernetes / OpenShift environments.
	*
	* @default 3000
	*/
	flushInterval?: number

	/**
	* Maximum number of events kept in the server-side in-memory ring buffer.
	*
	* @remarks
	* Only used when `mode = 'standalone'` or `mode = 'middleware'`. The ring
	* buffer holds the most recent events in memory so the dashboard can query
	* them without reading log files on every request. When the buffer exceeds
	* this limit, the oldest events are evicted automatically (FIFO).
	*
	* Because the dashboard now always queries the buffer with a `since`/`until`
	* time window, the buffer only needs to hold events for the widest time range
	* your users are likely to inspect (e.g. the last 30 days at typical traffic).
	* Raising this value increases memory usage on the Node.js process linearly.
	*
	* @default 500000
	*/
	maxBufferSize?: number
}

/**
* WebSocket transport configuration - used when `mode = 'websocket'`.
*
* @remarks
* Mutually exclusive with `writeEndpoint` and `readEndpoint`.
* All event ingestion and dashboard queries happen over the single persistent
* WebSocket connection. The consumer backend must implement the tracker
* WebSocket protocol:
*
* Browser -> Server (ingest):
* ```json
* { "type": "ingest", "events": TrackerEvent[] }
* ```
* Server -> Browser (ack):
* ```json
* { "type": "ack", "saved": number }
* ```
* Server -> Browser (real-time push, optional):
* ```json
* { "type": "push", "events": TrackerEvent[] }
* ```
* Dashboard -> Server (query):
* ```json
* { "type": "events:query", "reqId": string, "query": { "since": string, "until": string } }
* ```
* The `query` object always contains `since` and `until` as ISO 8601 UTC strings
* matching the time range selected by the user. Your server **must** return only
* events whose `timestamp` falls within `[since, until]`. All further filtering
* and aggregations are performed client-side.
*
* Server -> Browser (query response):
* ```json
* { "type": "events:response", "reqId": string, "response": EventsResponse }
* ```
*/
export interface WsStorageOptions {
	mode: 'websocket'

	/**
	* WebSocket endpoint URL.
	*
	* @example `'wss://api.myapp.com/tracker/ws'`
	*/
	wsEndpoint: string

	/**
	* Optional URL used by the dashboard health check.
	*
	* @remarks
	* When provided, the dashboard polls this URL periodically to verify
	* backend reachability and shows an online/offline indicator in the header.
	* When omitted, no health check is performed and the backend is assumed online.
	*
	* @example `'https://api.myapp.com/ping'`, `'https://api.myapp.com/health'`
	*/
	pingEndpoint?: string

	/**
	* API key sent as `X-Tracker-Key` on every request.
	*
	* @remarks
	* Omit to disable authentication - suitable for local development only.
	*/
	apiKey?: string

	/**
	* Maximum number of events accumulated client-side before flushing.
	*
	* @default 25
	*/
	batchSize?: number

	/**
	* Maximum time in milliseconds between automatic queue flushes.
	*
	* @default 3000
	*/
	flushInterval?: number
}

/**
* Configuration for the event storage and transport layer.
*
* @remarks
* Use {@link HttpStorageOptions} for HTTP/standalone/middleware modes.
* Use {@link WsStorageOptions} for WebSocket mode. The two are mutually
* exclusive - TypeScript enforces this via the discriminated union.
*
* @see {@link StorageMode}
*/
export type StorageOptions = HttpStorageOptions | WsStorageOptions

/**
* Top-level options passed to `trackerPlugin(options)` in `vite.config.ts`.
*
* @remarks
* Only `appId` is required. All other groups have opinionated defaults that
* work out of the box for local development.
*
* @example
* ```ts
* // vite.config.ts
* import { trackerPlugin } from 'vite-plugin-monitor'
*
* export default defineConfig({
*   plugins: [
*     trackerPlugin({
*       appId:   'my-app',
*       storage: { mode: 'http', writeEndpoint: '/api/monitor/events' },
*       track:   { console: { methods: ['error', 'warn'] } },
*     }),
*   ],
* })
* ```
*
*/
export interface TrackerPluginOptions {
	/**
	* Master switch for the plugin.
	*
	* @remarks
	* When `false`, the plugin is completely disabled - no script is injected
	* into `index.html`, no server or middleware is started, no log files are
	* created, and no events are tracked. Useful for disabling tracking in
	* specific environments (e.g. local development, CI) without removing the
	* plugin from `vite.config.ts`.
	*
	* @default `true`
	*/
	enabled?: boolean

	/**
	* Unique identifier for this application instance.
	*
	* @remarks
	* Attached to every event as {@link TrackerEvent.appId}. Allows a single
	* backend to handle events from multiple apps without namespace collisions.
	* The plugin throws a configuration error at startup if this is missing or empty.
	*
	* @example `'storefront'`, `'admin-panel'`, `'checkout-service'`
	*/
	appId: string

	/**
	* Fine-grained control over which browser interactions are tracked and how.
	*
	* @see {@link TrackOptions}
	*/
	track?: TrackOptions

	/**
	* Configuration for the event storage backend and transport parameters.
	*
	* @see {@link StorageOptions}
	*/
	storage?: StorageOptions

	/**
	* Server-side log file configuration (transports, rotation, minimum level).
	*
	* @see {@link LoggingOptions}
	*/
	logging?: LoggingOptions

	/**
	* Configuration for the built-in dashboard SPA.
	*
	* @see {@link DashboardOptions}
	*/
	dashboard?: DashboardOptions

	/**
	* Configuration for the floating debug overlay widget.
	*
	* @see {@link OverlayOptions}
	*/
	overlay?: OverlayOptions

	/**
	* Whether to automatically initialize the tracker by injecting the client
	* script into index.html.
	*
	* @remarks
	* When `true` (default), the plugin injects both the setup script (which
	* installs event proxies immediately) and the init script (which activates
	* the queue and starts flushing events). The tracker is fully active from
	* the very first line of application code.
	*
	* When `false`, the plugin still injects the setup script that installs
	* event proxies before any application code runs, but does not call
	* `tracker.init()` automatically. The consumer is responsible for calling
	* it at the appropriate point in the application lifecycle:
	*
	* ```ts
	* import { tracker } from 'vite-plugin-monitor/client'
	* tracker.init()
	* ```
	*
	* Use `false` when you need to delay initialization - for example after a
	* user consent dialog, after authentication, or only in specific environments.
	*
	* @default `true`
	*/
	autoInit?: boolean
}

/**
* Fine-grained control over which browser interactions are tracked.
*
* @remarks
* All automatic trackers except `console` are **enabled by default** (`true`).
* `console` is opt-in (`false`) to avoid capturing sensitive debug output
* from codebases that haven't reviewed their logs. Set any field to `false`
* to disable that tracker entirely - disabled trackers have zero runtime overhead.
*
*/
export interface TrackOptions {
	/**
	* Enable or disable click tracking.
	*
	* @remarks
	* Adds a single passive `click` listener to `document` via event delegation.
	*
	* @default false
	*/
	clicks?: boolean

	/**
	* Enable HTTP request tracking, with optional fine-grained capture settings.
	*
	* @remarks
	* - `true` - track method, URL, status, duration. No headers or bodies.
	* - `false` - disable entirely.
	* - {@link HttpTrackOptions} - full control over capture and redaction.
	*
	* @default false
	*/
	http?: boolean | HttpTrackOptions

	/**
	* Enable unhandled JavaScript error tracking.
	*
	* @remarks
	* Captures `window.onerror` (synchronous) and `unhandledrejection` (promise).
	* Errors caught by `try/catch` are not captured automatically.
	*
	* @default false
	*/
	errors?: boolean

	/**
	* Enable client-side navigation tracking.
	*
	* @remarks
	* Intercepts `history.pushState`, `history.replaceState`, `popstate`,
	* `hashchange`, and the initial `load` event. Compatible with all major
	* SPA routers.
	*
	* @default false
	*/
	navigation?: boolean

	/**
	* Enable console method interception.
	*
	* @remarks
	* - `true` - intercept all 19 methods with safe defaults (default).
	* - `false` - disabled. No methods are patched.
	* - {@link ConsoleTrackOptions} - restrict methods, tune limits, configure stacks.
	*
	* Enabled by default. Consider setting this to `false` or restricting to
	* `['error', 'warn']` if your codebase logs sensitive data that should not
	* be sent to the backend.
	*
	* @default true
	*/
	console?: boolean | ConsoleTrackOptions

	/**
	* Function that resolves the current user's identifier at tracker initialization.
	*
	* @remarks
	* Called once during tracker initialization to resolve the initial user identifier.
	* To update the user after initialization, use {@link ITrackerClient.setUser}.
	*
	* @example
	* ```ts
	* userId: () => useAuthStore().userId ?? null
	* userId: () => document.cookie.match(/uid=([^;]+)/)?.[1] ?? null
	* ```
	*/
	userId?: () => string | null

	/**
	* Minimum log level for events emitted by automatic trackers.
	*
	* @remarks
	* Events below this threshold are discarded before being enqueued.
	* Does not affect custom events from `tracker.track()`.
	*
	* @default 'info'
	*/
	level?: LogLevel

	/**
	* URL substrings that disable HTTP tracking for matching requests.
	*
	* @remarks
	* Case-sensitive substring match against the full absolute URL.
	* Applied before any capture or redaction logic.
	*
	* @default []
	* @example `['/_dashboard', '/health', '/ping', 'analytics.google.com']`
	*/
	ignoreUrls?: string[]
}

/**
* Fine-grained control over `console` method interception.
*
* @remarks
* Used when `track.console` is an object. All fields are optional with
* conservative defaults safe for production use.
*
*/
export interface ConsoleTrackOptions {
	/**
	* Subset of console methods to intercept.
	*
	* @remarks
	* Methods not listed are not patched and incur zero overhead.
	*
	* @default All 19 methods (see {@link ConsoleMethod})
	* @example `['error', 'warn']`
	*/
	methods?: ConsoleMethod[]

	/**
	* Maximum character length for a single serialized argument value.
	*
	* @remarks
	* Values exceeding this limit are truncated and appended with
	* `'... [N chars omitted]'`.
	*
	* @default 1024
	*/
	maxArgLength?: number

	/**
	* Maximum number of arguments captured per console call.
	*
	* @remarks
	* Arguments beyond this limit are replaced with a single
	* `{ type: 'truncated', value: '[N more args]' }` sentinel.
	*
	* @default 10
	*/
	maxArgs?: number

	/**
	* Capture a stack trace for `console.error` calls.
	*
	* @remarks
	* `console.trace` always produces a stack regardless of this flag.
	* Disabled by default because `new Error().stack` is expensive in hot paths.
	*
	* @default false
	*/
	captureStackOnError?: boolean

	/**
	* Substring patterns; console calls whose first argument contains any of them are ignored.
	*
	* @remarks
	* Applied before serialization - zero overhead for ignored calls.
	* Case-sensitive.
	*
	* @default `['[vite]', '[HMR]', '[tracker]']`
	* @example `['[vite]', '[HMR]', '[tracker]', 'Stripe.js']`
	*/
	ignorePatterns?: string[]
}

/**
* Fine-grained control over HTTP request/response capture and redaction.
*
* @remarks
* ### Security guarantees (always active, regardless of config)
* - Sensitive headers (`Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key`, etc.) are always stripped.
* - JSON keys matching built-in patterns (`password`, `token`, `secret`, `card`, `cvv`, `iban`, etc.)
*   are always replaced with `'[REDACTED]'` recursively.
* - Bodies are always truncated to `maxBodySize` after redaction.
*
* All flags default to `false` to minimize data exposure without explicit opt-in.
*
*/
export interface HttpTrackOptions {
	/**
	* Capture sanitized request headers.
	*
	* @remarks
	* Sensitive headers are always stripped (see security guarantees).
	* Header names are lowercased. Useful for capturing `X-Request-ID`,
	* `X-Trace-ID`, `Accept-Language`, etc.
	*
	* @default false
	*/
	captureRequestHeaders?: boolean

	/**
	* Capture and redact the request body.
	*
	* @remarks
	* Pipeline: read raw body -> parse JSON -> redact sensitive keys -> re-serialize
	* -> truncate to `maxBodySize`. `ReadableStream` bodies -> `'[ReadableStream]'`.
	*
	* @default false
	*/
	captureRequestBody?: boolean

	/**
	* Capture sanitized response headers.
	*
	* @remarks
	* `Set-Cookie` is always stripped. Same stripping rules as request headers.
	*
	* @default false
	*/
	captureResponseHeaders?: boolean

	/**
	* Capture and redact the response body.
	*
	* @remarks
	* Captured via `response.clone()` - the original `Response` is not consumed.
	* Same pipeline as request body. Note that cloning large responses (file
	* downloads, big datasets) increases memory pressure.
	*
	* @default false
	*/
	captureResponseBody?: boolean

	/**
	* Additional header names to strip, beyond the built-in sensitive list.
	*
	* @remarks
	* Case-insensitive. Cannot un-redact a built-in sensitive header.
	*
	* @example `['x-internal-request-id', 'x-company-trace']`
	*/
	excludeHeaders?: string[]

	/**
	* Additional JSON body key patterns to redact, beyond the built-in list.
	*
	* @remarks
	* Case-insensitive substring match - `'fiscal'` redacts `'fiscalCode'` and
	* `'fiscalNumber'`. Applied recursively to nested objects and arrays.
	*
	* @example `['fiscalCode', 'vatNumber', 'nationalId']`
	*/
	redactKeys?: string[]

	/**
	* Maximum byte length of the stored body after redaction and re-serialization.
	*
	* @remarks
	* Bodies exceeding this limit are truncated with `' ... [N bytes omitted]'`.
	* Set to `0` to disable truncation (not recommended for production).
	*
	* @default 2048
	*/
	maxBodySize?: number
}

/**
* Server-side log file output configuration.
*
* @remarks
* Log writing is performed in a dedicated worker thread (`logger-worker.ts`)
* to avoid blocking the main plugin thread on I/O. Streams are opened lazily
* on the first write and flushed on process shutdown.
*
*/
export interface LoggingOptions {
	/**
	* Minimum severity level for events written to any log transport.
	*
	* @remarks
	* Independent of `track.level` (client-side). Affects only server-side file output.
	*
	* @default 'info'
	*/
	level?: LogLevel

	/**
	* List of file output targets.
	*
	* @remarks
	* Each transport is an independent write stream. Multiple transports can run
	* simultaneously (e.g. JSONL for machines, pretty for humans).
	*
	* @default `[{ format: 'json', path: './logs/<appId>.log', rotation: { strategy: 'daily', maxFiles: 30 } }]`
	*/
	transports?: LogTransport[]
}

/**
* Configuration for a single log file output target.
*
* @remarks
* Each `LogTransport` owns an independent `fs.WriteStream` in the logger worker.
* Rotation is handled inline at write time - no cron job or file watcher needed.
*
*/
export interface LogTransport {
	/**
	* Format used for each line written to this transport.
	*
	* @remarks
	* | Format    | Description                                                      |
	* |-----------|------------------------------------------------------------------|
	* | `'json'`  | One JSON-stringified {@link TrackerEvent} per line (JSONL).      |
	* |           | Machine-readable; used by standalone server to replay on restart.|
	* | `'pretty'`| Human-readable aligned columns. Not machine-parseable.           |
	*/
	format: 'json' | 'pretty'

	/**
	* Absolute or CWD-relative path to the log file.
	*
	* @remarks
	* Parent directory is created recursively if absent. For `'daily'` rotation,
	* a date suffix is inserted before the extension:
	* `./logs/monitor.log` -> `./logs/monitor-2024-03-15.log`
	*
	* @example `'./logs/monitor.jsonl'`, `'/var/log/myapp/monitor.log'`
	*/
	path: string

	/**
	* File rotation policy. Omit to let the file grow indefinitely.
	*
	* @see {@link RotationOptions}
	*/
	rotation?: RotationOptions
}

/**
* Log file rotation policy for a {@link LogTransport}.
*
* @remarks
* Rotation is checked lazily on each write - no background timers needed.
* All fs operations (rename, stat, readdir, unlink) run synchronously in the
* logger worker thread to maintain write ordering.
*
*/
export interface RotationOptions {
	/**
	* Trigger condition for rotating the active log file.
	*
	* @remarks
	* | Strategy | Trigger                                                            |
	* |----------|--------------------------------------------------------------------|
	* | `'daily'`| First write after UTC midnight. New file opened with date suffix.  |
	* |          | Lazy - if no events arrive after midnight, rotation is deferred.   |
	* | `'size'` | First write that would exceed `maxSize`. Current file is archived. |
	*/
	strategy: 'daily' | 'size'

	/**
	* Maximum file size threshold for the `'size'` rotation strategy.
	*
	* @remarks
	* Human-readable string with optional SI suffix. Only used when `strategy = 'size'`.
	*
	* @default '10mb'
	* @example `'500kb'`, `'10mb'`, `'1gb'`
	*/
	maxSize?: string

	/**
	* Maximum number of rotated archive files to retain on disk.
	*
	* @remarks
	* After each rotation, the oldest archives are deleted until the count is
	* at or below this limit. The active file is never counted or deleted.
	*
	* @default 30
	*/
	maxFiles?: number

	/**
	* Reserved for future gzip compression of rotated archives.
	*
	* @remarks
	* Currently has **no effect**. Will compress rotated files to `.gz` when implemented.
	*
	* @default false
	*/
	compress?: boolean
}

/**
* Configuration for the built-in dashboard SPA.
*
* @remarks
* The dashboard is a Shadow DOM–isolated Vanilla TypeScript SPA bundled
* separately. In dev/preview it is served by Vite or the standalone server.
* In production it is included only when `includeInBuild: true`.
*
*/
export interface DashboardOptions {
	/**
	* Master switch for the dashboard.
	*
	* @remarks
	* When `false`, no route is registered, no HTML is injected, and no
	* dashboard JavaScript is bundled. The tracker client still functions normally.
	*
	* @default false
	*/
	enabled?: boolean

	/**
	* URL path at which the dashboard is mounted.
	*
	* @remarks
	* Must start with `/`. Should not conflict with existing application routes.
	* In production builds, the router or reverse proxy must serve the dashboard
	* entry HTML at this path.
	*
	* @default '/_dashboard'
	*/
	route?: string

	/**
	* Basic authentication credentials for the dashboard login gate.
	*
	* @remarks
	* Validated client-side via `sessionStorage`. Suitable for dev/staging friction,
	* not for production security. For production, protect the route at the proxy level.
	*
	* @default `false`
	*/
	auth?: { username: string; password: string } | false

	/**
	* Bundle the dashboard SPA into the production build output.
	*
	* @remarks
	* When `false` (default), the dashboard is excluded from `vite build` to keep
	* the production bundle lean. Requires `storage.readEndpoint` when `true`.
	*
	* @default false
	*/
	includeInBuild?: boolean

	/**
	* Polling interval in milliseconds between dashboard data refresh requests.
	*
	* @remarks
	* Uses `setTimeout`-based polling to avoid pileup on slow backends. The 3 000 ms
	* default stays well within the 30-second ingress timeout of OpenShift / Kubernetes.
	*
	* @default 3000
	*/
	pollInterval?: number
}

/**
* Configuration for the floating debug overlay widget.
*
* @remarks
* The overlay is a Shadow DOM–isolated widget showing session identity
* (userId, sessionId, appId), browser context (route, viewport, language,
* connection), and a link to the dashboard. Only mounted in dev/preview
* unless explicitly enabled in production.
*
*/
export interface OverlayOptions {
	/**
	* Show or hide the overlay widget.
	*
	* @remarks
	* Defaults to `true` in dev/preview and `false` in production builds.
	* Must be explicitly set to `true` to appear in production - intentional
	* friction to prevent accidental exposure.
	*
	* @default false in dev/preview, false in production build
	*/
	enabled?: boolean

	/**
	* Corner of the viewport where the overlay FAB button is anchored.
	*
	* @remarks
	* The panel expands inward so it never overflows the viewport. Choose a
	* corner that does not conflict with the app's own fixed-position UI elements.
	*
	* @default 'bottom-right'
	*/
	position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
}

// INFO Public client API

/**
* Public contract of the tracker client.
*
* @remarks
* Implemented by `TrackerClient`. Exposed as an interface so consumers
* can mock or extend the tracker in tests without depending on the concrete class.
*
* All methods are safe to call before `tracker.init()` via the {@link tracker}
* proxy object - calls are silently dropped if the instance is not yet available.
*
*/
export interface ITrackerClient {
	/**
	* Track a named custom event with optional data and options.
	*
	* @param name - Event name. Recommend `domain:action` convention.
	* @param data - Arbitrary structured data attached to the event.
	* @param opts - Level, groupId, and one-off context overrides.
	*
	* @example
	* tracker.track('purchase', { orderId: 'ORD-123', amount: 99.99 })
	* tracker.track('form:submit', { form: 'signup' }, { level: 'warn', groupId: flowId })
	*/
	track(name: string, data?: Record<string, unknown>, opts?: TrackEventOptions): void

	/**
	* Start a named performance timer.
	* Call `timeEnd()` with the same label to record the elapsed duration.
	* Multiple concurrent timers with different labels are supported.
	*
	* @param label - Unique identifier for this timer.
	*
	* @example
	* tracker.time('api:fetchCart')
	* const cart = await fetchCart()
	* tracker.timeEnd('api:fetchCart', { itemCount: cart.items.length })
	*/
	time(label: string): void

	/**
	* Stop a named timer and emit a custom event with the measured duration.
	* If the label was never started, logs a warning and returns -1.
	*
	* @param label - Same string passed to `time()`.
	* @param data  - Additional data to attach to the event.
	* @param opts  - Level, groupId, context overrides.
	* @returns Elapsed time in milliseconds, or -1 if the timer was not found.
	*
	* @example
	* tracker.timeEnd('api:fetchCart', { itemCount: 3 }) // -> emits with duration: 312
	*/
	timeEnd(label: string, data?: Record<string, unknown>, opts?: TrackEventOptions): number

	/**
	* Update the current user identity and optional profile attributes.
	* All subsequent events will carry the new `userId` and `userAttributes`.
	* Pass `null` to revert to an anonymous session-scoped ID.
	*
	* @param userId - New user identifier, or `null` to clear.
	* @param opts   - Optional user attributes to attach to subsequent events.
	*
	* @example
	* tracker.setUser('user-456', { attributes: { plan: 'pro', company: 'Acme' } })
	* tracker.setUser(null) // after logout
	*/
	setUser(userId: string | null, opts?: SetUserOptions): void

	/**
	* Set or update persistent context attributes merged into every subsequent event.
	* Pass `null` as a value to remove a specific key from the context.
	*
	* @param attrs - Key-value pairs to merge into the persistent context.
	*
	* @example
	* tracker.setContext({ tenant: 'acme', abTest: 'checkout-v2' })
	* tracker.setContext({ abTest: null }) // removes abTest key
	*/
	setContext(attrs: Record<string, unknown>): void

	/**
	* Generate a unique group ID to correlate related events in the dashboard.
	* Pass the returned ID as `groupId` in subsequent `track()` calls.
	*
	* @param name - Descriptive label for the group (used as part of the ID).
	* @returns A unique group ID string.
	*
	* @example
	* const checkoutId = tracker.group('checkout')
	* tracker.track('step:address', {}, { groupId: checkoutId })
	* tracker.track('step:payment', {}, { groupId: checkoutId })
	*/
	group(name: string): string

	/**
	* Tear down the tracker instance.
	*
	* @remarks
	* Removes all event listeners registered by the automatic trackers,
	* destroys the overlay widget, clears all active timers, and flushes
	* any remaining queued events to the backend.
	*
	* After calling `destroy()`, the `tracker` proxy will silently drop
	* all subsequent calls until `tracker.init()` is called again.
	*/
	destroy(): void
}

/**
* Type of the public {@link tracker} singleton proxy object.
*
* @remarks
* Single entry point for all tracker operations in the browser.
* All methods except `init` are safe to call before initialization -
* they are silently dropped until `init()` has been called.
*
* @example
* ```ts
* // When autoInit: false - call init manually at the right moment
* import { tracker } from 'vite-plugin-monitor/client'
* tracker.init(() => authStore.userId)
*
* tracker.track('checkout:complete', { orderId: 'ORD-99' })
* tracker.setUser('user_42', { attributes: { plan: 'pro' } })
* ```
*/
export type Tracker = {
	/**
	* Activate the tracker: starts the event queue flush timer, mounts the
	* overlay, and attaches the page unload flush handler.
	*
	* @remarks
	* Safe to call multiple times - subsequent calls are no-ops (singleton).
	*
	* When `autoInit: true` (default), this is called automatically by the
	* script injected into `index.html` and does not need to be called manually.
	*
	* When `autoInit: false`, call this explicitly at the appropriate point:
	* ```ts
	* import { tracker } from 'vite-plugin-monitor/client'
	* tracker.init(() => authStore.userId)
	* ```
	*
	* Note: event proxies (click, http, errors, navigation, console)
	* are always installed before application code runs, regardless of `autoInit`.
	* This call only activates the transport layer.
	*
	* @param userIdFn - Optional function called once at initialization to resolve
	*                   the current user identifier. Return `null` to fall back to
	*                   the anonymous session ID.
	*/
	init(userIdFn?: () => string | null): void
	track(name: string, data?: Record<string, unknown>, opts?: TrackEventOptions): void
	time(label: string): void
	timeEnd(label: string, data?: Record<string, unknown>, opts?: TrackEventOptions): number
	setUser(userId: string | null, opts?: SetUserOptions): void
	setContext(attrs: Record<string, unknown>): void
	group(name: string): string
	destroy(): void
}

/**
* Floating debug overlay widget rendered inside a Shadow DOM.
*
* @remarks
* Instantiated by `TrackerClient` during the activation phase, after
* `tracker.init()` is called.
*
* Shows session identity (userId, sessionId, appId), browser context
* (route, viewport, language, connection), and a link to the dashboard.
* The userId can be edited directly from the overlay panel.
*
* The panel is draggable by its header and can be toggled via the FAB button
* or the `Alt+T` keyboard shortcut.
*
* **Shadow DOM isolation:** all styles are scoped inside a closed Shadow DOM root
* attached to a host `<div data-tracker-overlay>` element. No CSS leaks into
* the host application.
*
*/
export interface IDebugOverlay {
	/**
	* Notify the overlay that a new event was emitted by the tracker.
	*
	* @remarks
	* Called by `TrackerClient` after every event is enqueued. Currently
	* reserved for future live event list rendering inside the overlay panel.
	*
	* @param event - The emitted {@link TrackerEvent}.
	*/
	pushEvent(event: TrackerEvent): void

	/**
	* Toggle the overlay panel open or closed.
	*
	* @remarks
	* Equivalent to the user clicking the FAB button. When opening, dynamic
	* fields (route, viewport, connection) are refreshed to reflect the current
	* browser state. Can also be triggered via the keyboard shortcut `Alt+T`.
	*/
	toggle(): void

	/**
	* Close the overlay panel if it is currently open.
	*
	* @remarks
	* No-op if the panel is already closed.
	*/
	close(): void

	/**
	* Remove the overlay from the DOM and clean up all event listeners.
	*
	* @remarks
	* Removes the document-level `mousemove`, `mouseup`, and `keydown` listeners
	* registered for drag and keyboard shortcut support. Detaches the host element
	* from `document.body`. After calling `destroy()`, the instance should not be
	* used further.
	*/
	destroy(): void

	/**
	* Refresh the userId display in the overlay panel.
	*
	* @remarks
	* Called by `TrackerClient.setUser()` whenever the userId changes
	* programmatically, so the overlay always reflects the current identity.
	* Also called by the overlay itself after the user confirms an inline edit.
	*/
	refreshUserId(): void
}

// INFO API contracts (write / read endpoints)

/**
* Request body sent by the browser to {@link HttpStorageOptions.writeEndpoint}
* on every queue flush.
*
* @remarks
* Serialized as `application/json`. The full HTTP contract is:
*
* ```
* POST <writeEndpoint>
* Content-Type: application/json
* X-Tracker-Key: <apiKey>          (optional)
*
* { "events": TrackerEvent[] }
* ```
*
* The server must respond with any `2xx` status. The response body is ignored.
* Non-`2xx` responses cause the batch to be requeued automatically.
*/
export interface IngestRequest {
	/**
	* Batch of events collected since the previous flush.
	*
	* @remarks
	* Length bounded by {@link HttpStorageOptions.batchSize} (default 25) for
	* timer-triggered flushes. On page unload (`sendBeacon`), the entire
	* remaining queue is sent in one shot.
	*/
	events: TrackerEvent[]
}

/**
* Parameters sent by the dashboard to the event reading endpoint on every poll tick.
*
* @remarks
* The built-in dashboard **always** sends `since` and `until`. Your server
* implementation **must** honour these two parameters and return only events
* whose `timestamp` falls within `[since, until]`, sorted from newest to oldest.
*
* All other fields (`type`, `level`, `userId`, etc.) are retained for
* compatibility with custom backends or external integrations that wish to
* implement additional server-side pre-filtering. The built-in dashboard does
* **not** send them - it performs all further filtering, grouping, aggregations,
* and full-text search client-side on the time-windowed dataset returned by
* the server.
*
* @example Minimal compliant server implementation (Express):
* ```ts
* app.get('/tracker/events', (req, res) => {
*   const { since, until } = req.query
*   const events = db.events
*     .filter(e => e.timestamp >= since && e.timestamp <= until)
*     .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
*   res.json({ events, total: events.length, page: 1, limit: events.length })
* })
* ```
*/
export interface EventsQuery {
	/**
	 * Lower bound (inclusive) of the requested time window. ISO 8601 UTC.
	 *
	 * @remarks
	 * **Used by the built-in dashboard** on every poll tick. Always set to
	 * the start of the time range selected by the user (e.g. last 1h, 24h, etc.).
	 * Your server must return only events with `timestamp >= since`.
	 */
	since?: string
	/**
	 * Upper bound (inclusive) of the requested time window. ISO 8601 UTC.
	 *
	 * @remarks
	 * **Used by the built-in dashboard** on every poll tick. Always set to
	 * the end of the time range selected by the user.
	 * Your server must return only events with `timestamp <= until`.
	 */
	until?: string
	/** Returns only events with `timestamp > after`. ISO 8601 UTC. Not used by the built-in dashboard. */
	after?: string
	/** Filter by category. Not used by the built-in dashboard. */
	type?: TrackerEventType
	/** Filter by level. Not used by the built-in dashboard. */
	level?: LogLevel
	/** ​​Filter by userId. Not used by the built-in dashboard. */
	userId?: string
	/** Filter by sessionId. Not used by the built-in dashboard. */
	sessionId?: string
	/** Filter by groupId. Not used by the built-in dashboard. */
	groupId?: string
	/** Filter by appId. Not used by the built-in dashboard. */
	appId?: string
	/** Full-text search. Not used by the built-in dashboard. */
	search?: string
	/** Maximum number of events per page. Not used by the built-in dashboard. */
	limit?: number
	/** 1-based page index. Not used by the built-in dashboard. */
	page?: number
}

/**
* Response body of the event reading endpoint.
*
* @remarks
* **Contract that the backend must respect:**
* ```
* GET <readEndpoint>?since=<ISO8601>&until=<ISO8601>
* Accept: application/json
* X-Tracker-Key: <apiKey> (optional)
* ```
* The backend must return, in the `events` field, all events whose `timestamp`
* falls within the requested `[since, until]` window, sorted from newest to
* oldest. The dashboard reads only `events` and ignores the pagination fields
* (`total`, `page`, `limit`, `nextCursor`), which are retained for compatibility
* with backends that implement their own pagination or expose the same endpoint
* for other consumers.
*/
export interface EventsResponse {
	/**
	* Events matching the requested time window (`since`/`until`), sorted from newest to oldest.
	*
	* @remarks
	* This is the only field the built-in dashboard reads from the response.
	* The backend must include all events within the requested time range without
	* applying any additional filtering beyond `since`/`until`.
	*/
	events: TrackerEvent[]

	/** Total count. Ignored by the built-in dashboard. */
	total: number

	/** Current page. Ignored by the built-in dashboard. */
	page: number

	/** Page size. Ignored by the built-in dashboard. */
	limit: number

	/**
	* Timestamp of the most recent event. Ignored by the built-in dashboard.
	* Retained for compatibility with backends that support pagination.
	*/
	nextCursor?: string
}

// INFO Dashboard - aggregation types

/**
* A single time-bucketed data point in a time series.
*
* @remarks
* Bucket format depends on the selected time range:
* - **≤ 48 h** - hourly: `'YYYY-MM-DDTHH:00'`
* - **> 48 h** - daily: `'YYYY-MM-DD'`
*/
export interface TimePoint {
	/** Time bucket label. @example `'2024-03-15T14:00'` */
	bucket: string
	/** Aggregated value for this bucket. */
	value: number
}

/** A ranked item for leaderboard-style lists (top pages, top users, etc.). */
export interface RankedItem {
	/** Display label (e.g. route pathname or userId). */
	label: string
	/** Total occurrences within the selected time range. */
	count: number
}

/**
* A single entry in the top-errors list.
*
* @remarks
* Errors are grouped by {@link ErrorPayload.message}.
*/
export interface ErrorItem {
	/** Error message - used as the grouping key. */
	message: string
	/** Total occurrences in the selected time range. */
	count: number
	/** ISO 8601 timestamp of the most recent occurrence. */
	lastSeen: string
}

/**
* A single step in the navigation funnel visualization.
*
* @remarks
* Each step represents a route transition observed in the event data.
*/
export interface FunnelStep {
	/** Source route - the `from` value of the {@link NavigationPayload}. */
	from: string
	/** Destination route - the `to` value of the {@link NavigationPayload}. */
	to: string
	/** Number of users who followed this exact from->to transition. */
	count: number
}

/**
* Aggregated metrics computed client-side in the browser from raw events.
*
* @remarks
* Produced by `computeMetrics()` in `aggregations.ts`. Populates the charts
* and ranked lists in the Metrics tab of the dashboard.
*/
export interface MetricsResult {
	/** Number of distinct sessions with at least one event in the last 5 minutes. */
	activeSessions: number
	/** Time series of error rate (%) per bucket, sorted ascending. */
	errorRateTimeline: TimePoint[]
	/** Time series of total event volume per bucket, sorted ascending. */
	eventVolume: TimePoint[]
	/** Top 10 destination pages ranked by navigation count. */
	topPages: RankedItem[]
	/** Top 10 most frequent app error messages (type === 'error' only, excludes HTTP errors), shown in the "Top App Errors" panel. */
	topErrors: ErrorItem[]
	/** Top 10 most frequent from->to navigation transitions. */
	navigationFunnel: FunnelStep[]
	/** Top 10 HTTP endpoints ranked by call count. */
	topEndpoints: RankedItem[]
}

/** HTTP request statistics computed from events with type === 'http'. */
export interface HttpStats {
	/** Total number of HTTP requests. */
	total: number
	/** Count of requests with status 2xx. */
	count2xx: number
	/** Count of requests with status 4xx. */
	count4xx: number
	/** Count of requests with status 5xx. */
	count5xx: number
	/** Percentage of 2xx responses (0–100). */
	pct2xx: number
	/** Percentage of 4xx responses (0–100). */
	pct4xx: number
	/** Percentage of 5xx responses (0–100). */
	pct5xx: number
	/** HTTP error rate: (4xx + 5xx) / total, as a fraction 0–1. */
	httpErrorRate: number
	/** URL of the most-called endpoint with its call count. */
	mostCalledEndpoint?: { url: string; count: number; method: string; topStatus?: number }
	/** URL of the slowest endpoint (highest avg duration) with its avg duration in ms. */
	slowestEndpoint?: { url: string; avgDuration: number; method: string; topStatus?: number }
}

/**
* Aggregated KPI stats computed client-side in the browser from raw events.
*
* @remarks
* Produced by `computeStats()` in `aggregations.ts`. Populates the KPI cards
* at the top of the dashboard.
*/
export interface StatsResult {
	/** Total events in the time range. */
	totalEvents: number
	/** Number of distinct `sessionId` values. */
	totalSessions: number
	/** Number of distinct `userId` values. */
	totalUsers: number
	/**
	 * Fraction of non-HTTP `'error'`-level events over the total.
	 * Only counts type === 'error' (JS errors). Excludes HTTP 4xx/5xx.
	 * Value between 0 and 1.
	 */
	errorRate: number
	/** Arithmetic mean of all {@link HttpPayload.duration} values. Absent when no HTTP events. */
	avgHttpDuration?: number
	/** Top 10 routes by event count, sorted descending. */
	topRoutes: Array<{ route: string; count: number }>
	/** Top 10 users by event count, sorted descending. */
	topUsers: Array<{ userId: string; count: number }>
	/** Hourly event count time series, sorted ascending. */
	timeline: Array<{ bucket: string; count: number }>
	/** Aggregated HTTP request statistics. */
	httpStats: HttpStats
}

// INFO Dashboard - state and UI component types

/**
 * Preset time window options available in the dashboard time range picker.
 *
 * @remarks
 * `'live'` is a special rolling preset: the time window slides forward
 * automatically on every poll tick, always showing the last 5 minutes
 * up to the current moment. All other presets produce a fixed snapshot
 * of the selected duration ending at the moment the preset was selected.
 */
export type TimePreset = 'live' | '1h' | '6h' | '24h' | '7d' | '30d'
/**
* Render mode for time series charts in the Metrics tab.
*
* @remarks
* - `'line'` - line + area fill. Best for trends. Default.
* - `'bar'`  - vertical bars. Best for comparing discrete buckets.
*/
export type ChartType = 'line' | 'bar'

/**
* Identifier for the currently active tab in the dashboard SPA.
*
* @remarks
* | Value      | Content                                              |
* |------------|------------------------------------------------------|
* | `'metrics'`| KPI cards, time series charts, top lists, funnel     |
* | `'events'` | Paginated raw event list with filters + detail panel |
*/
export type AppTab = 'metrics' | 'events'

/**
* Represents the currently selected time window for all dashboard queries.
*
* @remarks
* All API calls use `from` and `to` as `since` and `until` parameters.
* When `preset` is a {@link TimePreset}, `from`/`to` are recomputed on each
* poll tick. When the user edits the datetime inputs, `preset` becomes `'custom'`.
*/
export interface TimeRange {
	/**
	 * Active preset label, or `'custom'` when an explicit range is set.
	 *
	 * @remarks
	 * When `preset === 'live'`, `from` and `to` are indicative only -
	 * the actual window is recomputed on every poll tick using
	 * `LIVE_WINDOW_MS` from the current moment. Do not use `from`/`to`
	 * directly when `preset === 'live'`; call `effectiveTimeRange()`
	 * from `state.ts` instead.
	 */
	preset: TimePreset | 'custom'
	/** Start of the time window. ISO 8601 UTC string. */
	from: string
	/** End of the time window. ISO 8601 UTC string. */
	to: string
}

/**
 * Operator that controls how the `search` term in {@link EventsFilter}
 * is matched against the serialized event payload.
 *
 * | Value          | Behaviour                                                        |
 * |----------------|------------------------------------------------------------------|
 * | `'contains'`   | Case-insensitive substring match (default).                      |
 * | `'not-contains'` | Excludes events whose payload contains the term.               |
 * | `'equals'`     | Case-insensitive exact equality match on the full serialized payload. |
 * | `'starts-with'`| Payload string starts with the term (case-insensitive).          |
 * | `'ends-with'`  | Payload string ends with the term (case-insensitive).            |
 * | `'regex'`      | Term is interpreted as a regular expression (case-insensitive).  |
 *                    Invalid regex falls back to a literal `contains` match. |
 */
export type SearchOperator =
	| 'contains'
	| 'not-contains'
	| 'equals'
	| 'starts-with'
	| 'ends-with'
	| 'regex'

/**
 * Active filter state applied to the Events tab event list.
 *
 * @remarks
 * All fields are optional and combine with AND logic.
 * All filtering is performed client-side on the full event buffer -
 * the backend always returns the complete unfiltered dataset for the
 * selected time range. This ensures instant filter response without
 * round-trips and allows combining any filter combination freely.
 *
 * The `search` field is matched client-side against the full JSON
 * serialization of each event's payload, enabling free-text search
 * across all payload fields without backend support.
 */
export interface EventsFilter {
	/** Filter by event category. Client-side exact match on `event.type`. */
	type?: TrackerEventType
	/**
	 * Filter by one or more severity levels. Client-side match on `event.level`.
	 * An event passes if its level is included in the array.
	 * Empty array or undefined means no level filter is applied.
	 *
	 */
	level?: LogLevel[]
	/**
	 * Filter by user ID. Client-side case-insensitive substring match.
	 * Matches against `event.userId`.
	 */
	userId?: string
	/**
	 * Free-text search term matched against `JSON.stringify(event.payload)`.
	 * The matching strategy is controlled by {@link EventsFilter.searchOperator}.
	 */
	search?: string
	/**
	 * Operator applied when matching `search` against the event payload.
	 *
	 * @remarks
	 * Defaults to `'contains'` when omitted.
	 * Has no effect when `search` is empty or undefined.
	 *
	 * @default 'contains'
	 * @see {@link SearchOperator}
	 */
	searchOperator?: SearchOperator
	/**
	 * Filter navigation events by destination route.
	 * Client-side exact match on `event.meta.route`.
	 *
	 * @remarks
	 * Used when clicking a Top Pages item or a Navigation Funnel step to
	 * pre-filter the Events tab to that specific route.
	 */
	route?: string
}

/**
* Complete reactive state of the dashboard SPA.
*
* @remarks
* Owned by the `store` singleton in `state.ts`. All mutations go through
* typed mutator methods. Consumers subscribe via the {@link StateEvents} bus.
*/
export interface AppState {
	/** Whether the user has passed the login gate. */
	authenticated: boolean
	/** Currently visible tab. */
	tab: AppTab
	/** Selected time window, shared between Metrics and Events tabs. */
	timeRange: TimeRange
	/** Current render mode for all time series charts. */
	chartType: ChartType
	/** Latest metrics result. `null` before the first successful computation. */
	metrics: MetricsResult | null
	/** Latest stats result. `null` before the first successful computation. */
	stats: StatsResult | null
	/** `true` while metrics + stats are being fetched and computed. */
	metricsLoading: boolean
	/** Error message from the last failed metrics fetch. `null` when healthy. */
	metricsError: string | null
	/** Events displayed in the Events tab. */
	events: TrackerEvent[]
	/** Active filter applied to the Events tab list. */
	eventsFilter: EventsFilter
	/** `true` while a full events reload is in-flight. */
	eventsLoading: boolean
	/** Error message from the last failed events fetch. `null` when healthy. */
	eventsError: string | null
	/** Total count of matching events for pagination display. */
	eventsTotal: number
	/** Event currently shown in the detail side panel. `null` when closed. */
	selectedEvent: TrackerEvent | null
	/** Whether the backend responded successfully to the last ping check. */
	backendOnline: boolean
}

/**
* Type map for the dashboard reactive pub/sub event bus.
*
* @remarks
* Keys are event names; values are the payload types passed to subscribers.
* ```ts
* store.on('tab:change', (tab) => renderTab(tab))
* ```
*/
export interface StateEvents {
	'auth:change': boolean
	'tab:change': AppTab
	'timeRange:change': TimeRange
	'chartType:change': ChartType
	'metrics:update': { metrics: MetricsResult; stats: StatsResult }
	'metrics:loading': boolean
	'metrics:error': string | null
	'events:update': TrackerEvent[]
	'events:filter': EventsFilter
	'events:loading': boolean
	'events:error': string | null
	'events:select': TrackerEvent | null
	'backend:status': boolean
}

/**
* Configuration passed to `createPoller()` to start a polling loop.
*
* @remarks
* Uses `setTimeout` (not `setInterval`) so ticks never overlap: the next tick
* is scheduled only after `onTick` resolves. This prevents pileup on slow backends.
*/
export interface PollOptions {
	/**
	* Time in milliseconds to wait between the end of one tick and the start of the next.
	*
	* @remarks
	* Effective interval = `intervalMs + onTick duration`. For fast backends the
	* difference is imperceptible; for slow ones, the poller self-throttles.
	*
	* @default 3000
	*/
	intervalMs: number

	/**
	 * Async function executed on every tick.
	 *
	 * @remarks
	 * Receives the current cursor (`null` on first tick or after `resetCursor()`).
	 * Returning `null` keeps the cursor at `null` so every subsequent tick
	 * performs a full reload - this is the intended behaviour for the events
	 * poller, which always fetches the complete time window from the backend
	 * and delegates all filtering to the client.
	 * Returning a non-null string advances the cursor for incremental fetches -
	 * used only by the metrics poller (which always returns `null` anyway).
	 * Throwing is safe - errors are forwarded to `onError` and the loop continues.
	 */
	onTick: (cursor: string | null) => Promise<string | null>

	/** Called when `onTick` throws. The loop continues after an error. */
	onError?: (err: unknown) => void
}

/**
* Handle returned by `createPoller()` for controlling a running poll loop.
*
* @remarks
* All methods are safe to call from any context. `stop()` is idempotent.
*/
export interface PollHandle {
	/**
	* Immediately trigger one tick outside the normal interval, then resume normally.
	*
	* @remarks
	* Useful after a user action known to have produced new backend data.
	*/
	refresh(): void

	/**
	* Reset the cursor to `null` so the next tick performs a full data reload.
	*
	* @remarks
	* Does not immediately trigger a tick. Use after a filter change that
	* invalidates the current event list.
	*/
	resetCursor(): void

	/**
	* Permanently stop the poll loop and cancel any pending timer.
	*
	* @remarks
	* The instance cannot be restarted after `stop()`. Safe to call multiple times.
	*/
	stop(): void
}

/**
* SVG chart render mode.
*
* @remarks
* Separate alias from {@link ChartType} to decouple the chart component API
* from the dashboard state model.
*/
export type ChartMode = 'line' | 'bar'

/**
* Immutable configuration passed to `createChart()` at construction time.
*/
export interface ChartOptions {
	/**
	* CSS color applied to the chart line, area fill gradient, and bar fill.
	*
	* @default '#3b82f6'
	*/
	color?: string

	/**
	* Y-axis unit label shown in the tooltip on data-point hover.
	*
	* @default 'events'
	*/
	label?: string

	onClick?: () => void
}

/**
* Public interface of a chart component instance returned by `createChart()`.
*
* @remarks
* Renders as an inline SVG inside a `<div>` wrapper. Mount `el` once;
* call `render()` repeatedly with updated data.
*/
export interface ChartComponent {
	/** Root `<div>` containing the SVG chart. Append to DOM once. */
	el: HTMLElement
	/**
	* Re-render the chart with new data, optionally switching render mode.
	*
	* @param data - Time-bucketed data points to plot.
	* @param mode - `'line'` or `'bar'`. Defaults to last-used mode.
	*/
	render: (data: TimePoint[], mode?: ChartMode) => void
}

/**
* Public interface of the Top Pages panel component.
*/
export interface TopPagesComponent extends HTMLElement {
	render(items: RankedItem[]): void
}

/**
* Public interface of the Top Errors panel component.
*/
export interface TopErrorsComponent extends HTMLElement {
	render(items: ErrorItem[]): void
}

/**
* Public interface of the Navigation Funnel panel component.
*/
export interface FunnelComponent extends HTMLElement {
	render(steps: FunnelStep[]): void
}

// INFO Plugin internals (Node.js)

/**
* Logger instance returned by `createLogger()`.
*
* @remarks
* The logger has two distinct responsibilities:
*
* 1. **Console output** (`debug`, `info`, `warn`, `error`) - runs on the main
*    thread, used exclusively for Vite plugin diagnostic messages prefixed with
*    `[tracker]`.
*
* 2. **Event file writing** (`writeEvent`) - delegates all file I/O to a
*    dedicated worker thread via `postMessage`. The main thread never blocks
*    on stream backpressure or rotation.
*
* **Internal use only** - not part of the public plugin API.
*
* @since 0.1.0
*/
export interface Logger {
	/** Emit a debug-level message. Only printed when `LoggingOptions.level = 'debug'`. */
	debug(msg: string): void
	/** Emit an info-level message. Printed at `'debug'` or `'info'` level. */
	info(msg: string): void
	/** Emit a warn-level message. Printed at `'debug'`, `'info'`, or `'warn'` level. */
	warn(msg: string): void
	/** Emit an error-level message. Always printed regardless of level. */
	error(msg: string): void
	/**
	* Write a tracked event to all configured log file transports.
	*
	* @remarks
	* Non-blocking - delegates to the logger worker thread immediately.
	* Events below `LoggingOptions.level` are discarded before being sent.
	*/
	writeEvent(event: TrackerEvent): void
	/**
	* Flush pending events and gracefully shut down the logger worker thread.
	*
	* @remarks
	* Called by the shutdown hook on `SIGTERM`/`SIGINT`/`SIGHUP` and by
	* `closeBundle()` at the end of a production build.
	*
	* @returns Resolves when the worker exits or after a 3-second safety timeout.
	*/
	destroy(): Promise<void>
}

/**
* A cleanup callback registered with `registerShutdownHook()`.
*
* @remarks
* Can be synchronous or return a `Promise`. All hooks run concurrently via
* `Promise.allSettled` on shutdown, subject to a 5-second global deadline.
* Hooks must be idempotent.
*/
export type CleanupFn = () => Promise<void> | void

/**
* Fully resolved storage configuration produced internally by `resolveOptions()`.
*
* @remarks
* All optional fields are replaced with concrete values.
* `mode` is never `'auto'` - already expanded to the effective mode.
*
* @internal
*/
export type ResolvedStorage =
	| {
		mode: Exclude<StorageMode, 'websocket'>
		writeEndpoint: string
		readEndpoint: string
		pingEndpoint: string
		wsEndpoint: ''
		apiKey: string
		port: number
		batchSize: number
		flushInterval: number
		maxBufferSize: number
	}
	| {
		mode: 'websocket'
		wsEndpoint: string
		pingEndpoint: string
		writeEndpoint: ''
		readEndpoint: ''
		apiKey: string
		port: number
		batchSize: number
		flushInterval: number
		maxBufferSize: number
	}

/**
* Fully resolved plugin configuration with all defaults applied.
*
* @remarks
* Produced by `resolveOptions()` and passed throughout plugin internals.
* Every field is always present - no optional fields, no `undefined`.
*
* @internal
*/
export type ResolvedTrackerOptions = {
	/** Whether the plugin is active. When `false` all hooks are no-ops. */
	enabled: boolean
	appId: string
	storage: ResolvedStorage
	autoInit: boolean
	track: {
		clicks: boolean
		http: boolean | HttpTrackOptions
		errors: boolean
		navigation: boolean
		console: boolean | ConsoleTrackOptions | false
		userId: () => string | null
		level: LogLevel
		ignoreUrls: string[]
	}
	logging: NonNullable<TrackerPluginOptions['logging']>
	dashboard: Required<NonNullable<TrackerPluginOptions['dashboard']>>
	overlay: Required<NonNullable<TrackerPluginOptions['overlay']>>
}

/** @internal Shared fields between the two `TrackerConfig` transport variants. */
interface TrackerConfigCommon {
	appId: string
	apiKey: string
	batchSize: number
	flushInterval: number
	track: {
		clicks: boolean
		http: boolean | HttpTrackOptions
		errors: boolean
		navigation: boolean
		console: boolean | ConsoleTrackOptions
		level: string
		ignoreUrls: string[]
	}
	dashboard: {
		enabled: boolean
		route: string
		pollInterval: number
		auth: { username: string; password: string } | false
	}
	overlay: {
		enabled: boolean
		position: string
	}
}

/**
* Runtime configuration object injected into `window.__TRACKER_CONFIG__`
* by the plugin and read by the browser client.
*
* @remarks
* Uses a discriminated union so the client can determine the active
* transport mode at runtime. Always produced by the plugin's code
* generator - never constructed manually.
*
* @internal
*/
export type TrackerConfig = TrackerConfigCommon & (
	| {
		mode: Exclude<StorageMode, 'websocket'>
		writeEndpoint: string
		readEndpoint: string
		pingEndpoint: string
		wsEndpoint: ''
	}
	| {
		mode: 'websocket'
		wsEndpoint: string
		pingEndpoint: string
		writeEndpoint: ''
		readEndpoint: ''
	}
)

// INFO Internal implementation types

/**
 * Resolved http options.
 *
 * @internal
 */
export interface ResolvedHttpOpts {
	captureRequestHeaders:  boolean
	captureRequestBody:     boolean
	captureResponseHeaders: boolean
	captureResponseBody:    boolean
	excludeHeaders:         string[]
	redactKeys:             string[]
	maxBodySize:            number
}

/**
* Options for the client-side `EventQueue`.
*
* @internal
*/
export interface QueueOptions {
	wsEndpoint: string
	writeEndpoint: string
	apiKey: string
	batchSize: number
	flushInterval: number
}

/**
* Resolved console tracker options after defaults are applied.
*
* @internal
*/
export interface ResolvedConsoleOpts {
	methods: Set<ConsoleMethod>
	maxArgLength: number
	maxArgs: number
	captureStackOnError: boolean
	ignorePatterns: string[]
}

/**
* XMLHttpRequest extended with private tracker state fields.
*
* @internal
*/
export type TrackedXHR = XMLHttpRequest & {
	__tracker_method__: string
	__tracker_url__: string
	__tracker_startTime__: number
	__tracker_reqBody__: unknown
	__tracker_headers__: Record<string, string>
}

/**
* Configuration for a single KPI card in the dashboard.
*
* @internal
*/
export interface KpiCard {
	id: string
	label: string
	getValue: (stats: StatsResult, metrics: MetricsResult | null) => string
	getClass: (stats: StatsResult, metrics: MetricsResult | null) => string
}

/**
* Generic pub/sub listener function.
*
* @internal
*/
export type Listener<T> = (payload: T) => void

/**
* SVG element attribute map used by the `svgEl` DOM utility.
*
* @internal
*/
export type Attrs = Record<string, string | boolean | number | null | undefined>

// INFO Global augmentations

declare global {
	interface Window {
		/** @internal Injected and frozen by the plugin. Do not modify. */
		readonly __TRACKER_CONFIG__: TrackerConfig
		/** @internal Set once by TrackerClient after init. Do not modify. */
		__tracker_instance__?: Tracker
	}

	/**
	* Array of registered shutdown callbacks stored on `globalThis`.
	*
	* @remarks
	* Stored on `globalThis` (not module scope) so the array survives HMR
	* re-evaluations of `shutdown.ts` without losing previously registered hooks.
	*/
	// eslint-disable-next-line no-var
	var __tracker_shutdown_hooks__: Array<CleanupFn> | undefined

	/**
	* Guard flag that prevents signal handlers from being registered more than once.
	*
	* @remarks
	* Set to `true` the first time `registerShutdownHook()` installs the signal
	* handlers. Subsequent HMR re-evaluations skip re-registration.
	*/
	// eslint-disable-next-line no-var
	var __tracker_shutdown_installed__: boolean | undefined
}

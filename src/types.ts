import { ErrorItem, FunnelStep, MetricsResult, RankedItem, StatsResult, TimePoint } from "./dashboard/aggregations"

/**
* Logger instance returned by `createLogger()`.
*
* @remarks
* The logger has two distinct responsibilities handled separately:
*
* 1. **Console output** (`debug`, `info`, `warn`, `error`) - runs on the
*    main thread and is used exclusively for Vite plugin diagnostic messages
*    (startup info, warnings, errors). Output is prefixed with
*    `[tracker]` and coloured cyan for visibility in the Vite terminal.
*
* 2. **Event file writing** (`writeEvent`) - delegates all file I/O to a
*    dedicated worker thread via `postMessage`. The main thread never blocks
*    on stream backpressure or rotation. Events arriving before the worker
*    is ready are buffered in memory and flushed once the worker signals
*    `'ready'`.
*
* The logger is created once in `configResolved` and shared across all
* plugin hooks. It is destroyed gracefully via `destroy()` on
* `SIGTERM`/`SIGINT`/`SIGHUP` through the shutdown hook system.
*
* **Internal use only** - not part of the public plugin API.
*
* @since 0.1.0
*/
export interface Logger {
	/**
	* Emit a debug-level diagnostic message to the Vite terminal.
	*
	* @remarks
	* Only printed when `LoggingOptions.level` is set to `'debug'`.
	* Use for fine-grained tracing during development of the plugin itself.
	*
	* @param msg - The message string to print, without the `[tracker]` prefix
	*              (added automatically).
	*/
	debug(msg: string): void

	/**
	* Emit an info-level diagnostic message to the Vite terminal.
	*
	* @remarks
	* Printed when `LoggingOptions.level` is `'debug'` or `'info'` (default).
	* Use for normal operational messages such as startup confirmation,
	* mode selection, and server port binding.
	*
	* @param msg - The message string to print.
	*/
	info(msg: string): void

	/**
	* Emit a warn-level diagnostic message to the Vite terminal.
	*
	* @remarks
	* Printed when `LoggingOptions.level` is `'debug'`, `'info'`, or `'warn'`.
	* Use for recoverable anomalies that do not prevent the plugin from
	* functioning - e.g. missing optional configuration, port conflicts,
	* or degraded mode fallbacks.
	*
	* @param msg - The message string to print.
	*/
	warn(msg: string): void

	/**
	* Emit an error-level diagnostic message to the Vite terminal.
	*
	* @remarks
	* Always printed regardless of `LoggingOptions.level`. Use for failures
	* that prevent correct plugin operation - e.g. worker thread crashes,
	* file system errors, or invalid configuration.
	*
	* @param msg - The message string to print.
	*/
	error(msg: string): void

	/**
	* Write a tracked event to all configured log file transports.
	*
	* @remarks
	* Non-blocking - delegates immediately to the logger worker thread via
	* `postMessage`. The call returns before any I/O occurs. Events whose
	* `level` is below `LoggingOptions.level` are discarded before being
	* sent to the worker.
	*
	* Events arriving before the worker thread has signalled `'ready'` are
	* buffered in an in-memory array and flushed automatically once the
	* worker is ready - no events are lost during worker startup.
	*
	* @param event - The {@link TrackerEvent} to persist. Must be a plain
	*                JSON-serializable object - the structured-clone algorithm
	*                used by `postMessage` will fail on non-serializable values.
	*/
	writeEvent(event: TrackerEvent): void

	/**
	* Flush pending events and gracefully shut down the logger worker thread.
	*
	* @remarks
	* Called once by the shutdown hook on `SIGTERM`/`SIGINT`/`SIGHUP`, and
	* by `closeBundle()` at the end of a production build.
	*
	* **Shutdown sequence:**
	* 1. Flushes any events still buffered in `pendingEvents` to the worker.
	* 2. Sends a `{ type: 'destroy' }` message to the worker.
	* 3. The worker closes all open `fs.WriteStream` instances and exits.
	* 4. Awaits the worker `'exit'` event with a 3-second safety timeout -
	*    after which the promise resolves regardless, preventing the Vite
	*    process from hanging indefinitely.
	*
	* After `destroy()` resolves, no further `writeEvent()` calls should
	* be made - the worker is no longer running.
	*
	* @returns A `Promise` that resolves when the worker has exited or the
	*          3-second timeout has elapsed.
	*/
	destroy(): Promise<void>
}

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
* | Value           | Payload type               | Emitted by                       |
* |-----------------|----------------------------|----------------------------------|
* | `'click'`       | {@link ClickPayload}       | Click tracker                    |
* | `'http'`        | {@link HttpPayload}        | HTTP tracker (fetch + XHR)       |
* | `'error'`       | {@link ErrorPayload}       | Error tracker                    |
* | `'navigation'`  | {@link NavigationPayload}  | Navigation tracker               |
* | `'performance'` | {@link PerformancePayload} | Performance tracker              |
* | `'console'`     | {@link ConsolePayload}     | Console tracker                  |
* | `'custom'`      | {@link CustomPayload}      | `tracker.track()` / `timeEnd()`  |
*
*/
export type TrackerEventType =
| 'click'
| 'http'
| 'error'
| 'navigation'
| 'performance'
| 'console'
| 'custom'

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
* - HTTP 5xx responses → `'error'`
* - HTTP 4xx responses → `'warn'`
* - Unhandled JS errors → `'error'`
* - Everything else → `'info'`
*
*/
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

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
	* Random UUID generated once per browser tab lifetime.
	*
	* @remarks
	* Created by `TrackerSession` on first load using `crypto.randomUUID()` and
	* stored in `sessionStorage` so it survives soft navigations within the same
	* tab. Resets when the tab is closed or the page is hard-reloaded.
	*
	* Used to group all events emitted from a single continuous browser session,
	* enabling session replay, funnel analysis, and duration calculations.
	*/
	sessionId: string

	/**
	* Identifier of the user who triggered the event.
	*
	* @remarks
	* Resolved at emission time by calling the `track.userId` function from the
	* plugin config. If that function returns `null` or is not configured, this
	* field falls back to `sessionId`, so anonymous users still produce coherent
	* per-session event streams without requiring authentication.
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
	* `if (e.type === 'http') e.payload  // → HttpPayload`
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
| PerformancePayload
| ConsolePayload
| CustomPayload

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
	* 5xx → `'error'`, 4xx → `'warn'`, 2xx/3xx → `'info'`.
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
	* Pipeline: parse JSON → redact sensitive keys → re-serialize → truncate to `maxBodySize`.
	* Non-JSON bodies are stored as plain strings. `ReadableStream` bodies → `'[ReadableStream]'`.
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
	* Same parse → redact → truncate pipeline as `requestBody`.
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
* Payload for events with `type === 'performance'`.
*
* @remarks
* Emitted by the performance tracker when a Web Vitals metric reading is
* finalized. **One event per metric per page load** - not on every intermediate update.
*
* Uses `PerformanceObserver` with `buffered: true` to capture metrics that fired
* before the tracker initialized. Falls back gracefully in unsupported browsers.
*
* **LCP**: the browser updates the candidate continuously. The tracker accumulates
* updates and emits once on the first user interaction or visibility change,
* matching the Web Vitals specification.
*
* **CLS**: layout shift scores are accumulated across the session; the emitted
* value is the running total.
*
* @see {@link https://web.dev/vitals/ | Core Web Vitals}
*/
export interface PerformancePayload {
	/**
	* The Web Vitals metric being reported.
	*
	* @remarks
	* | Metric  | Full name                 | Unit        | "Good" threshold |
	* |---------|---------------------------|-------------|------------------|
	* | `'FCP'` | First Contentful Paint    | ms          | ≤ 1 800 ms       |
	* | `'LCP'` | Largest Contentful Paint  | ms          | ≤ 2 500 ms       |
	* | `'FID'` | First Input Delay         | ms          | ≤ 100 ms         |
	* | `'CLS'` | Cumulative Layout Shift   | score (0–∞) | ≤ 0.1            |
	* | `'TTFB'`| Time to First Byte        | ms          | ≤ 800 ms         |
	* | `'INP'` | Interaction to Next Paint | ms          | ≤ 200 ms         |
	*/
	metric: 'FCP' | 'LCP' | 'FID' | 'CLS' | 'TTFB' | 'INP'

	/**
	* Measured value of the metric.
	*
	* @remarks
	* - **Time-based** (FCP, LCP, FID, TTFB, INP): milliseconds, rounded to nearest integer.
	* - **CLS**: unitless cumulative score ≥ 0. Values above 0.25 are classified `'poor'`.
	*/
	value: number

	/**
	* Google's classification of the measured value against published thresholds.
	*
	* @remarks
	* | Rating               | Meaning                                           |
	* |----------------------|---------------------------------------------------|
	* | `'good'`             | Meets recommended target                          |
	* | `'needs-improvement'`| Above target but not yet critical                 |
	* | `'poor'`             | Exceeds critical threshold; UX is impacted        |
	*/
	rating: 'good' | 'needs-improvement' | 'poor'
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
	* 1. String first arg → used directly, truncated to `maxArgLength`.
	* 2. Non-string primitive → coerced to string.
	* 3. Object/array → brief type descriptor, e.g. `'[Object]'`, `'[Array(3)]'`.
	* 4. `console.assert(false, msg)` → assertion message (second arg), not the boolean.
	*
	* Indexed by the backend for full-text search.
	*/
	message: string

	/**
	* All arguments passed to the console call, each safely serialized.
	*
	* @remarks
	* Serialization is defensive:
	* - Circular references → `'[Circular]'`
	* - DOM nodes → `'[HTMLDivElement]'`
	* - Functions → `'[Function: name]'`
	* - Symbols → `'[Symbol(description)]'`
	* - BigInt → `'[BigInt: 12345n]'`
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
	* `document.referrer` captured at session start.
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
* | `'websocket'`  | Production/Dev - bidirection by WebSocket                                                     | Nothing extra    |
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
* HTTP transport configuration — used when `mode` is `'http'`, `'standalone'`,
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
	* **Request** (browser → server):
	* - Method: `POST`
	* - Content-Type: `application/json`
	* - Header: `X-Tracker-Key: <apiKey>` (only when `apiKey` is configured)
	* - Body: `{ "events": TrackerEvent[] }`  — see {@link IngestRequest}
	*
	* **Response** (server → browser):
	* - Any `2xx` status is treated as success — the response body is ignored.
	* - Non-`2xx` responses cause the batch to be requeued and retried on the
	*   next flush interval.
	*
	* @example `'https://api.myapp.com/monitor/events'`, `'/api/tracking/ingest'`
	*/
	writeEndpoint?: string

	/**
	* Full URL of the events read endpoint queried by the dashboard.
	*
	* @remarks
	* **Request** (dashboard → server):
	* - Method: `GET`
	* - Header: `X-Tracker-Key: <apiKey>` (only when `apiKey` is configured)
	* - Query parameters (all optional):
	*   - `since`     — ISO 8601 UTC — return events with `timestamp >= since`
	*   - `until`     — ISO 8601 UTC — return events with `timestamp <= until`
	*   - `after`     — ISO 8601 UTC — cursor: return events with `timestamp > after`
	*   - `before`    — ISO 8601 UTC — return events with `timestamp < before`
	*   - `type`      — {@link TrackerEventType} — filter by event category
	*   - `level`     — {@link LogLevel} — filter by severity
	*   - `userId`    — exact match
	*   - `sessionId` — exact match
	*   - `groupId`   — exact match
	*   - `appId`     — exact match
	*   - `search`    — full-text search term
	*   - `limit`     — max events per page (default `100`, max `500`)
	*   - `page`      — 1-based page index (default `1`)
	*
	* **Response** (server → dashboard):
	* - Content-Type: `application/json`
	* - Body: see {@link EventsResponse}
	* ```json
	* {
	*   "events":     TrackerEvent[],
	*   "total":      number,
	*   "page":       number,
	*   "limit":      number,
	*   "nextCursor": string | undefined
	* }
	* ```
	*
	* @example `'https://api.myapp.com/tracker/events'`
	*/
	readEndpoint?: string

	/**
	* Optional URL used by the dashboard health check (`GET /ping`).
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
	* @default 10
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
}

/**
* WebSocket transport configuration — used when `mode = 'websocket'`.
*
* @remarks
* Mutually exclusive with `writeEndpoint` and `readEndpoint`.
* All event ingestion and real-time push happen over the single
* WebSocket connection. The consumer backend must implement the
* tracker WebSocket protocol:
*
* - Browser → Server: `{ type: 'ingest', events: TrackerEvent[] }`
* - Server → Browser: `{ type: 'ack', saved: number }`
* - Server → Browser: `{ type: 'push', events: TrackerEvent[] }` (optional)
*
* @example `'wss://api.myapp.com/tracker/ws'`
*/
export interface WsStorageOptions {
	/**
	* Storage backend to use.
	*
	* @see {@link StorageMode}
	* @default 'auto'
	*/
	mode: 'websocket'

	/**
	* WebSocket endpoint URL used when `mode = 'websocket'`.
	*
	* @remarks
	* The browser opens a single persistent WebSocket connection to this URL
	* used for both ingest and dashboard real-time push.
	*
	* **Protocol — messages are JSON strings:**
	*
	* Browser → Server (ingest):
	* ```json
	* { "type": "ingest", "events": TrackerEvent[] }
	* ```
	*
	* Server → Browser (ack):
	* ```json
	* { "type": "ack", "saved": number }
	* ```
	*
	* Server → Browser (real-time push to dashboard, optional):
	* ```json
	* { "type": "push", "events": TrackerEvent[] }
	* ```
	*
	* Dashboard → Server (query):
	* ```json
	* { "type": "events:query", "reqId": string, "query": EventsQuery }
	* ```
	*
	* Server → Browser (query response):
	* ```json
	* { "type": "events:response", "reqId": string, "response": EventsResponse }
	* ```
	*
	* @example `'wss://api.myapp.com/tracker/ws'`
	*/
	wsEndpoint: string

	/**
	* Optional URL used by the dashboard health check (`GET /ping`).
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
	* Maximum number of events accumulated client-side before flushing.
	*
	* @remarks
	* The queue flushes when `batchSize` **or** `flushInterval` is reached first.
	* On page unload, remaining events are flushed via `navigator.sendBeacon`.
	*
	* @default 10
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
}

/**
* Configuration for the event storage and transport layer.
*
* @remarks
* All fields are optional. Safe defaults apply for each storage mode so
* minimal configuration is needed for local development.
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
* import { trackerPlugin } from 'vite-plugin-tracker'
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
	* When `false`, the plugin is completely disabled — no script is injected
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
	* When `true` (default), the plugin injects the tracker client script into
	* the `<head>` of index.html and calls `initTracker()` automatically. The
	* tracker is active from the very first line of application code.
	*
	* When `false`, nothing is injected into index.html. The consumer is
	* responsible for importing and calling `initTracker()` manually at the
	* appropriate point in the application lifecycle:
	*
	* ```ts
	* import { tracker } from '@ndriadev/vite-plugin-monitor/client'
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
	* @default true
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
	* @default true
	*/
	http?: boolean | HttpTrackOptions

	/**
	* Enable unhandled JavaScript error tracking.
	*
	* @remarks
	* Captures `window.onerror` (synchronous) and `unhandledrejection` (promise).
	* Errors caught by `try/catch` are not captured automatically.
	*
	* @default true
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
	* @default true
	*/
	navigation?: boolean

	/**
	* Enable Web Vitals performance tracking.
	*
	* @remarks
	* Uses `PerformanceObserver` with `buffered: true`. Captures FCP, LCP,
	* FID, CLS, TTFB, INP. Falls back gracefully in unsupported browsers.
	*
	* @default true
	*/
	performance?: boolean

	/**
	* Enable console method interception.
	*
	* @remarks
	* - `false` - disabled (default). No methods are patched.
	* - `true` - intercept all 19 methods with safe defaults.
	* - {@link ConsoleTrackOptions} - restrict methods, tune limits, configure stacks.
	*
	* Disabled by default because existing codebases may log sensitive data
	* without expecting it to be sent to a remote backend.
	*
	* @default false
	*/
	console?: boolean | ConsoleTrackOptions

	/**
	* Function that resolves the current user's identifier at event emission time.
	*
	* @remarks
	* Called **lazily** just before each event is enqueued - not at initialization.
	* Return `null` to fall back to anonymous `sessionId`-based tracking.
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
	* @default ['/_monitor']
	* @example `['/_monitor', '/health', '/ping', 'analytics.google.com']`
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
	* Pipeline: read raw body → parse JSON → redact sensitive keys → re-serialize
	* → truncate to `maxBodySize`. `ReadableStream` bodies → `'[ReadableStream]'`.
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
	* @default `[{ format: 'json', path: './logs/monitor.log', rotation: { strategy: 'daily', maxFiles: 30 } }]`
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
	* `./logs/monitor.log` → `./logs/monitor-2024-03-15.log`
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
	* @default true
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
	* @default '/_monitor'
	*/
	route?: string

	/**
	* Basic authentication credentials for the dashboard login gate.
	*
	* @remarks
	* Validated client-side via `sessionStorage`. Suitable for dev/staging friction,
	* not for production security. For production, protect the route at the proxy level.
	*
	* @default `{ username: 'admin', password: 'tracker' }`
	*/
	auth?: { username: string; password: string }

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
* The overlay is a Shadow DOM–isolated widget showing a live event feed and
* basic session stats. Only mounted in dev/preview unless explicitly enabled
* in production.
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
	* @default true in dev/preview, false in production build
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
	* Length bounded by {@link StorageOptions.batchSize} (default 10) for timer-triggered
	* flushes. On page unload (`sendBeacon`), the entire remaining queue is sent.
	*/
	events: TrackerEvent[]
}

/**
* Query parameters accepted by the `GET /events` endpoint.
*
* @remarks
* All fields are optional - omitting a field means no constraint on that dimension.
* Multiple fields combine with logical AND.
*
* Two pagination strategies are supported:
* - **Offset pagination** - use `page` + `limit` for static reports.
* - **Cursor pagination** - use `after` for live dashboard polling to avoid result shifting.
*
*/
export interface EventsQuery {
	/**
	* Return only events with `timestamp >= since`. ISO 8601 UTC string.
	*
	* @example `'2024-03-15T00:00:00.000Z'`
	*/
	since?: string

	/**
	* Return only events with `timestamp <= until`. ISO 8601 UTC string.
	*
	* @example `'2024-03-15T23:59:59.999Z'`
	*/
	until?: string

	/**
	* Cursor for incremental live polling: return only events with `timestamp > after`.
	*
	* @remarks
	* Pass the `timestamp` of the most recently received event. On the first poll
	* (or after `PollHandle.resetCursor()`), omit this field - the backend returns
	* the most recent `limit` events.
	*
	* @example `'2024-03-15T10:23:45.123Z'`
	*/
	after?: string

	/**
	* Return only events with `timestamp < before`. ISO 8601 UTC string.
	*
	* @remarks
	* Used for backwards pagination. Typically combined with `limit` and `page`.
	*/
	before?: string

	/**
	* Filter by event category.
	*
	* @see {@link TrackerEventType}
	*/
	type?: TrackerEventType

	/**
	* Filter by severity level.
	*
	* @see {@link LogLevel}
	*/
	level?: LogLevel

	/**
	* Filter by `TrackerEvent.userId`. Exact match.
	*/
	userId?: string

	/**
	* Filter by `TrackerEvent.sessionId`. Exact match.
	*
	* @remarks
	* Useful for reconstructing a single tab's session timeline.
	*/
	sessionId?: string

	/**
	* Filter by `TrackerEvent.groupId`. Exact match.
	*
	* @remarks
	* Returns all events belonging to a specific logical group from `tracker.group('label')`.
	*/
	groupId?: string

	/**
	* Filter by `TrackerEvent.appId`. Useful on shared multi-app backends.
	*/
	appId?: string

	/**
	* Full-text search term matched against the serialized event payload.
	*
	* @remarks
	* The standalone server performs a case-insensitive `JSON.stringify().includes(term)` scan.
	* An external backend should use a proper text index for performance.
	*/
	search?: string

	/**
	* Maximum number of events per response. Backend enforces an internal cap (typically 500).
	*
	* @default 100
	*/
	limit?: number

	/**
	* 1-based page index for offset pagination. Prefer cursor (`after`) for live feeds.
	*
	* @default 1
	*/
	page?: number
}

/**
* Response body the dashboard expects from {@link HttpStorageOptions.readEndpoint} or {@link WsStorageOptions.wsEndpoint}.
*
* @remarks
* The full HTTP contract is:
*
* ```
* GET <readEndpoint>?since=...&until=...&after=...&type=...&limit=...&page=...
* Accept: application/json
* X-Tracker-Key: <apiKey>          (optional)
* ```
*
* The server must respond with `Content-Type: application/json` and this shape.
* See {@link EventsQuery} for the full list of supported query parameters.
*/
export interface EventsResponse {
	/**
	* Page of events matching the query, sorted newest-first.
	*
	* @remarks
	* May be empty if no events match. Length bounded by `limit` (default 100).
	*/
	events: TrackerEvent[]

	/**
	* Total count of matching events across all pages.
	*
	* @remarks
	* Used to compute page count: `Math.ceil(total / limit)`.
	*/
	total: number

	/**
	* Current page index (1-based), mirroring the `page` query parameter.
	*/
	page: number

	/**
	* Events per page, mirroring the `limit` query parameter.
	*/
	limit: number

	/**
	* Timestamp of the newest event in this response, to be used as the `after`
	* cursor on the next polling request.
	*
	* @remarks
	* Absent when the response is empty. The poller should retain the previous
	* cursor when `nextCursor` is absent.
	*
	* @example `'2024-03-15T10:23:45.123Z'`
	*/
	nextCursor?: string
}

/**
* Fully resolved storage configuration produced internally by `resolveOptions()`.
*
* @remarks
* All optional fields from {@link StorageOptions} are replaced with concrete values.
* `mode` is never `'auto'` - already expanded to the effective mode.
*
* **Internal** - not part of the public API.
*
* @internal
*/
export type ResolvedStorage =
	| {
		/**
		* Effective storage mode after `'auto'` expansion.
		*
		* @remarks
		* Never `'auto'`. In dev/preview `'auto'` → `'middleware'`;
		* in build it must have been explicitly set to `'http'`.
		*/
		mode: Exclude<StorageMode, 'websocket'>

		/**
		* Resolved write endpoint URL, trailing slashes stripped.
		*
		* @remarks
		* For `'standalone'` / `'middleware'` set to the internal server path.
		* For `'http'` mirrors `StorageOptions.writeEndpoint`.
		*/
		writeEndpoint: string

		/**
		* Resolved read endpoint full URL, trailing slashes stripped.
		*
		* @remarks
		* Derived from `StorageOptions.readEndpoint`, or by stripping `/events`
		* from `writeEndpoint` if `readEndpoint` was not set.
		*/
		readEndpoint: string

		/** Ping endpoint URL, or empty string if not configured. */
		pingEndpoint: string

		wsEndpoint: ''

		/** API key, or empty string if authentication is disabled. */
		apiKey: string

		/**
		* TCP port for the standalone server. Only meaningful when `mode === 'standalone'`.
		*
		* @default 4242
		*/
		port: number

		/** Maximum events per client-side queue flush. @default 10 */
		batchSize: number

		/** Maximum milliseconds between automatic flushes. @default 3000 */
		flushInterval: number
	}
	| {
		mode: 'websocket'

		/** WebSocket endpoint URL, or empty string if not configured. */
		wsEndpoint: string

		/** Ping endpoint URL, or empty string if not configured. */
		pingEndpoint: string

		writeEndpoint: ''

		readEndpoint: ''

		/** API key, or empty string if authentication is disabled. */
		apiKey: string

		port: number

		/** Maximum events per client-side queue flush. @default 10 */
		batchSize: number

		/** Maximum milliseconds between automatic flushes. @default 3000 */
		flushInterval: number
	}

/**
* Fully resolved plugin configuration with all defaults applied.
*
* @remarks
* Produced by `resolveOptions()` and passed throughout plugin internals.
* Every field is always present - no optional fields, no `undefined`.
*
* **Internal** - not part of the public API.
*
* @internal
*/
export type ResolvedTrackerOptions = {
	/** Whether the plugin is active. When `false` all hooks are no-ops. */
	enabled: boolean

	/** Application identifier - always a non-empty string. */
	appId: string

	/** @see {@link ResolvedStorage} */
	storage: ResolvedStorage

	/**
	* Whether to automatically inject and initialize the tracker client
	* in index.html. @default `true`
	*/
	autoInit: boolean

	track: {
		clicks: boolean
		http: boolean | HttpTrackOptions
		errors: boolean
		navigation: boolean
		performance: boolean
		console: boolean | ConsoleTrackOptions | false
		/**
		* Resolved userId function - always present, returns `null` when
		* not configured by the consumer.
		*/
		userId: () => string | null
		level: LogLevel
		ignoreUrls: string[]
	}

	/**
	* Logging configuration with defaults applied.
	* `NonNullable` ensures no field is ever undefined after resolution.
	*/
	logging: NonNullable<TrackerPluginOptions['logging']>

	/**
	* All dashboard fields required - defaults applied by `resolveOptions()`.
	*/
	dashboard: Required<NonNullable<TrackerPluginOptions['dashboard']>>

	/**
	* All overlay fields required - defaults applied by `resolveOptions()`.
	*/
	overlay: Required<NonNullable<TrackerPluginOptions['overlay']>>
}

interface TrackerConfigCommon {
	track: {
		/** Whether click tracking is active. @default `true` */
		clicks: boolean

		/**
		* HTTP tracking configuration.
		*
		* @remarks
		* `false` disables tracking. `true` enables with safe defaults.
		* `Record<string, unknown>` is the JSON-serialized form of {@link HttpTrackOptions}.
		*/
		http: boolean | HttpTrackOptions

		/** Whether error tracking is active. @default `true` */
		errors: boolean

		/** Whether navigation tracking is active. @default `true` */
		navigation: boolean

		/** Whether Web Vitals tracking is active. @default `true` */
		performance: boolean

		/**
		* Console tracking configuration.
		*
		* @remarks
		* `false` disables tracking (default). `true` enables with safe defaults.
		* `Record<string, unknown>` is the JSON-serialized form of {@link ConsoleTrackOptions}.
		*/
		console: boolean | ConsoleTrackOptions

		/**
		* Minimum severity level for events emitted by automatic trackers.
		*
		* @remarks
		* Stored as a plain string after JSON serialization - not a {@link LogLevel}
		* branded type. The client re-validates the value at runtime.
		*
		* @default `'info'`
		*/
		level: string

		/**
		* URL substrings that cause HTTP requests to be silently ignored.
		*
		* @see {@link TrackOptions.ignoreUrls}
		* @default `[]`
		*/
		ignoreUrls: string[]
	}

	dashboard: {
		/** Whether the dashboard is enabled. @default `true` */
		enabled: boolean

		/**
		* URL pathname at which the dashboard is served.
		*
		* @default `'/_dashboard'`
		*/
		route: string

		/**
		* Polling interval in milliseconds between dashboard data fetches.
		*
		* @default `3000`
		*/
		pollInterval: number

		/**
		* Login credentials for the dashboard login gate.
		*
		* @see {@link DashboardOptions.auth}
		*/
		auth: { username: string; password: string }
	}

	overlay: {
		/** Whether the debug overlay widget is visible. */
		enabled: boolean

		/**
		* Corner of the viewport where the overlay FAB is anchored.
		*
		* @default `'bottom-right'`
		*/
		position: string
	}
}

/**
* Runtime configuration object passed directly to `tracker.init()`.
*
* @remarks
* Represents the fully resolved plugin configuration.
*
* This type uses looser field types than {@link ResolvedTrackerOptions}
* (e.g. `http` is `boolean | Record<string, unknown>` rather than
* `boolean | HttpTrackOptions`) because the config is serialized through
* `JSON.stringify` before reaching the browser - class instances and
* branded types are not preserved across serialization.
*
* **Not intended to be constructed manually** - always produced by the
* plugin's code generator. Exposed publicly so consumers can type the
* argument when wrapping `initTracker()` in their own initialization logic.
*
* @example
* ```ts
* import { initTracker } from 'virtual:vite-tracker-client'
* import type { TrackerConfig } from 'vite-plugin-tracker'
*
* function bootstrap(config: TrackerConfig) {
*   if (import.meta.env.PROD) {
*     initTracker(config, () => store.getState().userId)
*   }
* }
* ```
*
*/
export type TrackerConfig = TrackerConfigCommon & (
	| {
		mode: Exclude<StorageMode, 'websocket'>

		/**
		* Application identifier. Attached to every {@link TrackerEvent} as `appId`.
		*
		* @example `'storefront'`, `'backoffice'`
		*/
		appId: string

		/**
		* URL that receives batched events via HTTP POST.
		*
		* @remarks
		* Resolved from {@link StorageOptions.writeEndpoint} with trailing slash stripped.
		*/
		writeEndpoint: string

		/**
		* Full URL the dashboard SPA uses to query events and build metrics and stats.
		*
		* @remarks
		* Resolved from {@link StorageOptions.readEndpoint}.
		*/
		readEndpoint: string

		/** Optional ping endpoint for health check. Empty string if not configured. */
		pingEndpoint: string

		wsEndpoint: ''

		/**
		* API key sent as the `X-Tracker-Key` header on every client request.
		*
		* @remarks
		* Empty string `''` when authentication is disabled.
		*/
		apiKey: string

		/**
		* Maximum number of events accumulated before an automatic flush.
		*
		* @see {@link StorageOptions.batchSize}
		* @default `10`
		*/
		batchSize: number

		/**
		* Maximum time in milliseconds between automatic queue flushes.
		*
		* @see {@link StorageOptions.flushInterval}
		* @default `3000`
		*/
		flushInterval: number
	}
	| {
		mode: 'websocket'

		appId: string

		/** WebSocket endpoint URL, or empty string if not configured. */
		wsEndpoint: string

		/** Optional ping endpoint for health check. Empty string if not configured. */
		pingEndpoint: string

		writeEndpoint: ''

		readEndpoint: ''

		/**
		* API key sent as the `X-Tracker-Key` header on every client request.
		*
		* @remarks
		* Empty string `''` when authentication is disabled.
		*/
		apiKey: string

		/**
		* Maximum number of events accumulated before an automatic flush.
		*
		* @see {@link StorageOptions.batchSize}
		* @default `10`
		*/
		batchSize: number

		/**
		* Maximum time in milliseconds between automatic queue flushes.
		*
		* @see {@link StorageOptions.flushInterval}
		* @default `3000`
		*/
		flushInterval: number
	})

/**
* Public contract of the tracker client.
*
* @remarks
* Implemented by {@link TrackerClient}. Exposed as an interface so consumers
* can mock or extend the tracker in tests without depending on the concrete class.
*
* All methods are safe to call before `initTracker()` via the {@link tracker}
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
	* tracker.timeEnd('api:fetchCart', { itemCount: 3 }) // → emits with duration: 312
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
	* all subsequent calls until `initTracker()` is called again.
	*/
	destroy(): void
}

/**
* Type of the public {@link tracker} singleton object.
*
* @remarks
* Single entry point for all tracker operations in the browser.
* Must be initialized once via {@link tracker.init} before any other
* method is called. All methods are safe to call before initialization -
* they are silently dropped until `init()` has run.
*
*
* @example
* ```ts
* // Setup (when `autoInit: false`):**
* import { tracker } from 'vite-plugin-tracker/client'
* tracker.init(config, () => store.getState().userId)
* ```
* ```ts
* tracker.track('checkout:complete', { orderId: 'ORD-99' })
* tracker.setUser('user_42', { attributes: { plan: 'pro' } })
*
*/
export type Tracker = {
	/**
	* Initialize the tracker with the provided configuration.
	*
	* @remarks
	* Safe to call multiple times - subsequent calls are no-ops that return
	* the existing instance (singleton). Returns `null` in non-browser
	* environments (SSR).
	*
	* When `autoInit: true` (default), this is called automatically by the
	* script injected into `index.html` by the plugin and does not need to
	* be called manually.
	*
	* When `autoInit: false`, this must be called explicitly at the
	* appropriate point in the application lifecycle - for example after
	* a user consent dialog, after authentication, or only in specific
	* environments:
	*
	* ```ts
	* import { tracker } from 'vite-plugin-tracker/client'
	*
	* // Call once, as early as possible in your app entry point
	* tracker.init(config, () => authStore.userId)
	* ```
	*
	* @param userIdFn  - Function called lazily at each event emission to
	*                    resolve the current user identifier. Return a string
	*                    to identify the user, or `null` to fall back to the
	*                    session ID.
	* @returns The initialized {@link ITrackerClient} instance, or `null` in SSR.
	*/
	init(userIdFn?: () => string | null): void
	/**
	* Track a named custom event with optional data and options.
	*
	* @remarks
	* No-op if called before `tracker.init()`. Events are queued in memory
	* and flushed to the backend in batches according to `batchSize` and
	* `flushInterval` configuration.
	*
	* @param name - Event name. Recommend a consistent `domain:action`
	*               naming convention for queryability in the dashboard.
	* @param data - Arbitrary structured JSON-serializable data attached
	*               to the event. Avoid including sensitive fields - no
	*               automatic redaction is applied to custom events.
	* @param opts - Optional overrides for level, groupId, and one-off context.
	*
	* @example
	* tracker.track('purchase', { orderId: 'ORD-123', amount: 99.99 })
	* tracker.track('form:error', { field: 'email' }, { level: 'warn' })
	*/
	track(name: string, data?: Record<string, unknown>, opts?: TrackEventOptions): void
	/**
	* Start a named performance timer.
	*
	* @remarks
	* No-op if called before `tracker.init()` or if `performance` is
	* unavailable. If a timer with the same label is already running,
	* logs a warning and does nothing.
	*
	* @param label - Unique identifier for this timer. Use the same label
	*                in the matching `timeEnd()` call.
	*
	* @example
	* tracker.time('api:fetchProducts')
	* const products = await fetchProducts()
	* tracker.timeEnd('api:fetchProducts', { count: products.length })
	*/
	time(label: string): void
	/**
	* Stop a named timer and emit a custom event with the measured duration.
	*
	* @remarks
	* No-op if called before `tracker.init()`. If the label was never
	* started via `time()`, logs a warning and returns `-1`.
	*
	* Duration is computed as `Math.round(performance.now() - startTime)`
	* and attached to the event payload as `duration` (milliseconds).
	*
	* @param label - Same string passed to the matching `time()` call.
	* @param data  - Additional data to attach to the emitted event.
	* @param opts  - Optional overrides for level, groupId, and context.
	* @returns Elapsed time in milliseconds, or `-1` if the timer was not found.
	*
	* @example
	* tracker.timeEnd('api:fetchProducts', { count: 42 })
	* // → emits custom event 'api:fetchProducts' with duration: 312
	*/
	timeEnd(label: string, data?: Record<string, unknown>, opts?: TrackEventOptions): number
	/**
	* Update the current user identity and optional profile attributes.
	*
	* @remarks
	* No-op if called before `tracker.init()`. All events emitted after
	* this call will carry the new `userId` and `userAttributes` in
	* `EventMeta`. Changes take effect immediately - no page reload required.
	*
	* Pass `null` to revert to an anonymous session-scoped identifier
	* (e.g. after logout). The previous userId is removed from
	* `sessionStorage` and a new anonymous ID is generated.
	*
	* @param userId - New user identifier, or `null` to clear.
	* @param opts   - Optional user attributes to attach to subsequent events.
	*                 Avoid storing PII or secrets here.
	*
	* @example
	* // After login
	* tracker.setUser('user-456', { attributes: { plan: 'pro', role: 'admin' } })
	*
	* // After logout
	* tracker.setUser(null)
	*/
	setUser(userId: string | null, opts?: SetUserOptions): void
	/**
	* Set or update persistent context attributes merged into every
	* subsequent event until explicitly cleared.
	*
	* @remarks
	* No-op if called before `tracker.init()`. The context is a shallow
	* key-value map maintained in the {@link TrackerSession}. It is merged
	* into `TrackerEvent.context` at event construction time.
	*
	* Pass `null` as a value to remove a specific key from the context:
	* `tracker.setContext({ abTest: null })`.
	*
	* Useful for cross-cutting concerns: A/B test variant, feature flags,
	* tenant identifier, locale.
	*
	* @param attrs - Key-value pairs to merge into the persistent context.
	*                Values of `null` remove the corresponding key.
	*
	* @example
	* tracker.setContext({ tenant: 'acme', abTest: 'checkout-v2' })
	*
	* // Later - remove abTest without affecting other keys
	* tracker.setContext({ abTest: null })
	*/
	setContext(attrs: Record<string, unknown>): void
	/**
	* Generate a unique group ID to correlate related events in the dashboard.
	*
	* @remarks
	* Returns an offline placeholder (`grp_<name>_offline`) if called before
	* `tracker.init()` - the placeholder is not queryable in the dashboard
	* but prevents runtime errors in code that uses the return value immediately.
	*
	* Pass the returned ID as `groupId` in subsequent `track()` calls to
	* link all events belonging to the same logical flow. All events sharing
	* the same `groupId` can be filtered together via {@link EventsQuery.groupId}.
	*
	* @param name - Descriptive label for the group, used as part of the ID.
	* @returns A unique group ID string.
	*
	* @example
	* const checkoutId = tracker.group('checkout')
	* tracker.track('step:address',  {}, { groupId: checkoutId })
	* tracker.track('step:payment',  {}, { groupId: checkoutId })
	* tracker.track('step:complete', { orderId: 'ORD-9' }, { groupId: checkoutId })
	*/
	group(name: string): string
	/**
	* Tear down the tracker instance and release all resources.
	*
	* @remarks
	* No-op if called before `tracker.init()`. After calling `destroy()`,
	* all subsequent method calls on `tracker` will be silently dropped
	* until `tracker.init()` is called again.
	*
	* Performs the following cleanup:
	* - Removes all event listeners registered by the automatic trackers
	*   (click, http, error, navigation, performance, console).
	* - Destroys the overlay widget and removes it from the DOM.
	* - Clears all active `time()` timers.
	* - Flushes any remaining queued events to the backend synchronously
	*   via `navigator.sendBeacon`.
	*
	* @example
	* // In a test teardown or hot-module replacement handler
	* tracker.destroy()
	*/
	destroy(): void
}

/**
* Floating debug overlay widget rendered inside a Shadow DOM.
*
* @remarks
* Instantiated by {@link TrackerClient._mountOverlay} after `DOMContentLoaded`.
* The overlay shows session identity (userId, sessionId, appId), browser context
* (route, viewport, language, connection), and a link to the full dashboard.
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
	* Called by {@link TrackerClient} after every event is enqueued. Currently
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
	* Called by {@link TrackerClient.setUser} whenever the userId changes
	* programmatically, so the overlay always reflects the current identity.
	*/
	refreshUserId(): void
}

/**
* A cleanup callback registered with `registerShutdownHook()`.
*
* @remarks
* Can be synchronous or return a `Promise`. All registered hooks run
* **concurrently** via `Promise.allSettled` on shutdown signal, subject to
* the 5-second global deadline.
*
* Hooks must be **idempotent** - they may be called once per signal received
* and the shutdown module guards against double-invocation, but defensive
* implementations are safer under HMR.
*
* @example
* ```ts
* const unregister = registerShutdownHook(async () => {
*   await logger.destroy()   // flush writes, close streams
*   server.close()           // stop accepting connections
* })
* ```
*
*/
export type CleanupFn = () => Promise<void> | void

declare global {
	interface Window {
		/** @internal Injected and frozen by the plugin. Do not modify. */
		readonly __TRACKER_CONFIG__: TrackerConfig
		/** @internal Set once by TrackerClient. Do not modify. */
		__tracker_instance__?: Tracker
	}

	/**
	* Array of registered shutdown callbacks stored on `globalThis`.
	*
	* @remarks
	* Stored on `globalThis` (not module scope) so the array survives HMR
	* re-evaluations of `shutdown.ts` without losing previously registered hooks.
	* Initialized lazily to an empty array on first access.
	*/
	// eslint-disable-next-line no-var
	var __tracker_shutdown_hooks__: Array<CleanupFn> | undefined

	/**
	* Guard flag that prevents signal handlers from being registered more than once.
	*
	* @remarks
	* Set to `true` the first time `registerShutdownHook()` installs the signal
	* handlers (`SIGTERM`, `SIGINT`, `SIGHUP`). Subsequent HMR re-evaluations
	* see this flag and skip re-registration, preventing duplicate handler stacking.
	*/
	// eslint-disable-next-line no-var
	var __tracker_shutdown_installed__: boolean | undefined
}

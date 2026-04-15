# Trackers

The `track` option controls which browser interactions are automatically captured. All trackers are opt-in except `console`, which is enabled by default.

```typescript
trackerPlugin({
  appId: 'my-app',
  track: {
    clicks:     true,
    http:       true,
    errors:     true,
    navigation: true,
    console:    true, // default
    userId:     () => localStorage.getItem('userId'),
    level:      'info',
  },
})
```

## Default Values

| Option | Default |
|--------|---------|
| `clicks` | `false` |
| `http` | `false` |
| `errors` | `false` |
| `navigation` | `false` |
| `console` | `true` |
| `level` | `'info'` |

---

## `track.clicks`

**Type:** `boolean | ClickTrackOptions` · **Default:** `false`

Enables click tracking via a single passive delegated listener on `document`. No per-element binding — zero DOM overhead.

**Captured data ([`ClickPayload`](/reference/event-types#click)):**
- Element tag name (`button`, `a`, `div`, etc.)
- Visible text content (up to 100 chars)
- `id` attribute
- `classes`
- `xpath`
- `coordinates`

**Simple enable:**

```typescript
track: {
  clicks: true,
}
```

**Fine-grained control with `ClickTrackOptions`:**

```typescript
track: {
  clicks: {
    ignoreRoutes:    ['/admin', /^\/user\/\d+/],
    ignoreSelectors: ['[data-no-track]', '#cookie-banner'],
  },
}
```

### `ClickTrackOptions` Reference

#### `ignoreRoutes`
**Type:** `(string | RegExp)[]` · **Default:** `[]`

Route patterns where click tracking is suppressed. Checked against `window.location.pathname` at click-time.

- Plain strings are matched via **strict equality**.
- `RegExp` objects are tested against the full pathname.

The dashboard route is **always** injected automatically — you do not need to add it here. Query parameters are not included in the pathname check; use `ignoreSelectors` to filter by DOM attributes instead.

```typescript
ignoreRoutes: ['/admin', /^\/user\/\d+/, '/checkout']
```

#### `ignoreSelectors`
**Type:** `string[]` · **Default:** `[]`

CSS selectors whose matching elements (or their ancestors) suppress click tracking. At click-time the tracker walks up the DOM from the event target using `Element.closest()`.

The overlay host selector `[data-tracker-overlay]` is **always** injected automatically — you do not need to add it here.

```typescript
ignoreSelectors: ['[data-no-track]', '#cookie-banner', '.dev-toolbar']
```

::: info Dashboard self-exclusion
The dashboard route is automatically added to the click tracker's ignored paths. Dashboard UI interactions are never self-tracked.
:::

---

## `track.http`

**Type:** `boolean | HttpTrackOptions` · **Default:** `false`

Patches `window.fetch` and `XMLHttpRequest` to intercept all HTTP requests and responses.

**Simple enable (method + URL + status + duration):**

```typescript
track: {
  http: true,
}
```

**Fine-grained control with `HttpTrackOptions`:**

```typescript
track: {
  http: {
    captureRequestHeaders:  true,
    captureRequestBody:     true,
    captureResponseHeaders: false,
    captureResponseBody:    false,
    excludeHeaders:         ['x-internal-trace-id'],
    redactKeys:             ['fiscalCode', 'vatNumber'],
    maxBodySize:            4096,
  },
}
```

### `HttpTrackOptions` Reference

#### `captureRequestHeaders`
**Type:** `boolean` · **Default:** `false`

Capture sanitized request headers. Sensitive headers are **always stripped** regardless of this setting.

**Always-redacted request headers:**
`authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`, `x-access-token`, `x-csrf-token`, `x-session-token`, `proxy-authorization`, `www-authenticate`

#### `captureRequestBody`
**Type:** `boolean` · **Default:** `false`

Capture and auto-redact the request body. The pipeline is: read → parse JSON → redact sensitive keys → re-serialize → truncate to `maxBodySize`.

For `fetch`, the request body is cloned. For XHR, the `send()` argument is captured directly.

#### `captureResponseHeaders`
**Type:** `boolean` · **Default:** `false`

Capture sanitized response headers. `Set-Cookie` is **always stripped**.

#### `captureResponseBody`
**Type:** `boolean` · **Default:** `false`

Capture and auto-redact the response body. Uses `response.clone()` so the original `Response` object is **never consumed** — your application code still receives the full response.

#### `excludeHeaders`
**Type:** `string[]` · **Default:** `[]`

Additional header names to strip (case-insensitive). These are merged with the built-in sensitive header list.

```typescript
excludeHeaders: ['x-internal-trace-id', 'x-company-id']
```

#### `redactKeys`
**Type:** `string[]` · **Default:** `[]`

Additional JSON body key patterns to redact (case-insensitive substring match). Applied **recursively** to nested objects and arrays.

**Built-in always-redacted keys:** `password`, `passwd`, `pwd`, `token`, `secret`, `apikey`, `api_key`, `auth`, `credential`, `ssn`, `fiscal`, `taxcode`, `cvv`, `cvc`, `card`, `iban`, `bic`, `swift`, `private`, `signing`,

```typescript
redactKeys: ['fiscalCode', 'vatNumber', 'nationalId', 'pinCode']
```

#### `maxBodySize`
**Type:** `number` · **Default:** `2048`

Maximum byte length of the stored body string after redaction. Bodies exceeding this limit are truncated with a `...[truncated ${N}B]` suffix. Set to `0` to disable truncation (not recommended for production).

---

## `track.errors`

**Type:** `boolean | ErrorTrackOptions` · **Default:** `false`

Hooks into two global browser error handlers:

1. **`window.onerror`** — synchronous JavaScript errors (`throw new Error(...)`, reference errors, type errors, etc.)
2. **`window.addEventListener('unhandledrejection')`** — Promises that are rejected and never `.catch()`-ed

::: warning `try/catch` errors are NOT captured
The error tracker only captures **unhandled** errors. If you wrap your code in `try/catch`, those errors are invisible to the tracker. Use [`tracker.track()`](/client-api/track) to manually emit caught errors.
:::

**Captured data ([`ErrorPayload`](/reference/event-types#error)):**
- Error message
- Stack trace (when available — may be absent for cross-origin errors)
- Source file, line number, column number (synchronous errors only)
- Error type (`TypeError`, `ReferenceError`, `UnhandledRejection`, etc.)

**Simple enable:**

```typescript
track: {
  errors: true,
}
```

**Fine-grained control with `ErrorTrackOptions`:**

```typescript
track: {
  errors: {
    ignoreMessages: [
      'ResizeObserver loop limit exceeded',
      /^Script error\.?$/,
    ],
  },
}
```

### `ErrorTrackOptions` Reference

#### `ignoreMessages`
**Type:** `(string | RegExp)[]` · **Default:** `[]`

Patterns matched against the error message. Errors whose message matches any entry are silently dropped before being enqueued.

- Plain strings are matched via **strict equality**.
- `RegExp` objects are tested against the full message string.

Classic use-case: suppressing noise from browser extensions.

```typescript
ignoreMessages: [
  'ResizeObserver loop limit exceeded',
  'Script error.',
  /^ChunkLoadError:/,
]
```

---

## `track.navigation`

**Type:** `boolean | NavigationTrackOptions` · **Default:** `false`

Intercepts all client-side navigation triggers. Compatible with all major SPA routers (React Router, Vue Router, TanStack Router, etc.).

**Six interceptors are installed:**

| Interceptor | Triggers on |
|-------------|-------------|
| `history.pushState` patch | `router.push()`, `<Link>` clicks |
| `history.replaceState` patch | `router.replace()`, silent URL rewrites |
| `popstate` listener | Browser back/forward, `history.go()` |
| `hashchange` listener | `#anchor` changes without full reload |
| `<a>` click interceptor (capture phase) | Same-origin anchor clicks before MPA navigation — saves the current route to `sessionStorage` so the next page can report an accurate `from` value |
| Inline emit at setup time | Initial page load — the `'load'` navigation event is emitted synchronously when the tracker installs, not in response to a DOM `load` event |

**Captured data ([`NavigationPayload`](/reference/event-types#navigation)):**
- `from` — previous route (pathname + search)
- `to` — new route (pathname + search)
- `trigger` — what caused the navigation
- `duration` — time spent on the previous route (ms)

**Simple enable:**

```typescript
track: {
  navigation: true,
}
```

**Fine-grained control with `NavigationTrackOptions`:**

```typescript
track: {
  navigation: {
    ignoreRoutes: ['/admin', /^\/user\/\d+/],
    ignoreTypes:  ['hashchange', 'replaceState'],
  },
}
```

### `NavigationTrackOptions` Reference

#### `ignoreRoutes`
**Type:** `(string | RegExp)[]` · **Default:** `[]`

Route patterns where navigation tracking is suppressed. A navigation is suppressed when **either** the `from` **or** the `to` path matches one of these patterns.

- Plain strings are matched via **strict equality**.
- `RegExp` objects are tested against the full path including search string (e.g. `/users?page=2`).

The dashboard route is **always** injected automatically — you do not need to add it here.

```typescript
ignoreRoutes: ['/admin', /^\/user\/\d+/, '/checkout']
```

#### `ignoreTypes`
**Type:** `Array<'pushState' | 'replaceState' | 'popstate' | 'hashchange'>` · **Default:** `[]`

Navigation trigger types to suppress. Only navigation events whose `trigger` is **not** in this list are tracked.

::: info `'load'` cannot be suppressed
The initial page load event (`trigger: 'load'`) is always emitted regardless of this option.
:::

| Value | Cause |
|-------|-------|
| `'pushState'` | `history.pushState()` — typical SPA link click |
| `'replaceState'` | `history.replaceState()` — silent URL rewrite |
| `'popstate'` | Browser back/forward button |
| `'hashchange'` | Anchor `#fragment` change |

```typescript
ignoreTypes: ['hashchange', 'replaceState']
```

---

## `track.console`

**Type:** `boolean | ConsoleTrackOptions` · **Default:** `true`

Intercepts `console.*` method calls. All 19 standard console methods are captured by default.

**Simple enable (all 19 methods):**
```typescript
track: {
  console: true, // default
}
```

**Disable entirely:**
```typescript
track: {
  console: false,
}
```

**Fine-grained with `ConsoleTrackOptions`:**
```typescript
track: {
  console: {
    methods:             ['error', 'warn', 'log'],
    maxArgLength:        1024,
    maxArgs:             5,
    captureStackOnError: true,
    ignorePatterns:      ['[vite]', '[HMR]', '[tracker]'],
  },
}
```

### `ConsoleTrackOptions` Reference

#### `methods`
**Type:** `ConsoleMethod[]` · **Default:** all 19 methods

Subset of console methods to intercept. Methods not listed are not patched and incur zero overhead.

All 19 supported methods: `log`, `info`, `warn`, `error`, `debug`, `trace`, `dir`, `dirxml`, `group`, `groupCollapsed`, `groupEnd`, `table`, `time`, `timeEnd`, `timeLog`, `assert`, `clear`, `count`, `countReset`

```typescript
methods: ['error', 'warn'] // only capture errors and warnings
```

#### `maxArgLength`
**Type:** `number` · **Default:** `1024`

Maximum character length for a single serialized argument. Values exceeding this limit are truncated with `'... [+${N}]'`.

#### `maxArgs`
**Type:** `number` · **Default:** `10`

Maximum number of arguments captured per console call. Arguments beyond this limit are replaced with a single `{ type: 'truncated', value: '\n…[+${N} chars]' }` sentinel entry appended to the `args` array.

#### `captureStackOnError`
**Type:** `boolean` · **Default:** `false`

Capture a stack trace for `console.error` calls. Note: `console.trace` always captures a stack regardless of this flag.

#### `ignorePatterns`
**Type:** `(string | RegExp)[]` · **Default:** `['[vite]', '[HMR]', '[tracker]']`

Substring patterns — calls whose **first argument** matches any pattern are completely ignored before serialization. Zero overhead for ignored calls.

---

## `track.userId`

**Type:** `() => string | null`

A function that returns the current user ID at init time. The result is used as the initial `userId` on all events.

```typescript
track: {
  userId: () => localStorage.getItem('userId'),
}
```

::: warning Must be a pure function
The `userId` function is **serialized to a string** (`.toString()`) and injected into `index.html` as part of the setup script. It must be a pure function with **no closures** over module-level variables at build time.

✅ **OK** — reads from browser globals:
```typescript
userId: () => window.__auth?.userId ?? null
userId: () => localStorage.getItem('userId')
userId: () => sessionStorage.getItem('user_id')
```

❌ **NOT OK** — references module variables (won't be available in the injected script):
```typescript
import { authStore } from './store'
userId: () => authStore.getState().userId  // Will break!
```

To update user identity after page load (login/logout), use [`tracker.setUser()`](/client-api/set-user) instead.
:::

---

## `track.level`

**Type:** `'debug' | 'info' | 'warn' | 'error'` · **Default:** `'info'`

Minimum log level for automatically-tracked events. Events below this threshold are **discarded before enqueueing** — they never reach the network or the server.

Level order: `debug < info < warn < error`

```typescript
track: {
  level: 'warn', // only warn and error events are tracked
}
```

::: info Does not affect `tracker.track()`
The `level` filter applies only to automatic trackers (clicks, HTTP, errors, navigation, console). Custom events emitted via `tracker.track()` bypass this filter and are always sent regardless of level.

Click and Navigation trackers always emit at `info` level.
:::

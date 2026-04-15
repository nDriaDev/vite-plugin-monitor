<div align="center">
<a href="https://vite-plugin-monitor.ndria.dev">
    <img src="https://raw.githubusercontent.com/nDriaDev/vite-plugin-monitor/main/src/resources/logo.png" alt="vite-plugin-monitor" width="180">
</a>
<br>

# vite-plugin-monitor

### Automatic User Interaction Tracking, Real-Time Dashboard & File Logging for Vite

[![npm version](https://img.shields.io/npm/v/%40ndriadev/vite-plugin-monitor?color=orange&style=for-the-badge)](https://www.npmjs.com/package/%40ndriadev/vite-plugin-monitor)
![npm bundle size](https://img.shields.io/bundlephobia/minzip/%40ndriadev%2Fvite-plugin-monitor?style=for-the-badge&label=SIZE&color=yellow)
[![npm downloads](https://img.shields.io/npm/dt/%40ndriadev/vite-plugin-monitor?label=DOWNLOADS&style=for-the-badge&color=red)](https://www.npmjs.com/package/%40ndriadev/vite-plugin-monitor)
[![License: MIT](https://img.shields.io/badge/LICENSE-MIT-blue.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

![Statements](https://img.shields.io/badge/statements-99.75%25-brightgreen.svg?style=for-the-badge)
![Branches](https://img.shields.io/badge/branches-92.47%25-green.svg?style=for-the-badge)
![Functions](https://img.shields.io/badge/functions-98.71%25-green.svg?style=for-the-badge)
![Lines](https://img.shields.io/badge/lines-100%25-brightgreen.svg?style=for-the-badge)

*Built with:*

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6.svg?style=for-the-badge&logo=TypeScript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-646CFF.svg?style=for-the-badge&logo=Vite&logoColor=white)](https://vitejs.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-6E9F18.svg?style=for-the-badge&logo=Vitest&logoColor=white)](https://vitest.dev/)
[![ESLint](https://img.shields.io/badge/ESLint-4B32C3.svg?style=for-the-badge&logo=ESLint&logoColor=white)](https://eslint.org/)

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Storage Modes](#-storage-modes)
- [Configuration](#-configuration)
  - [Plugin Options](#plugin-options)
  - [Track Options](#track-options)
  - [Storage Options](#storage-options)
  - [Logging Options](#logging-options)
  - [Dashboard Options](#dashboard-options)
  - [Overlay Options](#overlay-options)
- [Client API](#-client-api)
  - [Manual Initialization](#manual-initialization)
  - [tracker Object](#tracker-object)
- [Usage Examples](#-usage-examples)
  - [Zero-Config Dev Setup](#zero-config-dev-setup)
  - [HTTP Mode (Production)](#http-mode-production)
  - [WebSocket Mode](#websocket-mode)
  - [Custom User Identity](#custom-user-identity)
  - [Fine-Grained HTTP Capture](#fine-grained-http-capture)
  - [Console Capture](#console-capture)
  - [Manual Initialization with Auth Gate](#manual-initialization-with-auth-gate)
  - [Custom Events and Timers](#custom-events-and-timers)
  - [Log File Configuration](#log-file-configuration)
  - [Dashboard in Production Build](#dashboard-in-production-build)
- [Dashboard](#-dashboard)
- [Debug Overlay](#-debug-overlay)
- [API Contracts](#-api-contracts)
  - [Ingest Endpoint (HTTP)](#ingest-endpoint-http)
  - [Read Endpoint (HTTP)](#read-endpoint-http)
  - [WebSocket Protocol](#websocket-protocol)
- [Important Notes](#-important-notes)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🎯 Overview

**vite-plugin-monitor** is a Vite plugin that adds automatic user interaction tracking, server-side event logging, and a built-in real-time dashboard to any Vite application — with a single entry in `vite.config.ts` and zero application code changes required.

It intercepts browser interactions at the lowest level (before any application code runs) and forwards them to a configurable backend, with four storage modes covering every deployment scenario from local development to production:

1. **🔌 Middleware mode** *(default in dev)* — Events are handled directly by Vite's dev server. Zero external processes needed.
2. **🖥️ Standalone mode** — The plugin spins up its own HTTP server on a separate port. Useful when the Vite dev server and the backend are decoupled.
3. **🌐 HTTP mode** *(required in production)* — Events are sent to your own API endpoint. Bring your own backend.
4. **⚡ WebSocket mode** — All traffic (ingest + dashboard queries) flows over a single persistent WebSocket connection.

---

## ✨ Features

### 🔍 Automatic Trackers

- **Clicks** — Single passive `click` listener via event delegation. Captures element tag, text, attributes, and route.
- **HTTP Requests** — Patches `fetch` and `XMLHttpRequest`. Captures method, URL, status code, and duration. Optional capture of sanitized headers and bodies.
- **Unhandled Errors** — Hooks into `window.onerror` (sync) and `unhandledrejection` (Promise). Captures message, stack, and source location.
- **Navigation** — Intercepts `history.pushState`, `replaceState`, `popstate`, `hashchange`, and emits a synthetic 'load' navigation synchronously at setup time. Compatible with all major SPA routers.
- **Console** — Intercepts all 19 `console` methods. Configurable per-method, with argument length limits and ignore patterns.

### 📦 Event Transport

- Client-side batching with configurable `batchSize` and `flushInterval`
- Guaranteed delivery on page unload via `navigator.sendBeacon`
- Automatic retry on failed flushes
- Optional `X-Tracker-Key` API key header on all requests

### 🗄️ Server-Side Logging

- **Non-Blocking I/O** — All file writes use Node's non-blocking `fs.WriteStream` API directly on the main thread. Zero blocking on the Vite event loop.
- **JSONL format** — One JSON-stringified `TrackerEvent` per line, machine-readable and replay-friendly.
- **Pretty format** — Human-readable aligned columns for local debugging.
- **Log rotation** — Daily (UTC midnight) or size-based. Configurable archive count.
- **Multiple transports** — Write the same event stream to several files simultaneously (e.g. JSONL for machines, pretty for humans).
- **Replay on restart** — On startup the standalone/middleware server replays existing log files into its in-memory ring buffer so the dashboard retains history across Vite restarts.

### 📊 Built-in Dashboard

- Vanilla TypeScript SPA bundled separately — no framework dependencies, isolated in Shadow DOM.
- KPI cards: Active Sessions, Total Events, Unique Users, App Error Rate.
- Charts: Event Volume (line/bar) and Total Error Rate % timeline.
- Top lists: Top Pages, Top App Errors, Navigation Funnel, Top Endpoints.
- HTTP stats: Most Called Endpoint, Avg HTTP Duration, HTTP Error Rate, Slowest Endpoint, and HTTP status breakdowns (2xx / 4xx / 5xx).
- Full events table with type, level, userId, route filters and full-text search.
- Event detail panel with deep-inspection of any event payload.
- Configurable time ranges: Live, 1h, 6h, 24h, 7d, 30d.
- Optional login gate (client-side, HMAC-hashed credentials).
- Polling interval configurable per environment.

### 🔬 Debug Overlay

- Floating FAB button, Shadow DOM–isolated, drag-and-drop repositionable.
- Shows: User ID (editable inline), Session ID, App ID, current route, viewport size, language, and network connection type.
- Quick link to open the dashboard in a new tab.
- Dark/light theme toggle with `localStorage` persistence.
- `Alt+T` keyboard shortcut.
- "Remove Tracker Info" button to cleanly call `overlay.destroy()`.

### 🛡️ Security by Default

- Sensitive HTTP headers (`Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key`, etc.) are **always stripped** from captured requests and responses — configurable, but cannot be un-redacted.
- JSON body keys matching built-in patterns (`password`, `token`, `secret`, `card`, `cvv`, `iban`, etc.) are **always replaced with `'[REDACTED]'`** recursively.
- Dashboard credentials are HMAC-hashed with `appId` before being written to `window.__TRACKER_CONFIG__`.
- `window.__TRACKER_CONFIG__` is frozen and made non-writable/non-configurable at injection time.

---

## 📦 Installation

```bash
# pnpm (recommended)
pnpm add -D @ndriadev/vite-plugin-monitor

# npm
npm install -D @ndriadev/vite-plugin-monitor

# yarn
yarn add -D @ndriadev/vite-plugin-monitor
```

### Requirements

- **Node.js**: `>=20.19.0`
- **Vite**: `>=4.0.0`

---

## 🚀 Quick Start

### Minimal Setup

Add the plugin to `vite.config.ts`. Only `appId` is required — everything else uses opinionated defaults that work out of the box for local development.

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { trackerPlugin } from '@ndriadev/vite-plugin-monitor';

export default defineConfig({
  plugins: [
    trackerPlugin({
      appId: 'my-app',
    })
  ]
});
```

With just this configuration:

- The plugin auto-selects **middleware mode**: events are stored in Vite's dev server memory and written to `./logs/my-app.log`.
- Console tracking is **enabled by default** (all 19 methods). Click, HTTP, error, and navigation tracking are opt-in (`false` by default).
- The dashboard and overlay are **disabled** by default.

To get something useful immediately:

```typescript
trackerPlugin({
  appId: 'my-app',
  track: {
    clicks:     true,
    http:       true,
    errors:     true,
    navigation: true,
  },
  dashboard: {
    enabled: true,
    route:   '/_dashboard',
  },
  overlay: {
    enabled:  true,
    position: 'bottom-right',
  },
})
```

Open `http://localhost:5173/_dashboard` to see the live dashboard. The overlay FAB appears on every page.

---

## 🗄️ Storage Modes

| Mode | When to use | writeEndpoint | readEndpoint |
|------|-------------|---------------|--------------|
| `'auto'` (default) | Dev: auto-selects `middleware`. Build: requires `writeEndpoint`. | Optional | Optional |
| `'middleware'` | Dev/preview: Vite handles everything, no extra process | Same-origin `/_tracker/events` | Same-origin `/_tracker` |
| `'standalone'` | Dev: separate port, useful for multi-server setups | `http://localhost:4242/_tracker/events` | `http://localhost:4242/_tracker` |
| `'http'` | Production: your own REST API handles events | Required | Optional (inferred from `writeEndpoint`) |
| `'websocket'` | Production: single persistent WS connection | — | — |

> **Production builds require an explicit mode.** Setting `mode: 'auto'` without a `writeEndpoint` on a `vite build` throws a configuration error at build time — by design.

---

## ⚙️ Configuration

### Plugin Options

```typescript
import { trackerPlugin } from '@ndriadev/vite-plugin-monitor';

trackerPlugin({
  /**
   * Master switch. When false, the plugin is a complete no-op:
   * no scripts injected, no server started, no logs written.
   * @default true
   */
  enabled?: boolean;

  /**
   * Unique identifier for this application.
   * Attached to every event as TrackerEvent.appId.
   * Required — throws at startup if missing.
   */
  appId: string;

  /**
   * Which browser interactions to track and how.
   * @see TrackOptions
   */
  track?: TrackOptions;

  /**
   * Event storage backend and transport parameters.
   * @see StorageOptions
   */
  storage?: StorageOptions;

  /**
   * Server-side log file configuration.
   * @see LoggingOptions
   */
  logging?: LoggingOptions;

  /**
   * Built-in dashboard SPA configuration.
   * @see DashboardOptions
   */
  dashboard?: DashboardOptions;

  /**
   * Floating debug overlay widget configuration.
   * @see OverlayOptions
   */
  overlay?: OverlayOptions;

  /**
   * Automatically inject tracker.init() into index.html.
   * When false, you must call tracker.init() manually.
   * @default true
   */
  autoInit?: boolean;
})
```

---

### Track Options

```typescript
track: {
  /**
   * Enable click tracking.
   * true              → enable with default settings.
   * false             → disabled entirely.
   * ClickTrackOptions → filter by route or CSS selector (see below).
   * Single passive delegated listener on document.
   * @default false
   */
  clicks?: boolean | ClickTrackOptions;

  /**
   * Enable HTTP request tracking.
   * true             → method, URL, status, duration. No headers/bodies.
   * false            → disabled entirely.
   * HttpTrackOptions → full control (see below).
   * @default false
   */
  http?: boolean | HttpTrackOptions;

  /**
   * Enable unhandled error tracking.
   * true               → capture all unhandled errors and promise rejections.
   * false              → disabled entirely.
   * ErrorTrackOptions  → filter specific error messages (see below).
   * Hooks window.onerror and unhandledrejection.
   * try/catch errors are NOT captured automatically.
   * @default false
   */
  errors?: boolean | ErrorTrackOptions;

  /**
   * Enable client-side navigation tracking.
   * true                    → enable with default settings.
   * false                   → disabled entirely.
   * NavigationTrackOptions  → filter by route or trigger type (see below).
   * Patches history.pushState, replaceState, popstate,
   * hashchange, and emits a synthetic 'load' navigation synchronously at setup time.
   * @default false
   */
  navigation?: boolean | NavigationTrackOptions;

  /**
   * Enable console method interception.
   * true  → all 19 methods with safe defaults.
   * false → disabled entirely.
   * ConsoleTrackOptions → restrict methods, tune limits.
   * @default true
   */
  console?: boolean | ConsoleTrackOptions;

  /**
   * Function resolving the current user ID at init time.
   * To update after init, use tracker.setUser().
   * @example () => localStorage.getItem('userId')
   */
  userId?: () => string | null;

  /**
   * Minimum log level for automatically-tracked events.
   * Events below this threshold are discarded before enqueueing.
   * Does not affect tracker.track() custom events.
   * Navigation and Click trackers are always emitted at 'info' level.
   * @default 'info'
   */
  level?: 'debug' | 'info' | 'warn' | 'error';
}
```

#### `ClickTrackOptions` (fine-grained click filtering)

```typescript
clicks: {
  /**
   * Route patterns where click tracking is suppressed.
   * Checked against window.location.pathname at click-time.
   * Accepts plain strings (strict equality) or RegExp objects.
   * The dashboard route is always injected automatically.
   * @default []
   * @example ['/admin', /^\/user\/\d+/, '/checkout']
   */
  ignoreRoutes?: (string | RegExp)[];

  /**
   * CSS selectors whose matching elements (or ancestors) suppress click tracking.
   * Uses Element.closest() walking up the DOM from the event target.
   * The overlay host selector [data-tracker-overlay] is always injected automatically.
   * @default []
   * @example ['[data-no-track]', '#cookie-banner', '.dev-toolbar']
   */
  ignoreSelectors?: string[];
}
```

#### `ErrorTrackOptions` (fine-grained error filtering)

```typescript
errors: {
  /**
   * Patterns matched against the error message.
   * Errors whose message matches any entry are silently dropped.
   * String entries use strict equality; RegExp entries are tested against the full message.
   * Classic use-case: suppressing browser extension noise.
   * @default []
   * @example ['ResizeObserver loop limit exceeded', /^Script error\.?$/]
   */
  ignoreMessages?: (string | RegExp)[];
}
```

#### `NavigationTrackOptions` (fine-grained navigation filtering)

```typescript
navigation: {
  /**
   * Route patterns where navigation tracking is suppressed.
   * Suppressed when either the `from` OR the `to` path matches.
   * Accepts plain strings (strict equality) or RegExp objects.
   * The dashboard route is always injected automatically.
   * @default []
   * @example ['/admin', /^\/user\/\d+/, '/checkout']
   */
  ignoreRoutes?: (string | RegExp)[];

  /**
   * Navigation trigger types to suppress.
   * Note: 'load' (initial page load) cannot be suppressed via this option.
   * @default []
   * @example ['hashchange', 'replaceState']
   */
  ignoreTypes?: Array<'pushState' | 'replaceState' | 'popstate' | 'hashchange'>;
}
```

#### `HttpTrackOptions` (fine-grained HTTP capture)

```typescript
http: {
  /**
   * Capture sanitized request headers.
   * Sensitive headers are always stripped regardless.
   * @default false
   */
  captureRequestHeaders?: boolean;

  /**
   * Capture and auto-redact the request body.
   * Pipeline: read → parse JSON → redact → re-serialize → truncate.
   * @default false
   */
  captureRequestBody?: boolean;

  /**
   * Capture sanitized response headers (Set-Cookie always stripped).
   * @default false
   */
  captureResponseHeaders?: boolean;

  /**
   * Capture and auto-redact the response body.
   * Uses response.clone() — original Response is not consumed.
   * @default false
   */
  captureResponseBody?: boolean;

  /**
   * Additional header names to strip (case-insensitive).
   * Cannot un-redact a built-in sensitive header.
   * @example ['x-internal-trace', 'x-company-id']
   */
  excludeHeaders?: string[];

  /**
   * Additional JSON body key patterns to redact (case-insensitive substring).
   * Applied recursively to nested objects and arrays.
   * @example ['fiscalCode', 'vatNumber']
   */
  redactKeys?: string[];

  /**
   * Maximum byte length of the stored body after redaction.
   * Set to 0 to disable truncation (not recommended).
   * @default 2048
   */
  maxBodySize?: number;

  /**
   * HTTP methods to exclude from tracking (case-insensitive).
   * Useful for suppressing high-frequency noise like CORS preflight OPTIONS requests.
   * @default []
   * @example ['OPTIONS', 'HEAD']
   */
  ignoreMethods?: string[];

  /**
   * URLs that disable HTTP tracking for matching requests.
   * Accepts plain strings (strict equality) or RegExp objects.
   * Case-sensitive match against the full absolute URL.
   * Applied before any capture or redaction logic.
   * @default []
   * @example ['/_dashboard', '/health', /analytics\.google\.com/]
   */
  ignoreUrls?: (string | RegExp)[];
}
```

#### `ConsoleTrackOptions` (fine-grained console capture)

```typescript
console: {
  /**
   * Subset of console methods to intercept.
   * Methods not listed are not patched and incur zero overhead.
   * @default All 19 methods
   * @example ['error', 'warn']
   */
  methods?: ConsoleMethod[];

  /**
   * Maximum character length for a single serialized argument.
   * Values exceeding this are truncated with '... [N chars omitted]'.
   * @default 1024
   */
  maxArgLength?: number;

  /**
   * Maximum number of arguments captured per console call.
   * @default 10
   */
  maxArgs?: number;

  /**
   * Capture a stack trace for console.error calls.
   * (console.trace always captures a stack regardless of this flag.)
   * @default false
   */
  captureStackOnError?: boolean;

  /**
   * Patterns matched against the first argument of each console call.
   * Calls whose first argument matches any entry are silently dropped.
   * String entries use strict equality; RegExp entries are tested against
   * the string representation of the first argument.
   * The built-in patterns '[vite]', '[HMR]', '[tracker]' are always prepended.
   * Applied before serialization: zero overhead for ignored calls.
   * @default ['[vite]', '[HMR]', '[tracker]']
   * @example ['[vite]', '[HMR]', '[tracker]', /^\[react-query\]/, 'Stripe.js']
   */
  ignorePatterns?: (string | RegExp)[];
}
```

---

### Storage Options

#### `HttpStorageOptions` (modes: `auto`, `middleware`, `standalone`, `http`)

```typescript
storage: {
  /**
   * @default 'auto'
   */
  mode?: 'auto' | 'middleware' | 'standalone' | 'http';

  /**
   * URL that receives batched events via POST.
   * Required when mode = 'http'.
   * Body: { "type": "ingest", "events": TrackerEvent[] }
   * Any 2xx is treated as success; non-2xx requeues the batch.
   */
  writeEndpoint?: string;

  /**
   * URL queried by the dashboard for events.
   * Must honour ?since=<ISO8601>&until=<ISO8601> query params.
   * If omitted, inferred by stripping /events from writeEndpoint.
   */
  readEndpoint?: string;

  /**
   * URL polled by the dashboard health check indicator.
   * If omitted, backend is assumed online.
   */
  pingEndpoint?: string;

  /**
   * API key sent as X-Tracker-Key on all requests.
   */
  apiKey?: string;

  /**
   * TCP port for the standalone server.
   * Only used when mode = 'standalone'.
   * @default 4242
   */
  port?: number;

  /**
   * Max events accumulated client-side before flushing.
   * @default 25
   */
  batchSize?: number;

  /**
   * Max milliseconds between automatic flushes.
   * @default 3000
   */
  flushInterval?: number;

  /**
   * Max events kept in the server-side in-memory ring buffer.
   * Only used in middleware and standalone modes.
   * Oldest events are evicted automatically (FIFO).
   * @default 500000
   */
  maxBufferSize?: number;
}
```

#### `WsStorageOptions` (mode: `websocket`)

```typescript
storage: {
  mode: 'websocket';        // Required discriminant

  wsEndpoint: string;       // WebSocket URL, e.g. 'wss://api.myapp.com/tracker/ws'

  pingEndpoint?: string;    // Optional health check URL
  apiKey?:       string;    // Optional API key
  batchSize?:    number;    // @default 25
  flushInterval?: number;   // @default 3000
}
```

---

### Logging Options

```typescript
logging: {
  /**
   * Minimum severity written to any file transport (server-side only).
   * Independent of track.level (client-side filtering).
   * @default 'info'
   */
  level?: 'debug' | 'info' | 'warn' | 'error';

  /**
   * File output targets. Multiple transports write simultaneously.
   * @default [{ format: 'json', path: './logs/<appId>.log', rotation: { strategy: 'daily', maxFiles: 30 } }]
   */
  transports?: Array<{
    /**
     * 'json'   → JSONL (one TrackerEvent per line). Machine-readable.
     * 'pretty' → Human-readable aligned columns.
     */
    format: 'json' | 'pretty';

    /**
     * Log file path (absolute or CWD-relative).
     * For daily rotation a date suffix is inserted before the extension:
     * './logs/monitor.log' → './logs/monitor-2024-03-15.log'
     */
    path: string;

    rotation?: {
      /**
       * 'daily' → first write after UTC midnight triggers rotation.
       * 'size'  → first write that would exceed maxSize triggers rotation.
       */
      strategy: 'daily' | 'size';

      /** Max size for 'size' strategy. @default '10mb' */
      maxSize?: string;

      /** Max rotated archive files to retain on disk. @default 30 */
      maxFiles?: number;

      /** Reserved for future gzip compression. Currently no effect. @default false */
      compress?: boolean;
    };
  }>;
}
```

---

### Dashboard Options

```typescript
dashboard: {
  /**
   * Enable the dashboard SPA.
   * @default false
   */
  enabled?: boolean;

  /**
   * URL path where the dashboard is mounted.
   * Must start with '/'. Should not collide with app routes.
   * @default '/_dashboard'
   */
  route?: string;

  /**
   * Login gate credentials (client-side, HMAC-hashed).
   * Suitable for dev/staging friction — not for production security.
   * false → no login required.
   * @default false
   */
  auth?: { username: string; password: string } | false;

  /**
   * Copy the dashboard SPA into the vite build output (dist/).
   * When true, the dashboard is served as static files at `route`.
   * Requires storage.readEndpoint to be set.
   * @default false
   */
  includeInBuild?: boolean;

  /**
   * Polling interval between dashboard data refresh requests (ms).
   * @default 3000
   */
  pollInterval?: number;
}
```

---

### Overlay Options

```typescript
overlay: {
  /**
   * Show the floating debug overlay.
   * @default false
   */
  enabled?: boolean;

  /**
   * Corner where the FAB button is anchored.
   * @default 'bottom-right'
   */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
}
```

---

## 🖥️ Client API

By default (`autoInit: true`) the plugin injects two scripts into `index.html` at `head-prepend` before any application code:

1. **Setup script** — Installs all event proxies (`fetch`, `XHR`, `console`, `history`, etc.) immediately. Events are enqueued but not yet flushed.
2. **Auto-init script** — Calls `tracker.init()`, activates the flush timer, mounts the overlay, and emits the initial `session:start` event.

### Manual Initialization

Set `autoInit: false` when you need to delay initialization — for example after a cookie consent banner, after authentication, or only in specific environments.

```typescript
// vite.config.ts
trackerPlugin({
  appId: 'my-app',
  autoInit: false,       // setup proxies immediately, but don't init yet
  track: { clicks: true, http: true, errors: true, navigation: true },
})
```

The setup script is still injected (proxies must be active before app code), but `tracker.init()` is not called. Call it yourself at the right moment:

```typescript
// In your application code (e.g. after consent, after login)
import { tracker } from '@ndriadev/vite-plugin-monitor/client';

// Simple manual init
tracker.init();

// With user ID function
tracker.init(() => authStore.getState().userId ?? null);
```

---

### `tracker` Object

The `tracker` object is a safe proxy — most calls are silently dropped if the tracker has not been initialized yet (e.g. before `tracker.init()` or in SSR environments). The one exception is `tracker.group()`, which always returns a valid group ID (with an `_offline` suffix) even before initialization.

```typescript
import { tracker } from '@ndriadev/vite-plugin-monitor/client';
```

#### `tracker.init(userIdFn?)`

Initialize the tracker. Safe to call multiple times — subsequent calls are no-ops (singleton).

```typescript
tracker.init(() => getCurrentUserId());
```

#### `tracker.track(name, data?, opts?)`

Emit a custom event.

```typescript
tracker.track('button:clicked', {
  buttonId: 'checkout-btn',
  cartItems: 3,
});

// With explicit log level (default: 'info')
tracker.track('payment:failed', { code: 'CARD_DECLINED' }, { level: 'error' });

// Associate with a group
const groupId = tracker.group('checkout-flow');
tracker.track('checkout:started', {}, { groupId });
tracker.track('checkout:completed', { total: 99.99 }, { groupId });
```

#### `tracker.time(label)` / `tracker.timeEnd(label, data?, opts?)`

Time a named operation. `timeEnd` emits a custom event with `duration` as a **top-level field of the payload** (not merged into `data`).

```typescript
tracker.time('api:load');
const data = await fetchUserData();
tracker.timeEnd('api:load', { userId: data.id });
// Emits payload: { name: 'api:load', duration: 123, data: { userId: '...' } }
```

#### `tracker.setUser(userId, opts?)`

Update the user identity after initialization. Emits a `session:end` event for the previous identity and a `session:start` event for the new one, both with `trigger: 'userId-change'`.

```typescript
// After login
tracker.setUser(user.id, {
  attributes: { plan: 'pro', role: 'admin' }
});

// After logout
tracker.setUser(null);    // resets to anonymous ID
```

#### `tracker.setContext(attrs)`

Attach arbitrary key-value metadata to every subsequent event.

```typescript
tracker.setContext({
  appVersion: '2.1.0',
  region:     'eu-west',
  featureFlags: ['new-checkout'],
});
```

#### `tracker.group(name)`

Generate a unique group ID for correlating a sequence of related events. Unlike other `tracker.*` methods, this **always returns a valid ID** — even before `tracker.init()` is called (the ID will have an `_offline` suffix in that case).

```typescript
const groupId = tracker.group('upload-flow');
tracker.track('upload:started', { fileName }, { groupId });
tracker.track('upload:completed', { bytes }, { groupId });
```

#### `tracker.destroy()`

Emit `session:end`, flush the queue, remove all event proxies, and destroy the overlay.

```typescript
tracker.destroy();
```

---

## 💡 Usage Examples

### Zero-Config Dev Setup

The minimal configuration for a productive local development setup:

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { trackerPlugin } from '@ndriadev/vite-plugin-monitor';

export default defineConfig({
  plugins: [
    trackerPlugin({
      appId: 'my-app',
      track: {
        clicks:     true,
        http:       true,
        errors:     true,
        navigation: true,
      },
      dashboard: { enabled: true },
      overlay:   { enabled: true },
    })
  ]
});
```

Dashboard available at: `http://localhost:5173/_dashboard`
Log file written to: `./logs/my-app.log`

---

### HTTP Mode (Production)

```typescript
// vite.config.ts
trackerPlugin({
  appId: 'my-app',
  storage: {
    mode:          'http',
    writeEndpoint: 'https://api.myapp.com/tracker/events',
    readEndpoint:  'https://api.myapp.com/tracker',
    pingEndpoint:  'https://api.myapp.com/health',
    apiKey:        process.env.TRACKER_API_KEY,
    batchSize:     50,
    flushInterval: 5000,
  },
  track: {
    clicks:     true,
    http:       true,
    errors:     true,
    navigation: true,
    console:    false,    // opt out in production if console has sensitive data
  },
  dashboard: {
    enabled:        true,
    route:          '/_dashboard',
    auth:           { username: 'admin', password: 'secret' },
    includeInBuild: true,
    pollInterval:   5000,
  },
})
```

---

### WebSocket Mode

```typescript
trackerPlugin({
  appId: 'my-app',
  storage: {
    mode:        'websocket',
    wsEndpoint:  'wss://api.myapp.com/tracker/ws',
    pingEndpoint: 'https://api.myapp.com/health',
    apiKey:       process.env.TRACKER_API_KEY,
  },
  track: { clicks: true, http: true, errors: true, navigation: true },
})
```

Your server must implement the tracker WebSocket sub-protocol. See [WebSocket Protocol](#websocket-protocol) for the full message contract.

---

### Custom User Identity

```typescript
trackerPlugin({
  appId: 'my-app',
  track: {
    clicks:     true,
    navigation: true,
    // Function serialized and evaluated in the browser — must be pure (no closures)
    userId: () => window.__auth?.userId ?? null,
  },
})
```

For identity that changes after page load (login/logout flows), use `autoInit: false` and call `tracker.init()` / `tracker.setUser()` manually:

```typescript
// vite.config.ts
trackerPlugin({ appId: 'my-app', autoInit: false })

// In your app (e.g. auth store effect)
import { tracker } from '@ndriadev/vite-plugin-monitor/client';

authStore.subscribe((state) => {
  if (state.isLoggedIn) {
    tracker.init(() => state.userId);
  } else {
    tracker.setUser(null);
  }
});
```

---

### Fine-Grained HTTP Capture

```typescript
trackerPlugin({
  appId: 'my-app',
  track: {
    http: {
      captureRequestHeaders:  true,
      captureRequestBody:     true,
      captureResponseHeaders: false,
      captureResponseBody:    false,
      excludeHeaders:         ['x-internal-trace-id'],
      redactKeys:             ['fiscalCode', 'vatNumber', 'nationalId'],
      maxBodySize:            4096,
      ignoreMethods:          ['OPTIONS', 'HEAD'],
      ignoreUrls:             ['/_dashboard', '/ping', '/health', /cdn\.myapp\.com/],
    },
  },
})
```

---

### Console Capture

```typescript
trackerPlugin({
  appId: 'my-app',
  track: {
    console: {
      // Only capture errors and warnings
      methods:              ['error', 'warn'],
      // Capture stack trace on console.error calls
      captureStackOnError:  true,
      // Ignore noisy internal patterns (strings use strict equality, RegExp for fuzzy match)
      ignorePatterns:       ['[vite]', '[HMR]', '[tracker]', /^\[react-query\]/],
      maxArgLength:         1024,
    },
  },
})
```

---

### Manual Initialization with Auth Gate

```typescript
// vite.config.ts
trackerPlugin({
  appId:    'my-app',
  autoInit: false,
  track:    { clicks: true, http: true, errors: true, navigation: true },
})
```

```typescript
// App bootstrap (e.g. main.ts)
import { tracker } from '@ndriadev/vite-plugin-monitor/client';

async function bootstrap() {
  const consent = await showConsentBanner();

  if (consent.analytics) {
    const user = await getSession();
    tracker.init(() => user?.id ?? null);
  }
}

bootstrap();
```

---

### Custom Events and Timers

```typescript
import { tracker } from '@ndriadev/vite-plugin-monitor/client';

// Custom events
function onAddToCart(product) {
  tracker.track('ecommerce:add-to-cart', {
    productId:   product.id,
    productName: product.name,
    price:       product.price,
    currency:    'EUR',
  });
}

// Timed operations
async function loadDashboardData() {
  tracker.time('dashboard:load');
  try {
    const data = await fetchData();
    tracker.timeEnd('dashboard:load', { records: data.length });
    return data;
  } catch (err) {
    tracker.track('dashboard:load-failed', { error: err.message }, { level: 'error' });
    throw err;
  }
}

// Correlated event sequences
async function runCheckout(cart) {
  const groupId = tracker.group('checkout');

  tracker.track('checkout:started', { itemCount: cart.items.length }, { groupId });

  try {
    const order = await submitOrder(cart);
    tracker.track('checkout:completed', { orderId: order.id, total: order.total }, { groupId });
  } catch (err) {
    tracker.track('checkout:failed', { reason: err.message }, { groupId, level: 'error' });
  }
}
```

---

### Log File Configuration

```typescript
trackerPlugin({
  appId: 'my-app',
  logging: {
    level: 'warn',    // only warn and error events reach the log files
    transports: [
      {
        format: 'json',
        path:   './logs/monitor.jsonl',
        rotation: {
          strategy: 'daily',
          maxFiles: 7,       // keep one week of archives
        },
      },
      {
        format: 'pretty',
        path:   './logs/monitor-human.log',
        rotation: {
          strategy: 'size',
          maxSize:  '20mb',
          maxFiles: 3,
        },
      },
    ],
  },
})
```

---

### Dashboard in Production Build

```typescript
// vite.config.ts
trackerPlugin({
  appId: 'my-app',
  storage: {
    mode:          'http',
    writeEndpoint: 'https://api.myapp.com/tracker/events',
    readEndpoint:  'https://api.myapp.com/tracker',
  },
  dashboard: {
    enabled:        true,
    route:          '/_dashboard',
    includeInBuild: true,      // copies dashboard/index.html into dist/_dashboard/
    auth:           { username: 'ops', password: 'secure-password' },
  },
})
```

After `vite build`, the dashboard SPA is present at `dist/_dashboard/`. Your reverse proxy or static file server must serve the dashboard `index.html` at `/_dashboard` (and all sub-paths, as a SPA fallback).

> **Note:** You must run `pnpm build:dashboard` before `vite build` to generate the dashboard dist. If the dashboard dist is absent, the plugin logs a warning and skips the copy step.

---

## 📊 Dashboard

The dashboard is a standalone Vanilla TypeScript SPA injected into Vite's middleware (or standalone server) at the configured `route`. It reads its own configuration from `window.__TRACKER_CONFIG__` injected by the plugin at serve time.

### Layout

```
┌─────────────────────────────────────────────────────┐
│  Header: Logo | Time Range Selector | Tab Switcher  │
│                    Backend status indicator         │
├─────────────────────────────────────────────────────┤
│  [Metrics Tab]                                      │
│                                                     │
│  Row 1: Active Sessions | Total Events              │
│         Unique Users   | App Error Rate             │
│                                                     │
│  Row 2: Top Pages | Top App Errors                  │
│         Nav Funnel | Top Endpoints                  │
│                                                     │
│  Row 3: Most Called EP | Avg HTTP | Error Rate      │
│         Slowest EP                                  │
│                                                     │
│  Row 4: Total Requests | 2xx | 4xx | 5xx            │
│                                                     │
│  Row 5: Event Volume Chart | Error Rate % Chart     │
├─────────────────────────────────────────────────────┤
│  [Events Tab]                                       │
│                                                     │
│  Events Table (filterable + full-text search)       │
│  Event Detail Panel (opens on row click)            │
└─────────────────────────────────────────────────────┘
```

### Time Ranges

`Live` (auto-polling) · `1h` · `6h` · `24h` · `7d` · `30d`

In live mode the dashboard polls at `pollInterval` ms. For the other presets, data is fetched once and then refreshed only on manual navigation or filter change.

---

## 🔬 Debug Overlay

The overlay is a Shadow DOM–isolated floating widget rendered in the browser. It is mounted by the tracker client after `tracker.init()` when `overlay.enabled: true`.

### Features

- Drag-and-drop by grabbing the header bar
- All four viewport corners selectable via `overlay.position`
- Keyboard shortcut: `Alt+T` toggles open/close
- **Identity section**: User ID (editable inline), Session ID (copy button), App ID
- **Context section**: Route (live-updated on open), Viewport size, Language, Connection type
- **Open Dashboard** — opens `window.location.origin + dashboard.route` in a new tab
- **Remove Tracker Info** — calls `overlay.destroy()`, removes the overlay host element from the DOM. Automatic tracking continues running in the background — this does **not** call `tracker.destroy()`
- Dark/light theme toggle, persisted in `localStorage`

---

## 📡 API Contracts

### Ingest Endpoint (HTTP)

Used when `mode = 'http'`.

**Request** (browser → server):
```
POST <writeEndpoint>
Content-Type: application/json
X-Tracker-Key: <apiKey>           (only when apiKey is configured)

{
  "type": "ingest",
  "events": TrackerEvent[]
}
```

**Response**: any `2xx` is treated as success. Non-`2xx` causes the batch to be requeued and retried on the next flush interval.

---

### Read Endpoint (HTTP)

Used by the dashboard when `mode = 'http'` or `mode = 'standalone'`.

**Request** (dashboard → server):
```
GET <readEndpoint>?since=<ISO8601>&until=<ISO8601>
Accept: application/json
X-Tracker-Key: <apiKey>           (optional)
```

The dashboard **always** sends `since` and `until`. Your server must honour them and return only events whose `timestamp` falls within `[since, until]`, sorted newest first.

**Response**:
```json
{
  "events": TrackerEvent[],
  "total":  123,
  "page": 1,
  "limit": 5
}
```

All further filtering (type, level, userId, full-text search) and all aggregations (charts, KPI cards, top lists) are performed **client-side** in the browser. Your server only needs to implement time-range filtering.

---

### WebSocket Protocol

Used when `mode = 'websocket'`. All messages are JSON.

#### Authentication (when `storage.apiKey` is configured)

Immediately after the connection is established, the client sends an auth handshake as the **first message**:

**Browser → Server:**
```json
{ "type": "auth", "key": "<storage.apiKey>" }
```

**Server → Browser:**
```json
{ "type": "auth_ok" }
```

Until this handshake completes, the server must reject all other messages (recommended: close with code `1008 Policy Violation`). If no `apiKey` is configured, no auth message is sent and the connection is immediately ready.

---

#### Event Ingest

**Browser → Server:**
```json
{ "type": "ingest", "events": TrackerEvent[] }
```

**Server → Browser (acknowledgement):**
```json
{ "type": "ack", "saved": 42 }
```

---

#### Dashboard Query

**Dashboard → Server:**
```json
{
  "type":  "events:query",
  "reqId": "uuid-string",
  "query": { "since": "2024-01-01T00:00:00.000Z", "until": "2024-01-02T00:00:00.000Z" }
}
```

**Server → Dashboard:**
```json
{
  "type":     "events:response",
  "reqId":    "uuid-string",
  "response": { "events": TrackerEvent[], "total": 123 }
}
```

---

#### Real-Time Push (optional)

**Server → Browser:**
```json
{ "type": "push", "events": TrackerEvent[] }
```

When the dashboard receives a `push` message while in Live mode, it merges the new events without a full re-query.

---

## ⚠️ Important Notes

### Production Builds

`mode: 'auto'` without a `writeEndpoint` throws a configuration error at `vite build` time — by design. Always set `storage.mode = 'http'` (or `'websocket'`) explicitly for production builds.

### `autoInit: false` and Proxy Installation

Even when `autoInit: false`, the **setup script** (which installs `fetch`, `XHR`, `console`, `history` proxies) is **always injected at `head-prepend`**. This is intentional: proxies must be active before any application code runs to capture events from the very first line. `autoInit: false` only delays the call to `tracker.init()`, not the proxy installation.

### `track.userId` Must Be a Pure Function

The `track.userId` function is **serialized to a string** (`.toString()`) and injected into `index.html`. It must be a pure function with no closures over module-level variables at build time. To update user identity dynamically after initialization, use `tracker.setUser()`.

### Dashboard Auth is Client-Side Only

The `dashboard.auth` credentials are HMAC-hashed with `appId` and stored in `window.__TRACKER_CONFIG__`. This is suitable as a friction barrier in dev/staging environments. For production security, protect the dashboard route at the proxy/server level.

### Dashboard Self-Exclusion

The dashboard route is automatically injected into `ignoreRoutes` for both the click tracker and the navigation tracker. Dashboard UI interactions are never self-tracked. Dashboard UI interactions are never self-tracked.

### Endpoints Self-Exclusion
The tracker's own `writeEndpoint`, `readEndpoint`, `pingEndpoint` are automatically added to `http.ignoreUrls` to prevent infinite recursion (tracking the tracking requests).

### `includeInBuild` Requires a Prior `pnpm build:dashboard`

The plugin's `closeBundle` hook copies the pre-built dashboard dist into the Vite output directory. If the dashboard dist is absent, the plugin logs a warning and skips the copy — it does not fail the build.

---

## 🔍 Troubleshooting

### No Events Appearing in the Dashboard

- Check the browser Network tab: is the `POST <writeEndpoint>` request succeeding (2xx)?
- In middleware/standalone mode: is Vite still running? Restart and reload.
- Verify `track.clicks`, `track.http`, etc. are enabled — all auto-trackers except `console` default to `false`.
- Check the `track.level` filter — events below the minimum level are silently discarded before enqueueing.

### Dashboard Shows "Backend Offline"

- In middleware mode: the Vite dev server is the backend — make sure it is running.
- In standalone mode: the plugin starts a server on `storage.port` (default: 4242) — check for port conflicts (`EADDRINUSE` in the Vite terminal).
- In HTTP mode: verify `storage.readEndpoint` and `storage.pingEndpoint` are reachable from the browser.

### `window.__TRACKER_CONFIG__ not found`

The Vite dev server is not running or the page was opened without going through Vite. Always open the app through `http://localhost:5173` (not directly as a `file://` path).

### `autoInit: false` — Tracker Calls Are Silently Dropped

The `tracker` proxy drops most calls until `tracker.init()` is called (the exception is `tracker.group()`, which always returns a valid ID). Ensure `tracker.init()` is called before any `tracker.track()` / `tracker.setUser()` calls in the application lifecycle.

### Log Files Not Created

- Check that the Node.js process has write permission to the log directory.
- The directory is created recursively on `buildStart` — a `vite build` run (or `vite dev` start) is needed to trigger creation.
- Check `logging.level` — if set to `'error'` and no error events are tracked, the file may be empty but present.

### HTTP Bodies Are `[REDACTED]`

The built-in redaction pipeline removes keys matching `password`, `token`, `secret`, `card`, `cvv`, `iban`, and several others. This is intentional and cannot be disabled. Add custom patterns via `http.redactKeys`.

---

## 🤝 Contributing

Contributions are welcome! Please open an issue first to discuss the change you have in mind.

```bash
# Clone and install
git clone https://github.com/nDriaDev/vite-plugin-monitor.git
cd vite-plugin-monitor
pnpm install

# Run tests
pnpm test

# Type-check
pnpm typecheck

# Lint
pnpm lint

# Start the dev server (dashboard + dev-server script)
pnpm dev:server   # starts the mock event server on :4242
pnpm dev:ui       # starts the dashboard on :5173
```

---

## 📄 License

[MIT](LICENSE) © [nDriaDev](https://github.com/nDriaDev)

---

## 📞 Support

- **Issues:** [GitHub Issues](https://github.com/nDriaDev/vite-plugin-monitor/issues)
- **Email:** admin@ndria.dev

---

<div align="center">

If you find this plugin useful, please consider giving it a ⭐ on [GitHub](https://github.com/nDriaDev/vite-plugin-monitor)!

</div>

# Dashboard

The `dashboard` option controls the built-in analytics dashboard — a standalone Vanilla TypeScript SPA served directly by the plugin.

```typescript
trackerPlugin({
  appId: 'my-app',
  dashboard: {
    enabled:        true,
    route:          '/_dashboard',
    auth:           { username: 'admin', password: 'secret' },
    includeInBuild: false,
    pollInterval:   3000,
  },
})
```

## Options

### `dashboard.enabled`

**Type:** `boolean` · **Default:** `false`

Enable the dashboard SPA. When `true`, the plugin serves the dashboard at `dashboard.route`.

---

### `dashboard.route`

**Type:** `string` · **Default:** `'/_dashboard'`

URL path where the dashboard is mounted. Must start with `/`. Should not collide with your application's own routes.

```typescript
dashboard: {
  enabled: true,
  route:   '/_dashboard',  // http://localhost:5173/_dashboard
}
```

The plugin serves the dashboard as a SPA — all sub-paths (e.g. `/_dashboard/events`) are handled by the same `index.html` with client-side routing.

::: info Dashboard self-exclusion
The dashboard route is automatically injected into `ignorePaths` for the click and
navigation trackers. The HTTP tracker excludes only the tracker's own endpoints
(writeEndpoint, readEndpoint, pingEndpoint).
:::

---

### `dashboard.auth`

**Type:** `{ username: string; password: string } | false` · **Default:** `false`

Optional login gate protecting the dashboard. When configured, the dashboard shows a login form before granting access.

```typescript
dashboard: {
  auth: { username: 'admin', password: 'secret123' },
}
```

When `false` (default), the dashboard is publicly accessible — no login required.

::: warning Client-side only
Dashboard authentication is **client-side only**. The credentials are HMAC-hashed with `appId` using SHA-256 before being written to `window.__TRACKER_CONFIG__`, so they are not stored in plaintext.

This is suitable as a **friction barrier** for dev/staging environments. For production security, protect the dashboard route at the **reverse proxy or server level** (HTTP Basic Auth, IP allowlist, VPN, etc.).
:::

**How it works:**
1. You configure `{ username: 'admin', password: 'secret' }`.
2. The plugin computes `HMAC-SHA256(appId, 'admin')` and `HMAC-SHA256(appId, 'secret')`.
3. Only the hashed values are injected into `window.__TRACKER_CONFIG__`.
4. The login form hashes the user's input on the client and compares.
5. The original credentials are never stored anywhere.

---

### `dashboard.includeInBuild`

**Type:** `boolean` · **Default:** `false`

When `true`, copies the pre-built dashboard SPA into the Vite build output directory (`dist/`) at `<route>/`.

```typescript
dashboard: {
  enabled:        true,
  route:          '/_dashboard',
  includeInBuild: true,  // copies to dist/_dashboard/
}
```

After `vite build`, your reverse proxy or static file server must:
1. Serve `/_dashboard/index.html` (and all sub-paths) as a SPA fallback.
2. Forward API requests to your backend (when using `mode: 'http'`).

::: warning Requires prior dashboard build
The plugin's `closeBundle` hook copies the **pre-built** dashboard dist. If the dashboard dist is absent (you haven't run `pnpm build:dashboard` yet), the plugin logs a warning and skips the copy — **the main build does not fail**.

```bash
# Always run this before vite build when includeInBuild: true
pnpm build:dashboard
vite build
```
:::

---

### `dashboard.pollInterval`

**Type:** `number` · **Default:** `3000`

Polling interval in milliseconds between dashboard data refresh requests.

- In **Live** mode: the dashboard polls at this interval continuously.
- In **other time ranges** (1h, 6h, 24h, 7d, 30d): data is fetched once and refreshed only on manual filter changes.

```typescript
dashboard: {
  pollInterval: 5000,  // refresh every 5 seconds in Live mode
}
```

---

## Dashboard Layout

The dashboard is divided into two tabs: **Metrics** and **Events**.

### Metrics Tab

```
┌─────────────────────────────────────────────────────────────┐
│  Header: Logo | Time Range | Tab Switcher | Backend Status  │
├─────────────────────────────────────────────────────────────┤
│  KPI Row:                                                   │
│    Active Sessions  │  Total Events  │  Unique Users  │  App Error Rate  │
├─────────────────────────────────────────────────────────────┤
│  Top Lists Row:                                             │
│    Top Pages  │  Top App Errors  │  Nav Funnel  │  Top Endpoints  │
├─────────────────────────────────────────────────────────────┤
│  HTTP Metrics Row:                                          │
│    Most Called EP  │  Avg Duration  │  Error Rate  │  Slowest EP  │
├─────────────────────────────────────────────────────────────┤
│  HTTP Status Row:                                           │
│    Total Requests  │  2xx Count  │  4xx Count  │  5xx Count  │
├─────────────────────────────────────────────────────────────┤
│  Charts Row:                                                │
│    Event Volume (line/bar)  │  Error Rate % Timeline       │
└─────────────────────────────────────────────────────────────┘
```

### Events Tab

A paginated, filterable events table with:
- **Type filter** — filter by event type (click, http, error, navigation, console, custom, session)
- **Level filter** — filter by severity (debug, info, warn, error)
- **User ID filter** — filter events from a specific user
- **Route filter** — filter events from a specific route
- **Full-text search** — search across all event fields
- **Event detail panel** — click any row to inspect the full event payload, metadata, and all fields

### Time Ranges

| Range | Description |
|-------|-------------|
| **Live** | Auto-polls at `pollInterval` ms. Shows the last 1 hour window. |
| **1h** | Last 1 hour of events, fetched once. |
| **6h** | Last 6 hours. |
| **24h** | Last 24 hours. |
| **7d** | Last 7 days. |
| **30d** | Last 30 days. |

### Backend Status Indicator

The coloured dot in the header shows the backend connectivity status:

- 🟢 **Online** — `pingEndpoint` returned `2xx` (or no `pingEndpoint` is configured)
- 🔴 **Offline** — `pingEndpoint` is unreachable or returned a non-`2xx` response

---

## Production Build Setup

For a complete production deployment with dashboard included:

```typescript
// vite.config.ts
trackerPlugin({
  appId: 'my-app',
  storage: {
    mode:          'http',
    writeEndpoint: 'https://api.myapp.com/tracker/events',
    readEndpoint:  'https://api.myapp.com/tracker',
    pingEndpoint:  'https://api.myapp.com/health',
  },
  dashboard: {
    enabled:        true,
    route:          '/_dashboard',
    auth:           { username: 'ops', password: process.env.DASHBOARD_PASSWORD },
    includeInBuild: true,
    pollInterval:   5000,
  },
})
```

```bash
pnpm build:dashboard  # build the dashboard SPA first
vite build            # then build your app (dashboard is copied into dist/)
```

**Nginx config example (SPA fallback for dashboard):**

```nginx
location /_dashboard {
  try_files $uri $uri/ /_dashboard/index.html;
}
```

See [Production Builds](/advanced/production) for the complete production guide.

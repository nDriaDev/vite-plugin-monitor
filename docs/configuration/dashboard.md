# Dashboard

The vite-plugin-monitor dashboard is a standalone Vanilla TypeScript SPA with no framework dependencies. It is served directly by the plugin and isolated in the browser with no interference from your application styles.

## Accessing the Dashboard

In development (middleware mode), the dashboard is available at:

```
http://localhost:5173/_dashboard    (default route)
```

After `vite dev` starts, the tracker API and dashboard URLs are printed in the terminal:

```
  ➜  Local:   http://localhost:5173/
  ➜  vite-plugin-monitor Tracker API:   http://localhost:5173/_tracker
  ➜  vite-plugin-monitor Dashboard:     http://localhost:5173/_dashboard
```

## Login Gate

If `dashboard.auth` is configured, the dashboard shows a login form before granting access.

```typescript
dashboard: {
  auth: { username: 'admin', password: 'secret' },
}
```

Credentials are HMAC-hashed with `appId` client-side. See [Security](/advanced/security) for details.

## Time Range Selector

The header contains a time range picker with six presets:

| Range | Mode |
|-------|------|
| **Live** | Auto-polls at `pollInterval` ms |
| **1h** | Last 1 hour, fetched once |
| **6h** | Last 6 hours |
| **24h** | Last 24 hours |
| **7d** | Last 7 days |
| **30d** | Last 30 days |

In **Live** mode the KPI cards, charts, and top lists update automatically. All other modes require a manual refresh (navigating away and back, or changing the time range).

## Metrics Tab

### KPI Cards

Four summary cards at the top of the Metrics tab:

| Card | Description |
|------|-------------|
| **Active Sessions** | Distinct `sessionId` values with at least one event in the last 5 minutes |
| **Total Events** | Total count of all events |
| **Unique Users** | Distinct `userId` values (anonymous IDs counted separately) |
| **App Error Rate** | Percentage of events with `type: 'error'` (JS errors only — HTTP 4xx/5xx excluded) |

### Top Lists

Four ranked lists:

| List | Description |
|------|-------------|
| **Top Pages** | Most visited routes (from `meta.route`) |
| **Top App Errors** | Most frequent error messages (from `ErrorPayload.message`) |
| **Navigation Funnel** | Most common navigation sequences (`from` → `to`) |
| **Top Endpoints** | Most called HTTP endpoints (method + URL pattern) |

### HTTP Metrics

Aggregated HTTP statistics for the selected time window:

| Metric | Description |
|--------|-------------|
| **Most Called Endpoint** | Highest request count endpoint |
| **Avg HTTP Duration** | Mean response time across all HTTP events |
| **HTTP Error Rate** | Percentage of HTTP events with status 4xx or 5xx |
| **Slowest Endpoint** | Endpoint with highest average duration |
| **Total Requests** | Total HTTP event count |
| **2xx / 4xx / 5xx** | Count breakdown by HTTP status class |

### Charts

Two time-series charts:

- **Event Volume** — Total event count over time (configurable as line or bar chart)
- **Error Rate %** — Percentage of error-level events over time

## Events Tab

A paginated, filterable table of all tracked events.

### Filters

| Filter | Description |
|--------|-------------|
| **Type** | Filter by event type: `click`, `http`, `error`, `navigation`, `console`, `custom`, `session` |
| **Level** | Filter by severity: `debug`, `info`, `warn`, `error` |
| **User ID** | Filter events from a specific user |
| **Route** | Filter events from a specific route |
| **Search** | Full-text search across all event fields |

### Event Detail Panel

Click any row in the events table to open the detail panel. It shows:

- Full `payload` object (type-specific fields)
- Full `meta` object (browser metadata)
- `sessionId`, `userId`, `appId`, `groupId`
- `timestamp`, `level`, `type`

## Backend Status Indicator

The header shows a coloured status dot:

- 🟢 **Online** — backend is reachable
- 🔴 **Offline** — `pingEndpoint` unreachable or returning errors

In middleware mode, the backend is the Vite dev server itself. The ping endpoint is always `/_tracker/ping`.

## Aggregation Architecture

All filtering and aggregation is performed **client-side in the browser**. A single unified polling loop handles both the Metrics tab and the Events tab:

1. One `fetchAllEvents(since, until)` request per tick — the same payload is shared between both pipelines, eliminating the double-fetch that existed in earlier versions.
2. `computeAll()` runs a single pass over the event array, producing KPI metrics, top lists, stats, and both chart time-series (Event Volume and Error Rate) simultaneously. The three independently-configurable chart bucket granularities are computed in the same pass with no redundant iterations.
3. The in-memory `rawEvents` buffer is stored in the dashboard state and reused by filter handlers — changing the Event Volume or Error Rate bucket granularity re-aggregates the cached events without a new network request.

This design means:
- Your backend only needs to implement time-range filtering
- Re-filtering (by type, level, user, route, search) is instant with no latency
- Changing chart bucket granularities costs zero network round-trips
- The full dataset is available for the Events table without server-side pagination

# Production Builds

This guide covers everything you need to deploy vite-plugin-monitor in a production environment.

## Choosing a Storage Mode

`mode: 'auto'` (the default) **throws at build time** if no `writeEndpoint` is configured. Always set the mode explicitly for production:

| Scenario | Recommended mode |
|----------|-----------------|
| REST API backend | `'http'` |
| Real-time WebSocket backend | `'websocket'` |
| No backend, events not needed in prod | `enabled: false` |

## HTTP Mode (Most Common)

### Vite Config

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { trackerPlugin } from '@ndriadev/vite-plugin-monitor'

export default defineConfig(({ mode }) => ({
  plugins: [
    trackerPlugin({
      enabled: mode !== 'test',  // disable in test environments
      appId: 'my-app',

      storage: {
        mode:          'http',
        writeEndpoint: process.env.VITE_TRACKER_WRITE_URL!,
        readEndpoint:  process.env.VITE_TRACKER_READ_URL,
        pingEndpoint:  process.env.VITE_TRACKER_PING_URL,
        apiKey:        process.env.VITE_TRACKER_API_KEY,
        batchSize:     50,
        flushInterval: 5000,
      },

      track: {
        clicks:     true,
        http:       true,
        errors:     true,
        navigation: true,
        console:    false,  // avoid leaking console output in production
      },

      dashboard: {
        enabled:        true,
        route:          '/_dashboard',
        auth:           { username: 'ops', password: process.env.DASHBOARD_PASSWORD! },
        includeInBuild: true,
        pollInterval:   5000,
      },
    }),
  ],
}))
```

### Environment Variables (.env.production)

```bash
VITE_TRACKER_WRITE_URL=https://api.myapp.com/tracker/ingest
VITE_TRACKER_READ_URL=https://api.myapp.com/tracker/events
VITE_TRACKER_PING_URL=https://api.myapp.com/health
VITE_TRACKER_API_KEY=tk_prod_xxxxxxxxxxxxxxxxxxxx
DASHBOARD_PASSWORD=a-strong-password
```

### Backend Requirements

Your backend must implement at minimum:

**Ingest endpoint (required):**
```
POST /tracker/ingest
Content-Type: application/json
X-Tracker-Key: <apiKey>

{ "events": TrackerEvent[] }

→ 200 OK  (or any 2xx)
```

**Read endpoint (required for dashboard):**
```
GET /tracker/events?since=2024-01-01T00:00:00.000Z&until=2024-01-02T00:00:00.000Z
X-Tracker-Key: <apiKey>

→ { "events": TrackerEvent[], "total": 123 }
```

See [API Contracts](/reference/api-contracts) for the complete specification.

---

## Including the Dashboard in the Build

When `dashboard.includeInBuild: true`, the plugin copies the pre-built dashboard SPA into your `dist/` directory during `vite build`.

### Build Order

::: warning Always build the dashboard first
```bash
# 1. Build the dashboard SPA
pnpm build:dashboard

# 2. Build your application (dashboard is copied into dist/)
pnpm build
```

If you run `vite build` without the dashboard being built first, the plugin logs a warning but **does not fail the build**. The dashboard simply won't be present in `dist/`.
:::

### Output Structure

After a successful build with `dashboard.route: '/_dashboard'`:

```
dist/
├── index.html
├── assets/
│   ├── index-abc123.js
│   └── index-abc123.css
└── _dashboard/
    ├── index.html           ← config injected here at build time
    ├── assets/
    │   ├── dashboard-xyz.js
    │   └── dashboard-xyz.css
    └── favicon-96x96.png
```

### Server Configuration

The dashboard is a SPA — all sub-paths must serve `index.html`.

**Nginx:**
```nginx
# Main app
location / {
  root /var/www/my-app;
  try_files $uri $uri/ /index.html;
}

# Dashboard SPA
location /_dashboard {
  root /var/www/my-app;
  try_files $uri $uri/ /_dashboard/index.html;
}
```

**Vercel (`vercel.json`):**
```json
{
  "rewrites": [
    { "source": "/_dashboard/:path*", "destination": "/_dashboard/index.html" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

**Express / Node.js:**
```typescript
import express from 'express'
import path from 'path'

const app = express()
const dist = path.resolve(__dirname, 'dist')

app.use(express.static(dist))

// Dashboard SPA fallback
app.get('/_dashboard*', (req, res) => {
  res.sendFile(path.join(dist, '_dashboard', 'index.html'))
})

// Main app SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(dist, 'index.html'))
})
```

---

## WebSocket Mode

```typescript
trackerPlugin({
  appId: 'my-app',
  storage: {
    mode:         'websocket',
    wsEndpoint:   process.env.VITE_TRACKER_WS_URL!,   // wss://...
    pingEndpoint: process.env.VITE_TRACKER_PING_URL,
    apiKey:       process.env.VITE_TRACKER_API_KEY,
    batchSize:    25,
    flushInterval: 3000,
  },
  track: { clicks: true, http: true, errors: true, navigation: true },
})
```

See [WebSocket Protocol](/reference/api-contracts#websocket-protocol) for the server implementation contract.

---

## Disabling in Specific Environments

### Disable in CI/Test

```typescript
trackerPlugin({
  appId:   'my-app',
  enabled: !process.env.CI && process.env.NODE_ENV !== 'test',
})
```

### Dev vs Prod Split Config

```typescript
// vite.config.ts
export default defineConfig(({ mode }) => {
  const isDev = mode === 'development'

  return {
    plugins: [
      trackerPlugin({
        appId: 'my-app',
        storage: isDev
          ? { mode: 'middleware' }
          : {
              mode:          'http',
              writeEndpoint: process.env.VITE_TRACKER_WRITE_URL!,
              apiKey:        process.env.VITE_TRACKER_API_KEY,
            },
        track: {
          clicks:     true,
          http:       true,
          errors:     true,
          navigation: true,
          console:    isDev,  // console tracking only in dev
        },
        dashboard: {
          enabled:        true,
          route:          '/_dashboard',
          includeInBuild: !isDev,
          auth:           isDev
            ? false
            : { username: 'ops', password: process.env.DASHBOARD_PASSWORD! },
        },
        overlay: { enabled: isDev },
      }),
    ],
  }
})
```

---

## Production Checklist

- [ ] `storage.mode` explicitly set to `'http'` or `'websocket'`
- [ ] `storage.writeEndpoint` set and reachable
- [ ] Backend implements the [ingest endpoint](/reference/api-contracts#ingest-endpoint-http)
- [ ] `track.console` set to `false` or restricted to `['error', 'warn']`
- [ ] `dashboard.auth` configured if dashboard is included in build
- [ ] Dashboard route protected at the reverse proxy level for production security
- [ ] `pnpm build:dashboard` run before `vite build` if `includeInBuild: true`
- [ ] SPA fallback configured on the web server for `/_dashboard`
- [ ] Log file permissions and retention policy reviewed
- [ ] Sensitive fields added to `http.redactKeys` for your data model

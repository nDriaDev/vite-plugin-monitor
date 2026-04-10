# Plugin Options

The `trackerPlugin()` function accepts a single configuration object. Only `appId` is required — everything else has sensible defaults.

```typescript
import { trackerPlugin } from '@ndriadev/vite-plugin-monitor'

trackerPlugin(options: TrackerPluginOptions)
```

## Top-Level Options

### `appId` <Badge type="danger" text="required" />

**Type:** `string`

Unique identifier for your application. Attached to every `TrackerEvent` as `event.appId`. Throws at startup if missing.

```typescript
trackerPlugin({ appId: 'my-app' })
```

Used in two ways:
1. Stamped on every event — allows a single backend to distinguish events from multiple frontend apps.
2. Used as the HMAC key when hashing dashboard credentials (`dashboard.auth`).

---

### `enabled`

**Type:** `boolean` · **Default:** `true`

Master switch. When `false`, the plugin is a **complete no-op**: no scripts are injected, no server is started, no logs are written, no event proxies are installed.

```typescript
trackerPlugin({
  appId: 'my-app',
  enabled: process.env.NODE_ENV !== 'test',
})
```

---

### `autoInit`

**Type:** `boolean` · **Default:** `true`

Controls whether `tracker.init()` is automatically called at page load.

| Value | Behavior |
|-------|----------|
| `true` | Plugin injects both the setup script (proxies) and the auto-init script. Everything starts immediately. |
| `false` | Only the setup script (proxies) is injected. You must call `tracker.init()` manually from your application code. |

::: tip When to use `autoInit: false`
- After a **cookie consent** banner
- After **user authentication**
- Only in specific environments (e.g. staging but not production)
:::

::: warning Proxies are always installed
Even with `autoInit: false`, the setup script that installs `fetch`, `XHR`, `console`, and `history` proxies is **always injected at `head-prepend`**. This is intentional — proxies must run before any application code to capture all events. `autoInit: false` only delays the call to `tracker.init()`.
:::

See [Manual Initialization](/advanced/manual-init) for a complete guide.

---

### `track`

**Type:** [`TrackOptions`](/configuration/trackers)

Controls which browser interactions to track. See [Trackers](/configuration/trackers) for all options.

```typescript
trackerPlugin({
  appId: 'my-app',
  track: {
    clicks:     true,
    http:       true,
    errors:     true,
    navigation: true,
    console:    { methods: ['error', 'warn'] },
  },
})
```

---

### `storage`

**Type:** [`StorageOptions`](/configuration/storage)

Controls how events are transported and stored. See [Storage](/configuration/storage) for all modes and options.

```typescript
trackerPlugin({
  appId: 'my-app',
  storage: {
    mode:          'http',
    writeEndpoint: 'https://api.myapp.com/tracker/events',
  },
})
```

---

### `logging`

**Type:** [`LoggingOptions`](/configuration/logging)

Controls server-side log file output. See [Logging](/configuration/logging) for all options.

```typescript
trackerPlugin({
  appId: 'my-app',
  logging: {
    level: 'warn',
    transports: [
      { format: 'json', path: './logs/monitor.jsonl' },
    ],
  },
})
```

---

### `dashboard`

**Type:** [`DashboardOptions`](/configuration/dashboard)

Controls the built-in dashboard SPA. See [Dashboard](/configuration/dashboard) for all options.

```typescript
trackerPlugin({
  appId: 'my-app',
  dashboard: {
    enabled: true,
    route:   '/_dashboard',
  },
})
```

---

### `overlay`

**Type:** [`OverlayOptions`](/configuration/overlay)

Controls the floating debug overlay. See [Overlay](/configuration/overlay) for all options.

```typescript
trackerPlugin({
  appId: 'my-app',
  overlay: {
    enabled:  true,
    position: 'bottom-right',
  },
})
```

---

## Full Example

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { trackerPlugin } from '@ndriadev/vite-plugin-monitor'

export default defineConfig({
  plugins: [
    trackerPlugin({
      // Required
      appId: 'my-app',

      // Optional — defaults shown
      enabled:  true,
      autoInit: true,

      track: {
        clicks:     false,
        http:       false,
        errors:     false,
        navigation: false,
        console:    true,
        level:      'info',
      },

      storage: {
        mode:          'auto',
        batchSize:     25,
        flushInterval: 3000,
        maxBufferSize: 500000,
        port:          4242,
      },

      logging: {
        level: 'info',
        transports: [
          {
            format: 'json',
            path:   './logs/my-app.log',
            rotation: {
              strategy: 'daily',
              maxFiles: 30,
              compress: false,
            },
          },
        ],
      },

      dashboard: {
        enabled:        false,
        route:          '/_dashboard',
        auth:           false,
        includeInBuild: false,
        pollInterval:   3000,
      },

      overlay: {
        enabled:  false,
        position: 'bottom-right',
      },
    }),
  ],
})
```

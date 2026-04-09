# Quick Start

This guide walks you from zero to a fully functional tracker with dashboard and overlay in five minutes.

## Minimal Setup (Console Only)

The simplest possible configuration — only `appId` is required:

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { trackerPlugin } from '@ndriadev/vite-plugin-monitor'

export default defineConfig({
  plugins: [
    trackerPlugin({
      appId: 'my-app',
    }),
  ],
})
```

This immediately starts capturing all `console.*` calls and writing them to `./logs/my-app.log`.

## Enable All Trackers

To get comprehensive tracking with the dashboard and debug overlay:

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { trackerPlugin } from '@ndriadev/vite-plugin-monitor'

export default defineConfig({
  plugins: [
    trackerPlugin({
      appId: 'my-app',

      track: {
        clicks:     true,  // single delegated click listener
        http:       true,  // patches fetch + XHR
        errors:     true,  // window.onerror + unhandledrejection
        navigation: true,  // history API + hashchange + load
        // console is true by default
      },

      dashboard: {
        enabled: true,
        route:   '/_dashboard',  // open http://localhost:5173/_dashboard
      },

      overlay: {
        enabled:  true,
        position: 'bottom-right',
      },
    }),
  ],
})
```

Start your dev server and:

- Open **http://localhost:5173** — the overlay FAB appears in the bottom-right corner.
- Open **http://localhost:5173/_dashboard** — the live dashboard shows real-time events.
- Interact with your app — clicks, navigations, and HTTP requests appear instantly.

## Step-by-Step Walkthrough

### 1. Start the Dev Server

```bash
pnpm dev
# or
npm run dev
```

In the terminal you'll see:

```
  ➜  Local:   http://localhost:5173/
  ➜  vite-plugin-monitor Tracker API:   http://localhost:5173/_tracker
  ➜  vite-plugin-monitor Dashboard:     http://localhost:5173/_dashboard
```

### 2. Open the Dashboard

Navigate to `http://localhost:5173/_dashboard`. You'll see the dashboard with all KPI cards at zero.

### 3. Interact with Your App

Switch to your app tab and perform some actions — click buttons, navigate to different pages, make API calls. Switch back to the dashboard and watch the events populate in real time.

### 4. Inspect Individual Events

In the **Events** tab, click any row in the events table. The detail panel on the right shows the full event payload, metadata, session info, and all associated fields.

### 5. Identify Yourself (Optional)

Click the FAB button in the bottom-right corner of your app to open the overlay. You can type a user ID in the "User ID" field — subsequent events will carry that identity.

Alternatively, configure a `userId` resolver in `track`:

```typescript
track: {
  userId: () => localStorage.getItem('userId'),
}
```

## Common Recipes

### Development with All Features

```typescript
trackerPlugin({
  appId: 'my-app',
  track: {
    clicks:     true,
    http:       true,
    errors:     true,
    navigation: true,
    console:    { methods: ['error', 'warn'] }, // only capture errors/warnings
  },
  dashboard: { enabled: true },
  overlay:   { enabled: true },
})
```

### Capture After Consent Banner

```typescript
// vite.config.ts
trackerPlugin({
  appId: 'my-app',
  autoInit: false,  // delay init until consent is given
  track: { clicks: true, http: true, errors: true, navigation: true },
})
```

```typescript
// In your app (e.g. after consent banner is accepted)
import { tracker } from '@ndriadev/vite-plugin-monitor/client'

consentBanner.onAccept(() => {
  tracker.init(() => localStorage.getItem('userId'))
})
```

See [Manual Initialization](/advanced/manual-init) for more details.

### Production HTTP Mode

```typescript
trackerPlugin({
  appId: 'my-app',
  storage: {
    mode:          'http',
    writeEndpoint: 'https://api.myapp.com/tracker/events',
    readEndpoint:  'https://api.myapp.com/tracker',
    apiKey:        process.env.TRACKER_API_KEY,
  },
  track: { clicks: true, http: true, errors: true, navigation: true },
})
```

See [HTTP Mode](/guide/storage-modes#http-mode) for the full backend contract.

## Next Steps

- [Storage Modes](/guide/storage-modes) — Choose the right mode for your use case
- [Configuration Reference](/configuration/plugin-options) — All available options
- [Client API](/client-api/overview) — Manual events, timers, groups
- [Dashboard](/advanced/dashboard) — Dashboard features in depth

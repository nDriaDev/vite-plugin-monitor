# Manual Initialization

By default (`autoInit: true`), the plugin calls `tracker.init()` automatically at page load. Setting `autoInit: false` lets you delay initialization until the right moment — after a consent banner, after authentication, or only in specific conditions.

## Why Manual Init?

| Scenario | Reason |
|----------|--------|
| **Cookie consent** | You must not track users who haven't consented to analytics |
| **Authentication gate** | User ID is only available after login — you want to initialize with the real ID |
| **Conditional tracking** | Only enable tracking in staging/production, not in unit test runs |
| **SPA lazy loading** | Initialize only after the application shell has mounted |

## Setup

Set `autoInit: false` in the plugin config:

```typescript
// vite.config.ts
trackerPlugin({
  appId:    'my-app',
  autoInit: false,           // ← disable auto-init
  track: {
    clicks:     true,
    http:       true,
    errors:     true,
    navigation: true,
  },
})
```

Then call `tracker.init()` from your application code at the right moment:

```typescript
import { tracker } from '@ndriadev/vite-plugin-monitor/client'

tracker.init(() => getCurrentUserId())
```

## How It Works Internally

Even with `autoInit: false`, the **setup script** that installs all event proxies is **always injected** at `head-prepend`:

```html
<!-- Injected by plugin (always, even when autoInit: false) -->
<script type="module">
  import { setupTrackers } from '/@fs/.../client/index.js'
  Object.defineProperty(window, '__TRACKER_CONFIG__', { value: Object.freeze({...}), ... })
  setupTrackers()
  // ← tracker.init() is NOT called here
</script>
```

This means:
- Event proxies (`fetch`, `XHR`, `console`, `history`) are installed immediately
- Events are **enqueued** from the very first line of application code
- Events are **not flushed** until `tracker.init()` is called
- The event queue holds events without sending them to the backend

When you eventually call `tracker.init()`, the flush timer activates and the queued events are sent in the next flush cycle.

## Patterns

### After Cookie Consent Banner

```typescript
// src/main.ts (or App.tsx, etc.)
import { tracker } from '@ndriadev/vite-plugin-monitor/client'

async function bootstrap() {
  // Show consent banner and wait for user decision
  const consent = await showCookieConsentBanner()

  if (consent.analytics) {
    tracker.init(() => localStorage.getItem('userId'))
  }
  // If consent denied: tracker.init() is never called
  // All queued events are silently discarded
}

bootstrap()
```

### After Authentication

```typescript
// src/auth.ts
import { tracker } from '@ndriadev/vite-plugin-monitor/client'

let trackerInitialized = false

authService.onAuthStateChange((user) => {
  if (user && !trackerInitialized) {
    trackerInitialized = true
    tracker.init(() => user.id)
    tracker.setContext({ plan: user.plan, role: user.role })
  }

  if (!user) {
    tracker.setUser(null)
  }
})
```

### React — Auth Store Integration

```typescript
// vite.config.ts
trackerPlugin({ appId: 'my-app', autoInit: false, track: { clicks: true, errors: true } })
```

```typescript
// src/components/TrackerProvider.tsx
import { useEffect } from 'react'
import { tracker } from '@ndriadev/vite-plugin-monitor/client'
import { useAuthStore } from '@/stores/auth'

export function TrackerProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useAuthStore()

  useEffect(() => {
    if (!isLoaded) return

    tracker.init(() => user?.id ?? null)
  }, [isLoaded]) // Run once when auth state is first known

  useEffect(() => {
    if (!isLoaded) return
    tracker.setUser(user?.id ?? null)
  }, [user?.id, isLoaded]) // Update on user change

  return <>{children}</>
}
```

```typescript
// src/main.tsx
import { TrackerProvider } from './components/TrackerProvider'

createRoot(document.getElementById('root')!).render(
  <TrackerProvider>
    <App />
  </TrackerProvider>
)
```

### Vue 3 — Pinia Store Integration

```typescript
// src/plugins/tracker.ts
import { tracker } from '@ndriadev/vite-plugin-monitor/client'
import { useAuthStore } from '@/stores/auth'
import { watch } from 'vue'

let initialized = false

export function initTracker() {
  const authStore = useAuthStore()

  watch(
    () => authStore.isReady,
    (isReady) => {
      if (isReady && !initialized) {
        initialized = true
        tracker.init(() => authStore.user?.id ?? null)
      }
    },
    { immediate: true }
  )

  watch(
    () => authStore.user?.id,
    (userId) => {
      tracker.setUser(userId ?? null)
    }
  )
}
```

### Conditional by Environment Flag

```typescript
// src/main.ts
import { tracker } from '@ndriadev/vite-plugin-monitor/client'

if (import.meta.env.VITE_ENABLE_TRACKING === 'true') {
  tracker.init(() => localStorage.getItem('userId'))
}
```

## Queue Behavior During Pre-Init Period

While waiting for `tracker.init()` to be called, the event queue accumulates events:

- Events are stored in memory
- The queue has no hard limit during pre-init (it grows until init or page close)
- On page unload **before** `init()` is ever called: queued events are **silently discarded** (there is no endpoint to send them to yet)
- After `init()`: queued events are flushed on the next timer tick

::: tip Don't delay init indefinitely
If `tracker.init()` is never called (e.g. the user always declines consent), memory is freed when the page unloads. There is no leak.

However, if your consent banner is slow to appear or the user takes a long time to decide, consider whether the pre-init queue might grow very large. For most apps this is not a concern.
:::

## `tracker` Proxy — Safe to Call Before Init

All `tracker.*` method calls before `tracker.init()` are **silently dropped** by the safe proxy. You can call them anywhere without guarding:

```typescript
// These are always safe — even before init()
tracker.setContext({ appVersion: '2.1.0' })  // no-op before init
tracker.track('app:mounted')                  // no-op before init
tracker.setUser(userId)                       // no-op before init
```

The only method that matters before init is `tracker.init()` itself.

# tracker.init()

Initializes the tracker. Activates the event flush timer, mounts the overlay (if enabled), and emits the initial `session:start` event.

```typescript
tracker.init(userIdFn?: () => string | null): void
```

## Parameters

### `userIdFn` (optional)

**Type:** `() => string | null`

A function that returns the current user ID. Called once at init time to set the initial user identity for the session.

- Return a `string` to identify the user.
- Return `null` to use an anonymous session-scoped ID.

```typescript
// Anonymous
tracker.init()

// With user ID from localStorage
tracker.init(() => localStorage.getItem('userId'))

// With user ID from a global auth object
tracker.init(() => window.__auth?.userId ?? null)

// With user ID from a store (must be synchronous)
tracker.init(() => authStore.getState().userId)
```

## Behavior

- **Singleton**: safe to call multiple times — subsequent calls are **no-ops**. The tracker is initialized exactly once per page lifetime.
- **Reuses pre-init client**: if `setupTrackers()` was called first (which happens automatically via the injected setup script), `init()` reuses the same `TrackerClient` instance already holding the queued events. If called without a prior `setupTrackers()` (e.g. in a fully manual setup), a fresh client is created.
- **Queue activation**: calling `init()` activates the event flush timer. Events enqueued before `init()` (by the auto-trackers) are flushed on the first interval.

## When Is It Called?

### Automatic (`autoInit: true`, default)

The plugin injects an auto-init script that calls `tracker.init(userIdFn)` automatically. You don't need to call it yourself.

The `userIdFn` used is the one configured in `track.userId`:

```typescript
// vite.config.ts
trackerPlugin({
  appId: 'my-app',
  track: {
    userId: () => localStorage.getItem('userId'),
  },
})
// ↑ This serializes the function and injects:
// tracker.init(() => localStorage.getItem('userId'))
```

### Manual (`autoInit: false`)

When `autoInit: false`, you must call `tracker.init()` yourself:

```typescript
// vite.config.ts
trackerPlugin({
  appId: 'my-app',
  autoInit: false,
})

// In your app
import { tracker } from '@ndriadev/vite-plugin-monitor/client'
tracker.init(() => getAuthStore().userId ?? null)
```

## Examples

### After Cookie Consent

```typescript
import { tracker } from '@ndriadev/vite-plugin-monitor/client'

async function bootstrap() {
  const consent = await showCookieConsentBanner()

  if (consent.analytics) {
    tracker.init(() => localStorage.getItem('userId'))
  }
}
```

### After Authentication

```typescript
import { tracker } from '@ndriadev/vite-plugin-monitor/client'

authService.onLogin((user) => {
  tracker.init(() => user.id)
})
```

### Conditional by Environment

```typescript
import { tracker } from '@ndriadev/vite-plugin-monitor/client'

if (import.meta.env.VITE_ENABLE_ANALYTICS === 'true') {
  tracker.init(() => window.__auth?.id ?? null)
}
```

## Session Start Event

When `tracker.init()` is called, a `session:start` event is automatically emitted:

```json
{
  "type":      "session",
  "level":     "info",
  "userId":    "user_123",
  "payload": {
    "action":  "start",
    "trigger": "init"
  }
}
```

Note: `userId` is part of the **event envelope** (the `TrackerEvent` wrapper), not the `SessionPayload`. The payload for an `init` trigger carries only `action` and `trigger`.

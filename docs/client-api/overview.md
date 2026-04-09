# Client API Overview

The client API gives you programmatic control over the tracker from within your application code. It is available via the `@ndriadev/vite-plugin-monitor/client` entry point.

```typescript
import { tracker } from '@ndriadev/vite-plugin-monitor/client'
```

## When Do You Need the Client API?

The auto-tracking features (clicks, HTTP, errors, navigation, console) require **no client API imports**. They are installed automatically by the setup script injected into `index.html`.

You need the client API when you want to:

| Use case | API |
|----------|-----|
| Delay init until consent/auth | [`tracker.init()`](/client-api/init) |
| Track custom business events | [`tracker.track()`](/client-api/track) |
| Update user identity after login/logout | [`tracker.setUser()`](/client-api/set-user) |
| Attach global metadata to all events | [`tracker.setContext()`](/client-api/set-context) |
| Time an async operation | [`tracker.time()` / `tracker.timeEnd()`](/client-api/timers) |
| Group related events together | [`tracker.group()`](/client-api/groups) |
| Tear down the tracker (e.g. on logout) | [`tracker.destroy()`](/client-api/destroy) |

## The `tracker` Proxy

The `tracker` export is a **safe proxy**. All method calls are **silently dropped** if the tracker has not been initialized yet (before `tracker.init()` is called, or in SSR/Node.js environments). This means you can safely call `tracker.track()` anywhere in your code without guarding with `if (tracker)`.

```typescript
// This is always safe — no error if called before init()
tracker.track('page:viewed', { path: '/home' })
```

## Methods

| Method | Description |
|--------|-------------|
| [`tracker.init(userIdFn?)`](/client-api/init) | Initialize the tracker. Safe to call multiple times (singleton). |
| [`tracker.track(name, data?, opts?)`](/client-api/track) | Emit a custom event. |
| [`tracker.setUser(userId, opts?)`](/client-api/set-user) | Update the user identity. |
| [`tracker.setContext(attrs)`](/client-api/set-context) | Attach persistent metadata to all future events. |
| [`tracker.time(label)`](/client-api/timers) | Start a named timer. |
| [`tracker.timeEnd(label, data?, opts?)`](/client-api/timers) | Stop a timer and emit a custom event with `duration`. |
| [`tracker.group(name)`](/client-api/groups) | Generate a unique group ID for correlated events. |
| [`tracker.destroy()`](/client-api/destroy) | Tear down the tracker completely. |

## TypeScript

The `tracker` object is fully typed. Import the `ITrackerClient` interface for type-checking:

```typescript
import type { ITrackerClient } from '@ndriadev/vite-plugin-monitor'
```

## Framework Integration Examples

### React

```typescript
// src/main.tsx
import { tracker } from '@ndriadev/vite-plugin-monitor/client'
import { useEffect } from 'react'
import { useAuth } from './hooks/useAuth'

function AuthSync() {
  const { user } = useAuth()

  useEffect(() => {
    if (user) {
      tracker.setUser(user.id, { attributes: { plan: user.plan } })
    } else {
      tracker.setUser(null)
    }
  }, [user])

  return null
}
```

### Vue 3

```typescript
// src/plugins/tracker.ts
import { tracker } from '@ndriadev/vite-plugin-monitor/client'
import { watch } from 'vue'
import { useUserStore } from '@/stores/user'

export function setupTrackerSync() {
  const userStore = useUserStore()

  watch(
    () => userStore.currentUser,
    (user) => {
      if (user) {
        tracker.setUser(user.id)
      } else {
        tracker.setUser(null)
      }
    },
    { immediate: true }
  )
}
```

### Svelte

```svelte
<script lang="ts">
import { tracker } from '@ndriadev/vite-plugin-monitor/client'
import { user } from './stores/auth'

$: if ($user) {
  tracker.setUser($user.id)
} else {
  tracker.setUser(null)
}
</script>
```

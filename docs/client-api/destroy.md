# tracker.destroy()

Tear down the tracker completely. Emits a final `session:end` event, flushes all queued events, removes all event proxies, and destroys the overlay.

```typescript
tracker.destroy(): void
```

## What It Does

1. Emits a `session:end` event with `source: 'destroy'`
2. Flushes the event queue (sends any remaining events)
3. Stops the flush timer
4. Removes all event proxies (`fetch`, `XHR`, `console`, `history`)
5. Removes all DOM event listeners (`click`, `popstate`, `hashchange`, etc.)
6. Destroys the overlay (removes the host element from the DOM)
7. Marks the tracker as uninitialized — subsequent calls to `tracker.track()` etc. are dropped silently

## When to Use

```typescript
import { tracker } from '@ndriadev/vite-plugin-monitor/client'

// Explicit cleanup (e.g. when the user opts out of tracking)
function onTrackingOptOut() {
  tracker.destroy()
}

// Cleanup before a full-page logout redirect
authService.onLogout(() => {
  tracker.destroy()
  window.location.href = '/login'
})
```

::: info Re-initialization after destroy
After calling `tracker.destroy()`, the tracker cannot be re-initialized in the same page lifetime. If you need to start/stop tracking based on user preference without a page reload, consider using `tracker.setUser(null)` (to anonymize) rather than a full `tracker.destroy()`.
:::

## Overlay Destroy

The overlay can also be removed independently using the **"Remove Tracker Info"** button in the overlay UI, which calls `tracker.destroy()` internally.

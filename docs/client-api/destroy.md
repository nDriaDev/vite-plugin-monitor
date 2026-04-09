# tracker.destroy()

Tear down the tracker completely. Emits a final `session:end` event, flushes all queued events, removes all event proxies, and destroys the overlay.

```typescript
tracker.destroy(): void
```

## What It Does

1. Emits a `session:end` event with `trigger: 'destroy'`
2. Removes all event proxies (`fetch`, `XHR`, `console`, `history`) and DOM event listeners (`click`, `popstate`, `hashchange`, etc.)
3. Destroys the overlay (removes the host element from the DOM)
4. Clears all active named timers started via `tracker.time()`
5. Flushes the event queue (sends any remaining events via `fetch` or `sendBeacon`)
6. Stops the flush interval timer permanently and closes the WebSocket connection (if open)
7. Clears the singleton — subsequent calls to `tracker.track()` etc. are **silently dropped**

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

The **"Remove Tracker Info"** button in the overlay UI removes only the overlay widget from the DOM. It does **not** call `tracker.destroy()` — automatic tracking continues to run in the background.

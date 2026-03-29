# Troubleshooting

Common issues and their solutions.

## Events Not Appearing in the Dashboard

**Check list:**

1. **Are the auto-trackers enabled?**

   All auto-trackers except `console` default to `false`. Verify your config:
   ```typescript
   track: {
     clicks:     true,  // default: false
     http:       true,  // default: false
     errors:     true,  // default: false
     navigation: true,  // default: false
   }
   ```

2. **Is the ingest request succeeding?**

   Open the browser DevTools → Network tab → filter for `_tracker`. Look for the `POST /_tracker/events` request. A non-`2xx` response causes the batch to be re-queued (events eventually appear after retry) or lost.

3. **Is `track.level` filtering events out?**

   `track.level: 'info'` (default) discards `'debug'` events before they enter the queue. If you're testing with `'debug'` level custom events, either lower `track.level` or use `{ level: 'info' }` in `tracker.track()`.

4. **Is `autoInit: false` and `tracker.init()` was never called?**

   With `autoInit: false`, all `tracker.*` calls are silently dropped until `tracker.init()` is called. Check the browser console for `[tracker]` messages.

5. **Is the plugin `enabled: false`?**

   Check if `enabled` is conditionally set to `false` in your environment.

---

## Dashboard Shows "Backend Offline"

The red status dot in the dashboard header means the `pingEndpoint` is unreachable.

**By mode:**

| Mode | Backend | What to check |
|------|---------|---------------|
| `middleware` | Vite dev server | Is `vite dev` running? Reload the terminal. |
| `standalone` | Plugin-managed server on `port` | Check the Vite terminal for `EADDRINUSE` errors. Try changing `storage.port`. |
| `http` | Your backend | Is `storage.pingEndpoint` reachable from the browser? Check CORS headers. |
| `websocket` | Your backend | Is `storage.pingEndpoint` reachable? Is the WS server running? |

---

## `window.__TRACKER_CONFIG__ not found`

This error from the dashboard means the Vite dev server is not running or the page was opened without going through Vite.

- **Always** open the app through `http://localhost:5173` (not as `file:///...`)
- Ensure Vite's dev server is running (`pnpm dev`)
- If using a different port, check `viteConfig.server.port`

---

## No Log Files Created

1. **Has Vite been started at least once?**

   Log directories are created in the `buildStart` hook (triggered by `vite dev` or `vite build`).

2. **Does the process have write permission?**

   Check filesystem permissions on the log directory path.

3. **Is `logging.level` too high?**

   If `logging.level: 'error'` and no error events are being tracked, the file exists but may be empty.

4. **Is `enabled: false`?**

   When the plugin is disabled, no logger worker is started and no files are created.

---

## HTTP Bodies Are `[REDACTED]`

The built-in redaction pipeline is intentional and **cannot be disabled** for the built-in patterns. Keys matching `password`, `token`, `secret`, `card`, `cvv`, `iban`, and others are always replaced with `'[REDACTED]'`.

If you're seeing redaction on keys you didn't expect, check if the key name contains any substring from the built-in pattern list (case-insensitive).

To add more keys: use `http.redactKeys`. You cannot remove built-in keys.

---

## `tracker.track()` Calls Are Silently Dropped

The `tracker` proxy silently drops all calls until `tracker.init()` is called.

**Checklist:**

1. Is `autoInit: false` set? → Call `tracker.init()` manually.
2. Is `autoInit: true` (default) but `enabled: false`? → No-op plugin.
3. Is the call happening in SSR/Node.js context? → The client API is browser-only.

**Debug tip:** Add a temporary `console.log` before and after `tracker.init()` to confirm it's being called:

```typescript
console.log('[debug] calling tracker.init')
tracker.init(() => localStorage.getItem('userId'))
console.log('[debug] tracker.init done')
```

---

## Production Build Fails: `writeEndpoint` Required

```
[vite-plugin-monitor] Production build requires storage.mode = "http" with a valid writeEndpoint.
```

This error means you ran `vite build` with `storage.mode: 'auto'` and no `writeEndpoint`. Fix:

```typescript
storage: {
  mode:          'http',          // ← set explicitly
  writeEndpoint: 'https://...',   // ← required
}
```

Or disable the plugin for builds that don't need tracking:

```typescript
enabled: process.env.NODE_ENV !== 'production',
```

---

## Dashboard Not Found After `vite build`

If `dashboard.includeInBuild: true` but the dashboard is missing from `dist/`:

1. **Did you run `pnpm build:dashboard` before `vite build`?**

   ```bash
   pnpm build:dashboard   # always first
   pnpm build             # then your app build
   ```

2. **Check the terminal for warnings:**

   ```
   [vite-plugin-monitor] includeInBuild is true but dashboard dist not found at .../dashboard.
   Run 'pnpm build:dashboard' before 'vite build'.
   ```

The build does **not fail** when the dashboard is missing — it logs a warning and skips the copy.

---

## `EADDRINUSE` in Standalone Mode

```
Error: listen EADDRINUSE :::4242
```

Port `4242` is already in use. Change the port:

```typescript
storage: {
  mode: 'standalone',
  port: 4300,  // use a different port
}
```

---

## Console Output Not Captured

By default, console tracking is `true` (all 19 methods). If console events aren't appearing:

1. **Are console calls happening before the setup script runs?**

   The setup script is injected at `head-prepend`, but very early `console.*` calls (during module evaluation of your bundler's runtime) may precede it. This is generally rare.

2. **Are the calls matching `ignorePatterns`?**

   Default ignored patterns: `['[vite]', '[HMR]', '[tracker]']`. Vite's own console output is intentionally excluded.

3. **Is `console: false` set?**

   Check your `track.console` config.

4. **Is `track.level` filtering them out?**

   `console.debug()` calls are emitted at `'debug'` level. With `track.level: 'info'` (default), debug events are discarded.

---

## `track.userId` Function Not Working

```
[vite-plugin-monitor] userId function references undefined variable
```

The `track.userId` function is serialized via `.toString()` and injected as a string into `index.html`. It **cannot** reference module-level variables, imports, or closures.

```typescript
// ❌ This breaks — authStore is not available in the injected script
import { authStore } from './store'
userId: () => authStore.getState().userId

// ✅ Use browser globals only
userId: () => window.__auth?.userId ?? null
userId: () => localStorage.getItem('userId')
userId: () => sessionStorage.getItem('user_id')

// ✅ Or use autoInit: false + tracker.init() in app code
```

---

## TypeScript Errors on `TrackerEvent.payload`

The `payload` field is a discriminated union. Narrow it with the `type` field:

```typescript
// ❌ TypeScript error: Property 'tag' does not exist on type 'EventPayload'
const tag = event.payload.tag

// ✅ Narrow first
if (event.type === 'click') {
  const tag = event.payload.tag  // OK — ClickPayload
}
```

---

## High Memory Usage in Middleware/Standalone Mode

The ring buffer defaults to 500,000 events. Each event is roughly 1–2 KB in memory (depending on headers/bodies), so the maximum memory footprint is approximately **500 MB–1 GB**.

Reduce if needed:

```typescript
storage: {
  maxBufferSize: 10000,  // keep only 10k events in memory
}
```

The ring buffer automatically evicts the oldest events (FIFO) when capacity is exceeded.

---

## Getting Help

If none of the above resolves your issue:

1. Check the [GitHub Issues](https://github.com/nDriaDev/vite-plugin-monitor/issues) for existing reports
2. Open a new issue with your `vite.config.ts` snippet and the browser console output
3. Email: [admin@ndria.dev](mailto:admin@ndria.dev)

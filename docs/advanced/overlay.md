# Debug Overlay

The debug overlay is a Shadow DOM–isolated floating widget that gives you at-a-glance information about the current tracking session directly inside your application. It's designed for development and staging environments.

## Enabling the Overlay

```typescript
trackerPlugin({
  appId: 'my-app',
  overlay: {
    enabled:  true,
    position: 'bottom-right', // 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  },
})
```

The overlay is mounted automatically after `tracker.init()` completes. When `autoInit: false`, it appears after your manual `tracker.init()` call.

## Opening and Closing

Three ways to toggle the overlay panel open/closed:

1. **Click the FAB button** — the circular button anchored to the configured corner
2. **Keyboard shortcut** — `Alt+T` from anywhere on the page
3. **Drag to reposition** — grab the panel header to move it anywhere on the viewport

## Overlay Sections

### Identity

| Field | Description | Editable? |
|-------|-------------|-----------|
| **User ID** | Current user identifier | ✅ Yes — type to update via `tracker.setUser()` |
| **Session ID** | Current session identifier (`sess_` prefix) | 📋 Copy button |
| **App ID** | The `appId` configured in the plugin | ❌ Read-only |

Editing the User ID inline is equivalent to calling:
```typescript
tracker.setUser(newValue || null)
```

### Context

| Field | Source | Live-updated? |
|-------|--------|---------------|
| **Route** | `location.pathname + location.search` | ✅ On open |
| **Viewport** | `window.innerWidth × window.innerHeight` | ✅ On open |
| **Language** | `navigator.language` | ❌ Static |
| **Connection** | `navigator.connection?.effectiveType` | ❌ Static |

### Actions

| Button | Description |
|--------|-------------|
| **Open Dashboard** | Opens `window.location.origin + dashboard.route` in a new tab. Only shown when `dashboard.enabled: true`. |
| **Remove Tracker Info** | Calls `overlay.destroy()`. Removes the overlay widget from the DOM. It does **not** call `tracker.destroy()` — automatic tracking continues to run in the background. |

### Theme Toggle

Dark/light mode toggle in the panel header. The preference is stored in `localStorage` under a tracker-specific key and restored on the next page load.

## Shadow DOM Isolation

The overlay host element uses a Shadow DOM root, which means:

- **No CSS leakage** — your application's stylesheets cannot affect the overlay appearance
- **No namespace collisions** — class names, IDs, and CSS variables inside the overlay are completely isolated
- **No z-index wars** — the host element uses a very high `z-index` to stay on top

## Programmatic Control

The overlay can be destroyed from application code:

```typescript
import { tracker } from '@ndriadev/vite-plugin-monitor/client'

// Destroys the overlay AND the entire tracker (proxies, queue, timer)
tracker.destroy()
```

## Development-Only Pattern

A common pattern is to enable the overlay only in development mode:

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { trackerPlugin } from '@ndriadev/vite-plugin-monitor'

export default defineConfig(({ mode }) => ({
  plugins: [
    trackerPlugin({
      appId: 'my-app',
      track: {
        clicks:     true,
        http:       true,
        errors:     true,
        navigation: true,
      },
      dashboard: {
        enabled: mode === 'development',
        route:   '/_dashboard',
      },
      overlay: {
        enabled:  mode === 'development',
        position: 'bottom-right',
      },
    }),
  ],
}))
```

## Overlay Events

The overlay itself does **not** emit tracker events. Its UI interactions (opening, closing, dragging, editing the user ID) are intentionally excluded from tracking.

However, changing the User ID via the overlay does emit the standard `session:end` / `session:start` pair from `tracker.setUser()`.

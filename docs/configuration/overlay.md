# Overlay

The `overlay` option controls the floating debug widget that appears in your application during development. It provides at-a-glance information about the current tracking session and a quick link to the dashboard.

```typescript
trackerPlugin({
  appId: 'my-app',
  overlay: {
    enabled:  true,
    position: 'bottom-right',
  },
})
```

## Options

### `overlay.enabled`

**Type:** `boolean` · **Default:** `false`

Show the floating debug overlay. When `true`, the overlay is mounted after `tracker.init()` completes.

---

### `overlay.position`

**Type:** `'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'` · **Default:** `'bottom-right'`

Corner of the viewport where the FAB (Floating Action Button) is anchored.

```typescript
overlay: {
  enabled:  true,
  position: 'bottom-left',
}
```

---

## Overlay Features

The overlay is a Shadow DOM–isolated widget. It has no CSS leakage into or from your application.

### FAB Button

A small circular button anchored to the configured corner. Click to open/close the overlay panel. Also toggled with the **`Alt+T`** keyboard shortcut.

### Identity Section

| Field | Description |
|-------|-------------|
| **User ID** | Current user identifier. **Editable inline** — type a new value to call `tracker.setUser()` directly from the overlay. |
| **Session ID** | Current session identifier (copy button). |
| **App ID** | The `appId` configured in the plugin. |

### Context Section

| Field | Description |
|-------|-------------|
| **Route** | Current `pathname + search`. Updated live when the panel is open. |
| **Viewport** | Current `window.innerWidth × window.innerHeight`. |
| **Language** | `navigator.language` (e.g. `en-US`, `it-IT`). |
| **Connection** | Network connection type from `navigator.connection.effectiveType` (e.g. `4g`, `3g`, `wifi`). |

### Actions

| Action | Description |
|--------|-------------|
| **Open Dashboard** | Opens `window.location.origin + dashboard.route` in a new browser tab. Only shown when `dashboard.enabled: true`. |
| **Remove Tracker Info** | Calls `tracker.destroy()`, removes the overlay host element, and detaches all event listeners. |

### Theme Toggle

Dark/light theme toggle button in the overlay panel header. The selected theme is persisted in `localStorage` and restored on next page load.

### Drag and Drop

Grab the overlay panel by its header bar to drag and reposition it anywhere on the viewport. The position is **not** persisted — it resets to the configured `position` on next page load.

---

## Technical Details

The overlay is:
- **Shadow DOM–isolated** — no CSS collision with your application styles
- **Mounted lazily** — only after `tracker.init()` completes
- **Zero impact when disabled** — when `overlay.enabled: false`, the overlay class is never instantiated

The overlay can be programmatically destroyed from application code:

```typescript
import { tracker } from '@ndriadev/vite-plugin-monitor/client'

// Destroys tracker + overlay + all event proxies
tracker.destroy()
```

---

## Example: Overlay in Dev Only

A common pattern is to enable the overlay only during development:

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { trackerPlugin } from '@ndriadev/vite-plugin-monitor'

export default defineConfig(({ mode }) => ({
  plugins: [
    trackerPlugin({
      appId: 'my-app',
      track: { clicks: true, http: true, errors: true, navigation: true },
      dashboard: { enabled: mode === 'development' },
      overlay: {
        enabled:  mode === 'development',
        position: 'bottom-right',
      },
    }),
  ],
}))
```

See [Debug Overlay](/advanced/overlay) for a deeper dive into overlay capabilities.

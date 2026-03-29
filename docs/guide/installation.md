# Installation

## Prerequisites

- **Vite**: `>=4.0.0`

## Package Installation

::: code-group

```bash [pnpm]
pnpm add -D @ndriadev/vite-plugin-monitor
```

```bash [npm]
npm install -D @ndriadev/vite-plugin-monitor
```

```bash [yarn]
yarn add -D @ndriadev/vite-plugin-monitor
```

:::

## Plugin Registration

Add the plugin to your `vite.config.ts`. Only `appId` is required:

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

That's it. With this minimal configuration:

- **Middleware mode** is auto-selected in dev — events are stored in Vite's dev server memory.
- **Console tracking** is enabled by default (all 19 methods).
- Click, HTTP, error, and navigation tracking are **opt-in** (`false` by default).
- The dashboard and overlay are **disabled** by default.
- Events are written to `./logs/my-app.log` in JSONL format.

## Exports

The package exposes two entry points:

| Entry | Purpose |
|-------|---------|
| `@ndriadev/vite-plugin-monitor` | Plugin factory (`trackerPlugin`) and all TypeScript types |
| `@ndriadev/vite-plugin-monitor/client` | `tracker` object for manual init and custom events |

```typescript
// Plugin entry (use in vite.config.ts)
import { trackerPlugin } from '@ndriadev/vite-plugin-monitor'

// Client entry (use in your application code)
import { tracker } from '@ndriadev/vite-plugin-monitor/client'
```

::: info
The client entry is only needed when using `autoInit: false` or when calling `tracker.track()`, `tracker.setUser()`, etc. manually. For basic auto-tracked interactions you don't need to import anything in your application code.
:::

## TypeScript

Full TypeScript types are included. No `@types` package is required.

```typescript
import type {
  TrackerPluginOptions,
  TrackerEvent,
  TrackOptions,
  StorageOptions,
  LoggingOptions,
  DashboardOptions,
  OverlayOptions,
} from '@ndriadev/vite-plugin-monitor'
```

## Framework Compatibility

`vite-plugin-monitor` is framework-agnostic. It works with any Vite-based project:

- React (including Next.js via Vite)
- Vue 3 / Nuxt 3
- Svelte / SvelteKit
- Solid.js
- Vanilla TypeScript / JavaScript
- Any other Vite-based framework

The plugin operates at the HTML level (`transformIndexHtml`) and injects scripts before any framework code runs.

## Next Steps

- [Quick Start](/guide/quick-start) — Enable all trackers and open the dashboard
- [Storage Modes](/guide/storage-modes) — Understand the four deployment modes
- [Configuration Reference](/configuration/plugin-options) — All available options

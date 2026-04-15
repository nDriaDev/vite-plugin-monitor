---
layout: home

hero:
  name: "vite-plugin-monitor"
  text: "Automatic User Interaction Tracking"
  tagline: Real-Time Dashboard & File Logging for Vite — zero application code changes required.
  image:
    src: /logo.png
    alt: vite-plugin-monitor
  actions:
    - theme: brand
      text: Get Started
      link: /guide/introduction
    - theme: alt
      text: Quick Start
      link: /guide/quick-start
    - theme: alt
      text: View on GitHub
      link: https://github.com/nDriaDev/vite-plugin-monitor

features:
  - icon: 🔍
    title: Automatic Trackers
    details: Capture clicks, HTTP requests, unhandled errors, navigation events, and console output — all with a single plugin entry in vite.config.ts.

  - icon: 📊
    title: Built-in Dashboard
    details: A framework-free Vanilla TypeScript SPA with KPI cards, charts, top lists, event table, and time-range filtering. Isolated in Shadow DOM, no dependencies.

  - icon: 🗄️
    title: Flexible Storage
    details: Four storage modes cover every scenario — middleware (dev), standalone (separate port), HTTP (production REST), and WebSocket (single persistent connection).

  - icon: 🔬
    title: Debug Overlay
    details: A floating, drag-and-drop widget showing user ID, session ID, route, viewport, and a direct link to the dashboard. Toggled with Alt+T.

  - icon: 🛡️
    title: Security by Default
    details: Sensitive headers (Authorization, Cookie, Set-Cookie) and body keys (password, token, card, cvv) are always redacted before logging — configurable but cannot be disabled.

  - icon: ⚡
    title: Zero Overhead
    details: All file I/O uses Node's non-blocking fs.WriteStream on the main thread. Client-side batching, beacon-based flush on unload, and configurable level filtering minimize impact.
---

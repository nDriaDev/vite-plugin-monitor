# Logging

The `logging` option controls server-side log file output. All file I/O is handled directly on the main thread using Node's non-blocking `fs.WriteStream` API — no worker threads are involved.

```typescript
trackerPlugin({
  appId: 'my-app',
  logging: {
    level: 'info',
    transports: [
      {
        format:   'json',
        path:     './logs/my-app.log',
        rotation: {
          strategy: 'daily',
          maxFiles: 30,
          compress: false,
        },
      },
    ],
  },
})
```

## Default Configuration

When `logging` is not specified (or `transports` is empty), a single default transport is created:

```typescript
{
  format:   'json',
  path:     './logs/<appId>.log',
  rotation: {
    strategy: 'daily',
    maxFiles: 30,
    compress: false,
  },
}
```

---

## `logging.level`

**Type:** `'debug' | 'info' | 'warn' | 'error'` · **Default:** `'info'`

Minimum severity written to any file transport (server-side filtering). Events below this threshold are **not written to any log file**.

Level order: `debug < info < warn < error`

::: info Independent from `track.level`
`logging.level` and `track.level` are independent:

- `track.level` filters events **on the client** before they are queued and sent
- `logging.level` filters events **on the server** before they are written to disk

An event passing `track.level` but not `logging.level` is received and stored in the ring buffer but not persisted to disk.
:::

---

## `logging.transports`

**Type:** `LogTransport[]` · **Default:** `[{ format: 'json', path: './logs/<appId>.log', rotation: { strategy: 'daily', maxFiles: 30 } }]`

Array of file output targets. Multiple transports write **simultaneously** — the same event stream can be written to several files at once.

Common use case: one JSONL file for machine processing and one pretty-printed file for human debugging:

```typescript
transports: [
  {
    format: 'json',
    path:   './logs/monitor.jsonl',
    rotation: { strategy: 'daily', maxFiles: 7 },
  },
  {
    format: 'pretty',
    path:   './logs/monitor-human.log',
    rotation: { strategy: 'size', maxSize: '20mb', maxFiles: 3 },
  },
],
```

### Transport Fields

#### `format`

**Type:** `'json' | 'pretty'`

Output format for this transport.

**`'json'`** — JSONL (JSON Lines): one `TrackerEvent` JSON-stringified per line. Machine-readable and replay-friendly.

```
{"id":"...","timestamp":"2024-03-15T10:23:45.123Z","level":"info","type":"click","appId":"my-app","sessionId":"sess_abc","userId":"user_123","payload":{"tag":"button","text":"Add to cart",...},"meta":{...}}
```

**`'pretty'`** — Human-readable aligned columns. Easier to scan in a terminal.

```
[2024-03-15T10:23:45.123Z] INFO  | click        | user:user_123       | sess:sess_abc | {"tag":"button","text":"Add to cart"}
[2024-03-15T10:23:46.500Z] INFO  | http         | user:user_123       | sess:sess_abc | {"method":"POST","url":"https://api...","status":200,"duration":142}
[2024-03-15T10:23:47.200Z] ERROR | error        | user:user_123       | sess:sess_abc | {"message":"Cannot read...","errorType":"TypeError"}
```

---

#### `path`

**Type:** `string`

Log file path — absolute or relative to CWD. For daily rotation, a date suffix is automatically inserted before the extension:

```
./logs/monitor.log  →  ./logs/monitor-2024-03-15.log
```

The log directory is **created recursively** on `buildStart` (i.e. when you run `vite dev` or `vite build`). The Node.js process must have write permission to the directory.

---

#### `rotation`

**Type:** `RotationOptions` · **Optional**

Controls how and when old log files are archived and cleaned up.

##### `rotation.strategy`

**Type:** `'daily' | 'size'`

| Strategy | Behavior |
|----------|----------|
| `'daily'` | The first write **after UTC midnight** triggers rotation. The current file is renamed with a `-YYYY_MM_DD` suffix and a fresh file is opened. |
| `'size'` | The first write that would **exceed `maxSize`** triggers rotation. The current file is renamed with a `-YYYY_MM_DD_HH_MM_SS` timestamp suffix. |

##### `rotation.maxSize`

**Type:** `string` · **Default:** `'10mb'` · **Used by:** `'size'` strategy only

Maximum size of the active log file before rotation. Accepts unit suffixes: `b`, `kb`, `mb`, `gb`.

```typescript
maxSize: '50mb'
maxSize: '1gb'
maxSize: '500kb'
```

##### `rotation.maxFiles`

**Type:** `number` · **Default:** `30`

Maximum number of **rotated archive files** to retain on disk. When this limit is exceeded, the oldest archive is deleted.

::: info Active file not counted
`maxFiles` counts only archived (rotated) files. The currently active log file is never included in this count.
:::

##### `rotation.compress`

**Type:** `boolean` · **Default:** `false`

Reserved for future gzip compression of rotated archives. Currently has no effect.

---

## Log Replay on Restart

When the Vite dev server restarts, **existing log files are replayed into the in-memory ring buffer**. This means the dashboard retains event history even after a server restart.

Log replay reads all `.log` / `.jsonl` files matching the configured transport paths (including rotation archives) and inserts their events into the ring buffer in chronological order. Only JSONL-format logs are parsed for replay; pretty-format logs are skipped.

---

## I/O Architecture

All file I/O runs directly on the main thread using Node's non-blocking stream APIs. No worker threads are involved.

```
Main thread (Vite)
──────────────────────────────────────────────────────────────────────
Logger.writeEvent(event)
  └─ Level check
  └─ StreamTransport.write(event)
       ├─ Rotation check (daily / size)
       ├─ Format (JSON or pretty)
       ├─ fs.WriteStream.write()    ← async, non-blocking
       └─ Backpressure buffer if stream is draining

Logger.startHydration(onBatch, onDone)
  └─ hydrateFromLogs() — async readline over createReadStream
       ├─ Read all JSONL transport files in chronological order
       ├─ Parse each line as TrackerEvent
       ├─ Skip malformed / invalid lines
       ├─ onBatch(events)           ← batched every batchSize lines
       └─ onDone({ loaded, skippedMalformed, skippedInvalid, limitReached })

Logger.destroy()
  └─ StreamTransport.destroy()
       ├─ Flush any buffered (pending) lines
       └─ fs.WriteStream.end()      ← close and flush kernel buffer
```

`fs.WriteStream.write()` hands data off to the OS kernel immediately without blocking the Vite event loop. Rotation and cleanup (`renameSync`, `readdirSync`, `unlinkSync`) run synchronously but only at rotation boundaries — not on every event — so their impact is imperceptible in practice.

Hydration reads only `format: 'json'` (JSONL) transports — `format: 'pretty'` logs are skipped. Each transport is capped at `maxBytesPerTransport` (default 50 MB) to prevent unbounded memory use on large log directories; if the cap is hit, the oldest files are skipped and `limitReached: true` is reported via `onDone`.

---

## Examples

### Single JSONL Transport with 7-Day Retention

```typescript
logging: {
  transports: [
    {
      format: 'json',
      path:   './logs/tracker.jsonl',
      rotation: { strategy: 'daily', maxFiles: 7 },
    },
  ],
}
```

### Dual Transport (Machine + Human)

```typescript
logging: {
  level: 'info',
  transports: [
    {
      format: 'json',
      path:   './logs/tracker.jsonl',
      rotation: { strategy: 'daily', maxFiles: 30 },
    },
    {
      format: 'pretty',
      path:   './logs/tracker-human.log',
      rotation: { strategy: 'size', maxSize: '20mb', maxFiles: 3 },
    },
  ],
}
```

### Errors Only

```typescript
logging: {
  level: 'error', // only write error-level events
  transports: [
    {
      format: 'json',
      path:   './logs/errors.jsonl',
    },
  ],
}
```

### Absolute Path

```typescript
logging: {
  transports: [
    {
      format: 'json',
      path:   '/var/log/my-app/tracker.log',
    },
  ],
}
```

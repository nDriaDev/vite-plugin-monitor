# Log Files

vite-plugin-monitor writes events to disk using a dedicated `worker_threads` worker — all file I/O is off the main Vite thread. Log files serve two purposes: persistent storage for events across server restarts, and a machine-readable audit trail.

## Default Log Location

Without any `logging` configuration, events are written to:

```
./logs/<appId>.log
```

For example, `trackerPlugin({ appId: 'my-app' })` writes to `./logs/my-app.log`.

The log directory is created recursively on `buildStart` (i.e. when you run `vite dev` or `vite build`).

## Log Formats

### JSONL (JSON Lines)

```json
{"timestamp":"2024-03-15T10:23:45.123Z","level":"info","type":"navigation","appId":"my-app","sessionId":"sess_abc","userId":"user_123","payload":{"from":"/home","to":"/products","trigger":"pushState","duration":4230},"meta":{"userAgent":"Mozilla/5.0...","route":"/products","viewport":"1440x900","language":"en-US"}}
{"timestamp":"2024-03-15T10:23:46.500Z","level":"info","type":"http","appId":"my-app","sessionId":"sess_abc","userId":"user_123","payload":{"method":"GET","url":"https://api.myapp.com/products","status":200,"duration":142},"meta":{...}}
{"timestamp":"2024-03-15T10:23:47.200Z","level":"error","type":"error","appId":"my-app","sessionId":"sess_abc","userId":"user_123","payload":{"message":"Cannot read properties of undefined","stack":"TypeError: ...","errorType":"TypeError"},"meta":{...}}
```

One `TrackerEvent` per line. Machine-readable, grep-friendly, and easy to import into log analysis tools (Splunk, Datadog, ELK, etc.).

### Pretty Format

```
[2024-03-15T10:23:45.123Z] INFO  | navigation   | user:user_123        | sess:sess_ab | {"from":"/home","to":"/products","trigger":"pushState","duration":4230}
[2024-03-15T10:23:46.500Z] INFO  | http         | user:user_123        | sess:sess_ab | {"method":"GET","url":"https://api...","status":200,"duration":142}
[2024-03-15T10:23:47.200Z] ERROR | error        | user:user_123        | sess:sess_ab | {"message":"Cannot read...","errorType":"TypeError"}
```

Human-readable aligned columns: `[timestamp] LEVEL | type | user:<userId> | sess:<sessionId prefix> | <payload JSON>`

## Log Rotation

### Daily Rotation

Triggered on the first write after UTC midnight. The active file is renamed with a `-YYYY_MM_DD` date suffix:

```
./logs/monitor.log               ← active file (today)
./logs/monitor-2024_03_14.log    ← yesterday
./logs/monitor-2024_03_13.log    ← day before
./logs/monitor-2024_03_12.log    ← ...
```

```typescript
rotation: {
  strategy: 'daily',
  maxFiles: 30,  // keep 30 days of archives
}
```

### Size-Based Rotation

Triggered on the first write that would exceed `maxSize`. The active file is renamed with a `-YYYY_MM_DD_HH_mm_ss` date suffix:

```
./logs/monitor.log
./logs/monitor-2024_03_15_10_23_45.log
./logs/monitor-2024_03_15_08_00_12.log
```

```typescript
rotation: {
  strategy: 'size',
  maxSize:  '50mb',
  maxFiles: 5,  // keep 5 most recent archives
}
```

## Log Replay on Server Restart

When middleware or standalone mode starts up, the plugin **replays existing JSONL log files** into the in-memory ring buffer. This means:

- The dashboard shows historical events even after a `vite dev` restart
- No events are "lost" from the ring buffer perspective across restarts
- Only `format: 'json'` (JSONL) transports are replayed; `format: 'pretty'` logs are skipped

Replay reads all files matching the transport path patterns (including rotated archives) in chronological order.

## Querying Log Files

Since JSONL logs are one event per line, standard Unix tools work well:

```bash
# Count all error events today
grep '"level":"error"' ./logs/my-app.log | wc -l

# Find all events from a specific user
grep '"userId":"user_123"' ./logs/my-app.log | jq .

# Find all failed HTTP requests
cat ./logs/my-app.log | jq 'select(.type == "http" and .payload.status >= 400)'

# Count navigation events by route
cat ./logs/my-app.log \
  | jq 'select(.type == "navigation") | .payload.to' \
  | sort | uniq -c | sort -rn

# Find all unhandled errors in the last 24 hours
cat ./logs/my-app.log \
  | jq --arg since "$(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ)" \
    'select(.type == "error" and .timestamp > $since)'
```

## Multiple Transports

Write the same event stream to multiple files simultaneously:

```typescript
logging: {
  transports: [
    // Machine-readable JSONL for log shippers
    {
      format: 'json',
      path:   './logs/tracker.jsonl',
      rotation: { strategy: 'daily', maxFiles: 90 },
    },
    // Human-readable for debugging in the terminal
    {
      format: 'pretty',
      path:   './logs/tracker-debug.log',
      rotation: { strategy: 'size', maxSize: '10mb', maxFiles: 3 },
    },
    // Errors only — for alerting pipelines
    {
      format: 'json',
      path:   './logs/tracker-errors.jsonl',
      rotation: { strategy: 'daily', maxFiles: 30 },
    },
  ],
}
```

::: info Server-side level filtering is per-logger, not per-transport
The `logging.level` threshold applies to **all** transports equally. You cannot set different minimum levels per transport. To capture only errors in one file, configure a separate plugin instance or filter at the consumer side.
:::

## Worker Architecture

```
Vite main thread                    logger-worker.ts (worker_threads)
────────────────────────────────    ──────────────────────────────────────
event arrives from browser
logger.writeEvent(event)
  └── level check (LEVELS[event.level] < minLevel → discard)
  └── spawnWorker() (lazy, once)
  └── postMessage({ type: 'write', event })  →  receive message
                                                  format to string (json/pretty)
                                                  rotation check
                                                  stream.write(line)
                                                  cleanup old archives if needed

logger.startHydration(onBatch, onDone)
  └── spawnWorker() (lazy, once)
  └── postMessage({ type: 'hydrate' })       →  read all JSONL transport files
                                                  parse each line as TrackerEvent
                                                  skip malformed / invalid lines
                                                  postMessage({ type: 'hydrate:batch',
                                                    events })  ──────────────────────→  onBatch(events)
                                                                                         buffer.push(events)
                                                  (repeat per batch until EOF)
                                                  postMessage({ type: 'hydrate:done',
                                                    loaded, skippedMalformed,        →  onDone(stats)
                                                    skippedInvalid, limitReached })

logger.destroy()
  └── postMessage({ type: 'destroy' })  →  flush all streams
                                            close all WriteStreams
                                            process.exit(0)
  └── await worker exit (3s timeout)
```

The worker is spawned **lazily** on the first event write or hydration request. Events arriving before the worker signals `'ready'` are buffered in the main thread and drained once the worker is initialized.

Hydration reads only `format: 'json'` (JSONL) transports — `format: 'pretty'` logs are skipped. Each transport is capped at `maxBytesPerTransport` (default 50 MB) to prevent unbounded memory use on large log directories; if the cap is hit, the oldest files are skipped and `limitReached: true` is reported in `onDone`.

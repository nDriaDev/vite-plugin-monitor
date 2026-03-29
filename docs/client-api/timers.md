# tracker.time() / tracker.timeEnd()

Measure the duration of a named asynchronous or synchronous operation. `timeEnd()` emits a custom event with a `durationMs` field automatically populated.

```typescript
tracker.time(label: string): void

tracker.timeEnd(
  label: string,
  data?: Record<string, unknown>,
  opts?: TrackEventOptions
): void
```

## `tracker.time()`

Starts a named timer. Records the current timestamp internally.

```typescript
tracker.time('api:load-users')
```

Multiple concurrent timers with different labels are supported:

```typescript
tracker.time('render:header')
tracker.time('render:sidebar')
tracker.time('api:get-config')
// All three timers run concurrently
```

## `tracker.timeEnd()`

Stops the timer matching `label` and emits a custom event with `durationMs` merged into `data`.

```typescript
tracker.time('api:load-users')
const users = await fetchUsers()
tracker.timeEnd('api:load-users', { count: users.length })
// Emits: { name: 'api:load-users', durationMs: 142, count: 15 }
```

If no matching `tracker.time()` call was made, `timeEnd()` is a no-op and logs a warning.

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `label` | `string` | Must match the label passed to `time()` |
| `data` | `Record<string, unknown>` | Additional data merged into the event |
| `opts` | `TrackEventOptions` | Level, groupId, context overrides |

## Emitted Event Shape

```json
{
  "type":    "custom",
  "level":   "info",
  "payload": {
    "name": "api:load-users",
    "data": {
      "durationMs": 142,
      "count": 15
    }
  }
}
```

The `durationMs` field is always included in `data` — even if you don't pass any other data fields.

## Examples

### Basic API Timing

```typescript
import { tracker } from '@ndriadev/vite-plugin-monitor/client'

async function loadDashboard() {
  tracker.time('dashboard:load')

  try {
    const data = await fetchDashboardData()
    tracker.timeEnd('dashboard:load', { sections: data.sections.length })
    return data
  } catch (err) {
    tracker.track('dashboard:load-failed', { error: err.message }, { level: 'error' })
    // timer is abandoned if timeEnd is never called (no leak, just no event)
    throw err
  }
}
```

### Page Render Timing

```typescript
// In a React component
useEffect(() => {
  tracker.time('page:render')
  return () => {
    tracker.timeEnd('page:render', { route: location.pathname })
  }
}, [location.pathname])
```

### Database / Cache Operation Timing

```typescript
async function getCachedUser(id: string) {
  tracker.time('cache:get-user')

  let source: 'cache' | 'db'
  let user = cache.get(id)

  if (!user) {
    user = await db.users.findById(id)
    cache.set(id, user)
    source = 'db'
  } else {
    source = 'cache'
  }

  tracker.timeEnd('cache:get-user', { source, userId: id })
  return user
}
```

### Correlated with Groups

```typescript
async function importData(file: File) {
  const groupId = tracker.group('data-import')

  tracker.track('import:started', { fileName: file.name, size: file.size }, { groupId })
  tracker.time('import:parse')

  const records = await parseFile(file)
  tracker.timeEnd('import:parse', { recordCount: records.length }, { groupId })

  tracker.time('import:save')
  await saveRecords(records)
  tracker.timeEnd('import:save', { recordCount: records.length }, { groupId })

  tracker.track('import:completed', { fileName: file.name }, { groupId })
}
```

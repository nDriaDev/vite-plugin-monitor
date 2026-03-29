# tracker.group()

Generate a unique group ID for correlating a sequence of related events into a logical operation.

```typescript
tracker.group(name: string): string
```

## Parameters

### `name`

**Type:** `string`

A human-readable label for the group. Used internally for debugging — not stored on events.

## Returns

A unique group ID string. Pass this to subsequent `tracker.track()` and `tracker.timeEnd()` calls via `opts.groupId`.

## How Groups Work

All events sharing a `groupId` can be filtered and displayed together in the dashboard's Events table. This makes it easy to trace a multi-step flow (e.g. a checkout, an upload, a wizard) as a single logical unit.

```typescript
const groupId = tracker.group('checkout')

tracker.track('checkout:step-1', { step: 'address' },  { groupId })
tracker.track('checkout:step-2', { step: 'payment' },  { groupId })
tracker.track('checkout:step-3', { step: 'review' },   { groupId })
tracker.track('checkout:completed', { orderId: '...' }, { groupId })
```

## Examples

### Multi-Step Form

```typescript
import { tracker } from '@ndriadev/vite-plugin-monitor/client'

function useMultiStepForm(formId: string) {
  const groupId = tracker.group(`form:${formId}`)

  return {
    onStepComplete(step: number, data: Record<string, unknown>) {
      tracker.track('form:step-completed', { formId, step, ...data }, { groupId })
    },
    onSubmit(result: 'success' | 'error', error?: string) {
      tracker.track('form:submitted', { formId, result, error }, {
        groupId,
        level: result === 'error' ? 'error' : 'info',
      })
    },
  }
}
```

### File Upload Flow

```typescript
async function uploadFile(file: File) {
  const groupId = tracker.group('file-upload')

  tracker.track('upload:started', {
    name: file.name,
    size: file.size,
    type: file.type,
  }, { groupId })

  tracker.time('upload:transfer')

  try {
    const result = await uploadToS3(file)
    tracker.timeEnd('upload:transfer', { bytes: file.size }, { groupId })

    tracker.track('upload:completed', {
      url: result.url,
    }, { groupId })

    return result
  } catch (err) {
    tracker.track('upload:failed', {
      error: err.message,
    }, { groupId, level: 'error' })
    throw err
  }
}
```

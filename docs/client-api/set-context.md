# tracker.setContext()

Attach arbitrary key-value metadata to **every subsequent event**. Context persists until explicitly cleared — it does not reset between events or page navigations.

```typescript
tracker.setContext(attrs: Record<string, unknown>): void
```

## Parameters

### `attrs`

**Type:** `Record<string, unknown>`

Key-value pairs to merge into the persistent context. These are attached to `TrackerEvent.context` on every event emitted after this call.

- Setting a key to `null` **removes** it from the persistent context.
- Keys are merged — calling `setContext()` multiple times accumulates context, it does not replace it.

## Behavior

```typescript
tracker.setContext({ appVersion: '2.1.0', region: 'eu-west' })
// All subsequent events: { context: { appVersion: '2.1.0', region: 'eu-west' } }

tracker.setContext({ tenant: 'acme' })
// All subsequent events: { context: { appVersion: '2.1.0', region: 'eu-west', tenant: 'acme' } }

tracker.setContext({ tenant: null })
// All subsequent events: { context: { appVersion: '2.1.0', region: 'eu-west' } }
```

## Examples

### App Version and Environment

```typescript
import { tracker } from '@ndriadev/vite-plugin-monitor/client'

// Set at app startup, before init
tracker.setContext({
  appVersion: import.meta.env.VITE_APP_VERSION,
  environment: import.meta.env.MODE,
  region: import.meta.env.VITE_REGION,
})
```

### A/B Testing

```typescript
const variant = getABVariant('checkout-v2')

tracker.setContext({
  abVariant:    variant,
  experimentId: 'checkout-v2',
})
```

### Feature Flags

```typescript
const flags = await featureFlagService.getAll()

tracker.setContext({
  featureFlags: Object.keys(flags).filter(k => flags[k]),
})
```

### Tenant / Org Context (Multi-Tenant Apps)

```typescript
authService.onLogin((user) => {
  tracker.setUser(user.id)
  tracker.setContext({
    orgId:   user.orgId,
    orgName: user.orgName,
    plan:    user.plan,
  })
})

authService.onLogout(() => {
  tracker.setUser(null)
  tracker.setContext({ orgId: null, orgName: null, plan: null })
})
```

### Per-Event Context Override

To set context for a **single event only** (without affecting the persistent context), use `opts.context` in `tracker.track()`:

```typescript
tracker.track('experiment:viewed', {}, {
  context: { experimentId: 'onboarding-v3', variant: 'B' }
})
```

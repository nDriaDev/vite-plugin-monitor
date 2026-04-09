# tracker.setUser()

Update the user identity after initialization. Emits a `session:end` event for the previous identity and a `session:start` event for the new one, enabling the dashboard to reconstruct user sessions correctly.

```typescript
tracker.setUser(
  userId: string | null,
  opts?: SetUserOptions
): void
```

## Parameters

### `userId`

**Type:** `string | null`

The new user identifier.
- Pass a `string` to identify the user (e.g. after login).
- Pass `null` to reset to an anonymous session-scoped ID (e.g. after logout).

### `opts` (optional)

```typescript
interface SetUserOptions {
  attributes?: Record<string, unknown>
}
```

#### `opts.attributes`

Arbitrary attributes to attach to the new user identity. Stored in `EventMeta.userAttributes` and stamped on every subsequent event until `tracker.setUser(null)` is called.

## Examples

```typescript
import { tracker } from '@ndriadev/vite-plugin-monitor/client'

// After login
authService.onLogin(async (user) => {
  tracker.setUser(user.id, {
    attributes: {
      plan:  user.plan,    // 'free' | 'pro' | 'enterprise'
      role:  user.role,    // 'admin' | 'user'
      orgId: user.orgId,
    },
  })
})

// After logout — resets to anonymous ID
authService.onLogout(() => {
  tracker.setUser(null)
})
```

## Session Events Emitted

When `setUser()` is called:

1. `session:end` with `trigger: 'userId-change'` and `previousUserId` (the identity being closed)
2. `session:start` with `trigger: 'userId-change'` and the new `userId`

This creates a clean boundary in the event log between the two user identities.

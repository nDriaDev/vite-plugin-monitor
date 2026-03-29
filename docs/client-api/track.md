# tracker.track()

Emit a custom event. Use this for business events that the automatic trackers cannot infer: form submissions, checkout steps, feature usage, search queries, conversion milestones, etc.

```typescript
tracker.track(
  name: string,
  data?: Record<string, unknown>,
  opts?: TrackEventOptions
): void
```

## Parameters

### `name` <Badge type="danger" text="required" />

**Type:** `string`

Event name. A colon-namespaced convention (`'domain:action'`) is recommended for readability and filtering:

```typescript
tracker.track('checkout:started')
tracker.track('checkout:completed')
tracker.track('search:query')
tracker.track('feature:toggled')
tracker.track('form:submitted')
tracker.track('video:played')
```

### `data` (optional)

**Type:** `Record<string, unknown>`

Arbitrary structured data attached to the event. Serialized as-is into the `payload.data` field.

```typescript
tracker.track('checkout:completed', {
  orderId:   'ORD-123',
  total:     49.99,
  currency:  'EUR',
  itemCount: 3,
})
```

::: warning Avoid PII and secrets
Data is stored in log files and sent to the backend unencrypted. Do not include passwords, tokens, credit card numbers, national IDs, or other sensitive information. The automatic HTTP body redaction does **not** apply to `tracker.track()` data.
:::

### `opts` (optional)

**Type:** `TrackEventOptions`

```typescript
interface TrackEventOptions {
  level?:   LogLevel               // 'debug' | 'info' | 'warn' | 'error'. Default: 'info'
  groupId?: string                 // from tracker.group()
  context?: Record<string, unknown> // per-event context override
}
```

#### `opts.level`

Override the event severity. Defaults to `'info'`.

```typescript
tracker.track('payment:failed', { code: 'CARD_DECLINED' }, { level: 'error' })
tracker.track('api:slow',       { duration: 4500 },         { level: 'warn' })
```

#### `opts.groupId`

Associate this event with a group of related events. Obtain a group ID from `tracker.group()`.

```typescript
const groupId = tracker.group('checkout')
tracker.track('checkout:started',   { items: cart.items }, { groupId })
tracker.track('checkout:completed', { orderId: 'ORD-1' }, { groupId })
```

#### `opts.context`

Per-event context override. Merged **on top of** the persistent context set via `tracker.setContext()`, but only for this single event.

```typescript
tracker.track('experiment:variant', {}, {
  context: { abVariant: 'B', experimentId: 'checkout-v2' }
})
```

## Emitted Event Shape

Custom events have `type: 'custom'` and a [`CustomPayload`](/reference/event-types#custom):

```json
{
  "type":      "custom",
  "level":     "info",
  "timestamp": "2024-03-15T10:23:45.123Z",
  "appId":     "my-app",
  "sessionId": "sess_abc123",
  "userId":    "user_456",
  "payload": {
    "name":    "checkout:completed",
    "data":    { "orderId": "ORD-123", "total": 49.99 }
  }
}
```

## Examples

### E-commerce Events

```typescript
import { tracker } from '@ndriadev/vite-plugin-monitor/client'

// Add to cart
function onAddToCart(product: Product) {
  tracker.track('cart:add', {
    productId:   product.id,
    productName: product.name,
    price:       product.price,
    currency:    'EUR',
    quantity:    1,
  })
}

// Checkout flow with group correlation
async function checkout(cart: Cart) {
  const groupId = tracker.group('checkout')

  tracker.track('checkout:started', {
    itemCount: cart.items.length,
    subtotal:  cart.subtotal,
  }, { groupId })

  try {
    const order = await submitOrder(cart)
    tracker.track('checkout:completed', {
      orderId: order.id,
      total:   order.total,
    }, { groupId })
  } catch (err) {
    tracker.track('checkout:failed', {
      reason: err.message,
      code:   err.code,
    }, { groupId, level: 'error' })
    throw err
  }
}
```

### Feature Tracking

```typescript
// Feature flag evaluation
function useFeature(flagId: string) {
  const isEnabled = featureFlags.get(flagId)

  tracker.track('feature:evaluated', {
    flagId,
    enabled: isEnabled,
  })

  return isEnabled
}

// UI interaction not captured by click tracker
function onModalOpen(modalId: string) {
  tracker.track('modal:opened', { modalId })
}
```

### Search and Discovery

```typescript
async function onSearch(query: string) {
  const startTime = performance.now()
  const results = await searchApi(query)
  const duration = performance.now() - startTime

  tracker.track('search:completed', {
    query:       query,
    resultCount: results.length,
    duration:    Math.round(duration),
    hasResults:  results.length > 0,
  })
}
```

### Error Boundaries (React)

```typescript
class ErrorBoundary extends React.Component {
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    tracker.track('react:error-boundary', {
      message:   error.message,
      component: info.componentStack,
    }, { level: 'error' })
  }
}
```

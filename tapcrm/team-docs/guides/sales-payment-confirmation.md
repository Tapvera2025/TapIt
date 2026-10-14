# Advance-payment confirmation — operations runbook

Scope: pilot tenants that confirm advance payments manually (no gateway
integration yet). Covers the `deals:confirm-payment` grant layout, the
confirm/revert flow, and how it interacts with Win readiness.

## What the action controls

`deals:confirm-payment` guards the one endpoint that flips a deal's
`payment_status` to `advance_confirmed`:

- `POST /api/deals/:id/confirm-payment` — body `{ amountMinor, reference, note? }`
- Same endpoint with `{ revert: true, reason }` reverses an earlier
  confirmation (open deals only; a Won deal must go through cancel-after-win).

The server also enforces, inside the transaction:

- **Lifecycle guard** — only `open` or `won` deals can be confirmed; only
  `open` deals can be reverted.
- **Downgrade guard** — a deal already `paid` / `partially_refunded` /
  `refunded` cannot be flipped back to `advance_confirmed`.
- **Amount guard** — when the deal has an active commercials version
  with `advance_minor > 0`, the supplied `amountMinor` must be at least
  that value. The error (`DEAL_PAYMENT_AMOUNT_INSUFFICIENT`) carries
  both expected and supplied amounts for the UI.
- **Idempotency** — re-confirming an already-confirmed deal is logged
  as `deal.payment_confirmation_repeated` without state change.

## Who should hold the grant

The code gates purely by `deals:confirm-payment`. **Who holds it is a
tenant-config decision.** Two realistic shapes:

### Finance-only (recommended for pilot tenants with a Finance team)

Grant on the Finance position(s); do not grant on Sales HOD. Sales
raises a request / Finance confirms. Audit trail attributes the
confirmation to the Finance user.

```sql
-- One position_policy row per Finance position per tenant.
INSERT INTO position_policy (organization_id, position_id, action, allowed, scope, source)
VALUES ($tenant, $financeHodPositionId, 'deals:confirm-payment', true, 'department', 'position')
ON CONFLICT (organization_id, position_id, action) DO UPDATE
   SET allowed = EXCLUDED.allowed, scope = EXCLUDED.scope;
```

Scope `department` lets Finance see every deal in Sales to confirm
against. `pool` or `team` narrows it; `own` is wrong — Finance isn't the
closer and would have no visibility.

### Sales HOD + Finance (for tenants without a dedicated Finance role)

Grant on both. Sales HOD can confirm when Finance is unavailable. The
audit log distinguishes who confirmed.

## What NOT to grant

- `deals:confirm-payment` with scope `own` — the holder has no deals
  they themselves are the closer on in the "confirm advance" role, so
  the grant is effectively dead.
- `deals:confirm-payment` on an Agent position — collection pressure
  belongs to management, not the salesperson closing the lead.
- Positions without a department — scope `department` resolves to the
  caller's department; a position without one sees nothing.

## Interaction with Win readiness

The manual payment port (`modules/sales/deals/manual-payment-port.ts`)
reads `deal.payment_status` and reports:

| payment_status      | readiness.satisfied | description                              |
|---------------------|---------------------|------------------------------------------|
| `advance_confirmed` | true                | Advance confirmed by Finance             |
| `paid`              | true                | Advance confirmed by Finance             |
| `unpaid`            | false               | Advance not yet confirmed by Finance     |
| `partial`           | false               | Advance only partially confirmed         |
| `partially_refunded`| false               | A refund is outstanding on this deal     |
| `refunded`          | false               | This deal has been fully refunded        |

So the win-recorder blocks on an un-confirmed advance; after
`deals:record-win`, the deal is Won — but a revert on a Won deal is
rejected and must go through cancel-after-win.

## Replacing with a gateway

The manual port is registered at `initializePorts()` in
`modules/index.ts`. A gateway port (Stripe/Razorpay) replaces it in the
same boot step — the registration throws on a second call, so a gateway
module cannot silently layer on top. When wiring a gateway:

1. Remove the `registerPaymentReadinessPort(manualPaymentReadinessPort)`
   line.
2. Register the gateway port instead.
3. Decide whether the confirm/revert endpoints survive as an admin
   override or are removed. A gateway can refund; manual revert is only
   needed if operators still need a "misclicked" undo path.

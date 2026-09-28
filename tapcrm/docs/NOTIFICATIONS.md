# Notification engine — developer guide

Written for developers adding a feature that needs to notify someone.
Spec: PRD §14.5 (NT-1..NT-8) · TECH §3.1, §9 (outbox), RT-1..RT-6.

## Sending a notification

Call `notify()` **inside your business transaction**. That is the whole API.

```ts
import { notify } from '../notifications/facade.js';

await db.transaction(ctx, async (tx) => {
  await assignLead(tx, leadId, assigneeId);

  await notify(tx, ctx, {
    type: 'lead.assigned',          // add it to NOTIFICATION_TYPES first
    priority: 'operational',        // or 'informational' (default)
    audience: { users: [assigneeId] },
    title: 'New lead assigned',
    body: 'Acme Ltd was assigned to you.',
    link: `/company/leads/${leadId}`, // in-app path only
    metadata: { leadId },           // small identifiers, never record bodies
  });
});
```

`notify()` writes **one `notification_outbox` row and nothing else**. No socket,
no email, no audience lookup, no network call (TX-2). Consequences you can rely on:

- Business action rolls back → **no notification** exists.
- Business action commits → **exactly one** notification per recipient, even if
  Redis, the socket layer or a channel is down.
- You never wait on delivery, and delivery can never fail your request.

It throws only on a **malformed call** (empty audience, unknown action, external
link, bad id) so the mistake shows up in your tests, not in production.

Import only from `notifications/facade.js` (MB-1). Do not import the
repository, dispatcher or service from another module.

## Choosing an audience

Fields are **unioned**; give at least one. The actor is excluded unless
`includeActor: true`.

| Field | Selects |
|---|---|
| `users: [id…]` | Those users (any active non-service account, so client-portal users work). |
| `positions: [id…]` | Every active employee in those positions. |
| `departments: [id…]` | Every active employee in those departments. |
| `holders: { action, departmentId?, teamId? }` | Every active employee who **currently holds** the registry `action`, plus Super Admin. Honours unexpired overrides — an override that *denies* removes the person. Prefer this whenever the notification points at something guarded by an action (NT-1). |
| `excludeUserIds` | Removes people from the union. |

Only **active** users of **your own organization** are ever selected; a foreign
or inactive id in `users` is silently dropped.

> **Known limit (Phase 1).** `holders` checks that a person holds the *action*,
> not their *scope over the specific record*. If the record is narrower than the
> action's scope (e.g. one team's lead), narrow with `teamId`/`departmentId` or
> pass explicit `users`. Full per-record resolution through the authorization
> engine is the Phase 2 upgrade.

## Choosing a priority (NT-3)

- `operational` — something needs the person to act, or a security event.
  **Never silenced** by user preferences or quiet hours.
- `informational` — FYI. Preferences may silence or digest it (Phase 3).

## Adding a type

Types are free-form strings in the database (no migration per type) but are
declared in `modules/notifications/types.ts → NOTIFICATION_TYPES` so they are
discoverable and typo-safe. Convention: `<module>.<event>`, e.g. `lead.assigned`.

## How it flows

```
your tx ──notify()──▶ notification_outbox            (same transaction)
                          │  commit
                          ▼
              dispatcher (every 2 s, every API replica, FOR UPDATE SKIP LOCKED)
                per outbox row, ONE transaction:
                  resolve audience → 1 notification row per recipient
                  → notification_delivery('in-app') → mark row processed
                          │  after commit
                          ▼
              socket.io  notification:new { id, type, priority, createdAt }  → user room
                          ▼
              client refetches GET /api/notifications  (RT-4: no bodies on the socket)
```

- **PostgreSQL is the source of truth.** Sockets are only a "refetch now"
  signal. A user who was offline, or whose socket dropped, sees everything on
  their next fetch; the client also polls every 60 s while disconnected (RT-6).
- Dispatch is crash-safe and idempotent. A failing row is retried up to 5 times
  and then stays unprocessed so a backlog alert can surface it; a permanently
  malformed payload is retired immediately with the reason in `last_error`.
- Rows expire after `expiresInDays` (default 90) and are pruned daily (NT-8).
  `notification_delivery` outlives them.

## API (self-service, own scope)

All routes require a logged-in user and are scoped to that user — no route takes
a recipient id, and another user's notification id returns 404.

| Route | Purpose |
|---|---|
| `GET /api/notifications?unread=true&limit=20&cursor=…` | Centre list, newest first, keyset-paged. Returns `unreadCount` and `nextCursor`. |
| `GET /api/notifications/unread-count` | Cheap badge count. |
| `POST /api/notifications/:id/read` | Mark one read. |
| `POST /api/notifications/read-all` | Mark all read. |

There is deliberately no registry action for these: the PRD grants
`notifications` at `own` scope to every principal, so there is nothing to
delegate or deny.

## Realtime

`platform/realtime/` runs socket.io with the Redis adapter (falls back to
in-memory on a single node). The handshake uses the same token and
session-version check as HTTP (RT-1) and is re-checked every 2 minutes, so a
revoked session is disconnected. **Clients cannot join rooms**; the server
derives `org:<orgId>:user:<userId>` from the authenticated identity (RT-2).
`emitToUser()` is best-effort and never throws — call it after commit only.

## Testing your notification

Unit-test that your service calls `notify()` with the right input. For an
end-to-end check use the pattern in
`notifications.integration.test.ts` (real PostgreSQL through the runtime role,
opt-in via `TAPCRM_INTEGRATION_DB=1`; the database name must contain `test`).

## Not built yet

Phase 2: email channel with per-channel delivery log, per-record audience
resolution. Phase 3: per-user/per-type preferences, digests, quiet hours, push
and WhatsApp, a full notifications page. New channels plug in after the commit
in `dispatcher.ts → dispatchOrganization`; record each outcome with
`insertDeliveries` (NT-4) and never silence `operational` (NT-3).

## Configuration

`NOTIFICATION_DISPATCHER_ENABLED` (default `true`) and
`NOTIFICATION_DISPATCH_INTERVAL_MS` (default `2000`). Redis is optional for
delivery (only the multi-replica socket fan-out uses it).

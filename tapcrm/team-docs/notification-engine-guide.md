# The notification engine — how it works and how to use it

> Owner: Anish · Written: 2026-09-25 · Status: current
> Audience: developers new to the codebase. You do not need to know anything
> about the notification code beforehand.
>
> This guide describes the code as merged to `main` (migration `0050`). If the
> code and this guide ever disagree, **the code wins** — and please fix the guide.

---

## Contents

1. [What it is, in one minute](#1-what-it-is-in-one-minute)
2. [Words you will see](#2-words-you-will-see)
3. [The big picture](#3-the-big-picture)
4. [Send your first notification (5 steps)](#4-send-your-first-notification-5-steps)
5. [A real example: the Tasks module (copy this pattern)](#5-a-real-example-the-tasks-module-copy-this-pattern)
6. [Everything `notify()` accepts](#6-everything-notify-accepts)
7. [How it is built — the components](#7-how-it-is-built--the-components)
8. [Life of one notification, step by step](#8-life-of-one-notification-step-by-step)
9. [The database tables](#9-the-database-tables)
10. [The REST API](#10-the-rest-api)
11. [Realtime (sockets)](#11-realtime-sockets)
12. [The frontend](#12-the-frontend)
13. [Rules — do and don't](#13-rules--do-and-dont)
14. [Trying it locally](#14-trying-it-locally)
15. [It didn't arrive — debugging checklist](#15-it-didnt-arrive--debugging-checklist)
16. [Testing your notification](#16-testing-your-notification)
17. [Configuration](#17-configuration)
18. [What is not built yet](#18-what-is-not-built-yet)
19. [Cheat sheet](#19-cheat-sheet)

---

## 1. What it is, in one minute

TapCRM needs to tell people things: "a lead was assigned to you", "your leave was
approved", "an invoice is overdue". Instead of every feature inventing its own way
to do that, there is **one engine**. A feature developer does exactly one thing:

```ts
await notify(tx, ctx, { type: 'task.assigned', audience: { users: [userId] }, title: 'You were assigned a task' });
```

…and the engine takes care of the rest: finding the right people, saving one
notification per person, showing a red badge on the bell in their header, popping
a toast if they are online, and remembering it for them if they are not.

**What you get for free:**

- People who are offline see the notification next time they log in.
- If your action fails and rolls back, **no notification is created**.
- A slow or broken notification system can never break your feature.
- Each person has their own read/unread state.
- Users only ever see their own notifications, and never another company's.

---

## 2. Words you will see

| Word | Meaning |
|---|---|
| **Notification** | One message for **one person**. If 10 people are notified, 10 rows exist. |
| **Recipient** | The person a notification belongs to. |
| **Audience** | *Who* should get it — a description ("these users", "everyone in Sales", "everyone allowed to view audit logs"). The engine turns it into a list of recipients. |
| **Actor** | The person who caused the event (the one who clicked "assign"). They are **not** notified by default. |
| **Outbox** | A "to-do list" table. Your code writes *"please notify these people"* into it, inside your database transaction. A background worker reads it afterwards. |
| **Dispatcher** | The background worker that empties the outbox and creates the real notifications. |
| **Transaction** (`tx`) | A group of database changes that succeed or fail *together*. |
| **`ctx`** | The request context: who is calling and for which company (organization). |
| **Tenant / organization** | One customer company. Their data must never mix with another's. |
| **RLS** | Row-Level Security. The database itself refuses to show one company's rows to another. |
| **Socket** | A live connection between the browser and the server, used to say "something new arrived" instantly. |
| **Facade** | A small, official doorway into a module. `notifications/facade.ts` is *the* doorway into this engine. |
| **Priority** | `informational` (nice to know) or `operational` (needs the person to act). |

---

## 3. The big picture

```
 YOUR FEATURE (e.g. tasks)                                         THE BROWSER
 ────────────────────────                                          ───────────
 db.transaction(ctx, async (tx) => {
   ... your normal changes ...
   await notify(tx, ctx, {...})  ──┐
 })                                │  (same transaction: both save, or neither)
                                   ▼
                        ┌──────────────────────┐
                        │  notification_outbox │   "please notify these people"
                        └──────────┬───────────┘
                                   │  every ~2 seconds
                                   ▼
                        ┌──────────────────────┐
                        │      DISPATCHER      │   1. work out the recipients
                        │ (background worker)  │   2. save one row per person
                        └──────────┬───────────┘   3. record "delivered in-app"
                                   │
                  ┌────────────────┴─────────────────┐
                  ▼                                  ▼
        ┌──────────────────┐             ┌────────────────────────┐
        │   notification   │             │  socket: "notification │
        │ (one row / person)│             │  :new" to that person  │──▶  🔔 badge + toast
        └────────┬─────────┘             └────────────────────────┘
                 │                                                       │
                 └──────────────  GET /api/notifications  ◀──────────────┘
                                  (the browser refetches the list)
```

Three ideas explain almost every design decision:

1. **The database is the source of truth; sockets are only a doorbell.** The
   socket message says *"something changed"* and carries no text. The browser then
   asks the API for the real list. If the socket is down, nothing is lost — the
   list is still in the database.
2. **Your code never talks to sockets, email or the network.** It only writes one
   row to the outbox. Doing network calls inside a database transaction is
   forbidden in this codebase (rule **TX-2** in `docs/TECH.md`) because a slow call
   would hold the database hostage, and a rolled-back transaction could still have
   sent a message.
3. **Everything is scoped to the person and the company.** There is no API that
   takes "someone else's id".

---

## 4. Send your first notification (5 steps)

**Step 1 — Register a type.** Open
[`packages/server/src/modules/notifications/types.ts`](../packages/server/src/modules/notifications/types.ts)
and add your type to `NOTIFICATION_TYPES`:

```ts
export const NOTIFICATION_TYPES = {
  SYSTEM_TEST: 'system.test',
  LEAVE_APPROVED: 'leave.approved',    // ← yours: '<module>.<event>'
} as const;
```

The name format is `module.event`, lowercase (letters, digits, `.`, `-`, `_`).

**Step 2 — Import the facade.** Only this one file. Never import anything else from
`modules/notifications/` (see [rule 1](#13-rules--do-and-dont)).

```ts
import { notify, NOTIFICATION_TYPES } from '../notifications/facade.js';
```

**Step 3 — Call `notify` *inside* your transaction**, after your own changes:

```ts
await db.transaction(ctx, async (tx) => {
  await approveLeave(tx, leaveId);                  // your feature

  await notify(tx, ctx, {                           // the notification
    type: NOTIFICATION_TYPES.LEAVE_APPROVED,
    audience: { users: [employeeId] },
    title: 'Your leave was approved',
    body: '12–14 Oct',
    link: '/company/leave',
  });
});
```

**Step 4 — Run your feature** and watch the API terminal. Within about 2 seconds you
should see `notifications dispatched`. The recipient's bell shows a badge.

**Step 5 — Add a test** (see [section 16](#16-testing-your-notification)).

That is the whole job. Everything else in this guide is explanation.

---

## 5. A real example: the Tasks module (copy this pattern)

The Tasks module is fully wired to the engine and is the **reference implementation**.
Read these two files side by side:

- [`modules/tasks/notifications.ts`](../packages/server/src/modules/tasks/notifications.ts) —
  *what to say and to whom* (all the notification decisions live here)
- [`modules/tasks/service.ts`](../packages/server/src/modules/tasks/service.ts) —
  the business logic, with **one small call** added per operation

### The pattern

1. **One `notifications.ts` per module.** It is the only file that knows what each
   business event means to a human: who hears about it, and what the message says.
   The header comment of the Tasks one has a table of every rule.
2. **`service.ts` makes one call** right after its own work and audit entry, **inside
   the same transaction**:

   ```ts
   await enqueueTaskAudit(tx, ctx, { action: 'task.updated', ... });          // existing
   await notifyTaskUpdated(tx, ctx, existing, changedTaskFields(existing, input)); // new
   ```
3. **The helper file talks to the engine only through `notifications/facade.js`.**
4. **Register the types** in `NOTIFICATION_TYPES` (done: `task.assigned`,
   `task.unassigned`, `task.updated`, `task.status_changed`, `task.completed`).

### What each Task operation does

| Operation | Who is notified | Type | Priority |
|---|---|---|---|
| Create task | The assignees | `task.assigned` | operational |
| Assign (replace list) — someone **added** | Just the added people | `task.assigned` | operational |
| Assign — someone **removed** | Just the removed people | `task.unassigned` | informational |
| Update details | Current assignees, and only if a field **really changed** | `task.updated` | informational |
| Change status | Creator + assignees | `task.status_changed` | informational |
| Mark completed | Creator + assignees | `task.completed` | informational |
| Read (list / get) | **Nobody** — reading never notifies | – | – |
| Delete | *The Tasks module has no delete operation.* Cancelling is a status change, covered above. | – | – |

In every case **the person who did the action is not notified about it.**

### Small decisions worth copying

- **Only the difference is news.** Re-saving the same assignee list, or saving a form
  without editing anything, notifies nobody. `changedTaskFields()` compares against
  the stored task instead of trusting "was the field sent".
- **Skip `notify()` when the audience would be empty.** `recipients()` removes the
  actor and duplicates first; if nobody is left, no outbox row is written.
- **`operational` only for "you now have work".** Being assigned is operational;
  "someone edited it" is not.
- **Say *what* changed, not the new values** ("changed: priority, due date"). The
  notification is a pointer, not a copy of the record.
- **`metadata: { taskId }`** carries the id so a future page can deep-link to the
  exact task; `link` is the in-app page (`/company/tasks`) for now.
- **Long titles are clipped** so a 255-character task title cannot break the
  notification limits.

### How it is tested (copy this too)

- [`tasks/notifications.test.ts`](../packages/server/src/modules/tasks/notifications.test.ts) —
  fast unit tests with the engine mocked: who is in the audience, actor excluded,
  nothing sent when nothing changed, message content.
- The **`notifications`** block at the bottom of
  [`tasks/tasks.integration.test.ts`](../packages/server/src/modules/tasks/tasks.integration.test.ts) —
  end-to-end against a real database: do the action, run the dispatcher, then check
  who actually received what — including that a **failed operation leaves no
  notification behind**.

---

## 6. Everything `notify()` accepts

```ts
notify(tx, ctx, input)
```

| Argument | What |
|---|---|
| `tx` | The transaction you are inside. |
| `ctx` | The request context (needs `organizationId` and `principal`). |
| `input` | See below. |

### `input`

| Field | Required | Limits / default | Notes |
|---|---|---|---|
| `type` | yes | `module.event`, max 100 chars | Register it in `NOTIFICATION_TYPES` first. |
| `audience` | yes | see below | Who receives it. |
| `title` | yes | 1–200 chars | Short, human sentence. Shown in bold. |
| `body` | no | up to 2000 chars, default `''` | One or two lines of detail. |
| `priority` | no | `'informational'` (default) or `'operational'` | See below. |
| `link` | no | must start with a single `/` | In-app path the click goes to. |
| `metadata` | no | values: string ≤500 chars, number, boolean, `null` | Small ids only. **Not** whole records. |
| `expiresInDays` | no | 1–3650, default **90** | Old notifications are deleted after this. |

### `audience` — who gets it

Give **at least one** of these. If you give several, the results are **combined**
(a union), duplicates removed.

| Field | Selects | Example |
|---|---|---|
| `users` | These users (any active account except service accounts, so client-portal users work too) | `{ users: [aliceId, bobId] }` |
| `positions` | Every active employee holding these positions | `{ positions: [salesAgentPositionId] }` |
| `departments` | Every active employee in these departments | `{ departments: [salesDeptId] }` |
| `holders` | Every active employee who **currently has the permission** `action`, plus Super Admins. Respects overrides (an override that *denies* removes the person). Optionally narrowed by `departmentId` / `teamId`. | `{ holders: { action: 'audit:view' } }` |
| `excludeUserIds` | Removes these people from the result | `{ users: [...], excludeUserIds: [managerId] }` |
| `includeActor` | Set `true` to also notify the person who triggered it (default: they are left out) | `{ users: [me], includeActor: true }` |

**Which one should I use?**

- You know exactly who → `users`.
- "Everyone in this role/team" → `positions` / `departments`.
- The notification points at something protected by a permission, and you want to
  notify *whoever is allowed to open it* → `holders`. This is the safest choice,
  because it guarantees nobody is told about something they cannot open (PRD rule
  NT-1).

> **Limit to know about:** `holders` checks that a person has the *permission*, not
> their *reach over that specific record*. If the record belongs to one team only,
> add `teamId`/`departmentId` or list `users` explicitly. A per-record check is
> planned (see [section 18](#18-what-is-not-built-yet)).

Automatically, the engine only ever selects **active** people in **your own
organization**. A stranger's id, or a deactivated user's id, is silently dropped.

### `priority`

| Value | Use it when | Effect (now / later) |
|---|---|---|
| `informational` | "FYI" — a comment was added, a report finished | Later: users can silence or digest these |
| `operational` | Someone must act, or it's a security event — an approval waiting, a deadline | **Never** silenced by preferences or quiet hours (rule NT-3) |

If unsure, use `informational`. Show an *Action* tag only when it really needs action.

### What `notify()` does when you get it wrong

It **throws** immediately (empty audience, unknown permission in `holders`, a
`link` that isn't an in-app path, a bad UUID…). That is deliberate: you find the
mistake in your test, not in production. It never throws because delivery failed —
delivery happens later, elsewhere.

---

## 7. How it is built — the components

### 7.1 Map of the files

```
tapcrm/
├─ migrations/
│   └─ 0050_notifications.sql              ← the 3 tables + security rules
│
├─ packages/server/src/
│   ├─ modules/notifications/
│   │   ├─ facade.ts        ← notify()  — THE ONLY thing other modules import
│   │   ├─ types.ts         ← NOTIFICATION_TYPES, input rules (validation), shapes
│   │   ├─ audience.ts      ← turns an audience into a list of user ids
│   │   ├─ dispatcher.ts    ← background worker that empties the outbox
│   │   ├─ repository.ts    ← all SQL for this module
│   │   ├─ routes.ts        ← the 4 REST endpoints
│   │   ├─ notifications.test.ts              ← fast unit tests
│   │   └─ notifications.integration.test.ts  ← real-database tests
│   │
│   ├─ platform/realtime/
│   │   ├─ index.ts         ← socket server + emitToUser()
│   │   └─ realtime.test.ts
│   │
│   ├─ platform/jobs.ts     ← (edited) daily job that deletes expired notifications
│   ├─ index.ts             ← (edited) starts/stops the dispatcher and socket server
│   ├─ app.ts               ← (edited) mounts the routes
│   └─ config.ts            ← (edited) 2 new settings
│
└─ packages/client/src/
    ├─ notifications/
    │   ├─ api/notificationsApi.ts   ← fetch functions for the 4 endpoints
    │   ├─ useNotifications.ts       ← React hook: data + socket + polling
    │   └─ NotificationBell.tsx      ← the bell, badge, dropdown and toast
    └─ company/layout/CompanyHeader.tsx  ← (edited) shows the bell
```

### 7.2 What each piece is responsible for

| Component | Job | Knows about |
|---|---|---|
| **facade** (`facade.ts`) | Validate your input and write **one outbox row**. Nothing else. | Only the outbox table |
| **types** (`types.ts`) | The single definition of what a valid notification looks like (a Zod schema), plus the list of types | Nothing else |
| **audience** (`audience.ts`) | Convert "who" into a list of user ids, using positions, departments and the permission tables | Users, positions, policies, overrides |
| **dispatcher** (`dispatcher.ts`) | Every ~2 s, for each organization: take pending outbox rows, resolve audience, insert notifications, record delivery, then ping the sockets | Everything above + realtime |
| **repository** (`repository.ts`) | All the SQL. Every read is filtered by the calling user | The database |
| **routes** (`routes.ts`) | The four endpoints the bell uses | Repository, realtime |
| **realtime** (`platform/realtime`) | Authenticate sockets, put each user in a private room, send signals | Sockets, Redis (optional) |
| **client hook** | Loads the list, listens for the socket, falls back to polling | The API and the socket |
| **bell** | Draws the UI | The hook |

The split matters: the code that *asks* for a notification (facade) is tiny and
fast, and knows nothing about sockets or email. The code that *delivers* it
(dispatcher) can be slow, retry, and grow new channels without any feature code
changing.

### 7.3 The three-layer rule you will see everywhere

`routes → service/repository → database` — routes handle HTTP, repository handles
SQL. Other modules must go through the **facade**, never through the repository.
The rule comes from `docs/TECH.md` §3. CI has a check for it, but it only catches
imports written in the `../modules/<name>/…` style, so **it will not catch every
violation — you and your reviewer are the real safeguard.**

---

## 8. Life of one notification, step by step

Let's follow *"Alice assigns a task to Bob"* from click to bell.

**Step 1 — Alice clicks Assign.** `assignTask` starts a database transaction.

**Step 2 — Your feature does its work.** Bob is added as an assignee. An audit
entry is queued.

**Step 3 — `notify()` runs** (still inside the transaction). It validates the input,
then does *one* thing:

```sql
INSERT INTO notification_outbox (organization_id, payload) VALUES (..., '{...json...}')
```

**Step 4 — The transaction commits.** The assignment and the outbox row are saved
together. (If anything had failed, both would have been rolled back.)

**Step 5 — The dispatcher wakes up** (it runs in every API process, roughly every
2 seconds). It finds the pending outbox row. For that row it opens a **new**
transaction and:

1. locks the row (`FOR UPDATE SKIP LOCKED` — so two servers never process the
   same row),
2. **re-validates** the payload,
3. **resolves the audience** → `[Bob]` (Alice is removed as the actor),
4. inserts one `notification` row for Bob,
5. inserts a `notification_delivery` row (`channel = in-app`, `status = delivered`),
6. marks the outbox row processed.

**Step 6 — After that transaction commits**, the dispatcher sends a socket message
to Bob's private room: `notification:new { id, type, priority, createdAt }`.

**Step 7 — Bob's browser hears it** (if he is online), calls
`GET /api/notifications`, updates the badge and shows a toast.
If Bob is offline, nothing is lost: next time he opens the app, the same
`GET /api/notifications` shows it.

**What if something fails?**

| Situation | What happens |
|---|---|
| Alice's action fails and rolls back | No outbox row → no notification. |
| The dispatcher crashes half-way through a row | The row's transaction rolls back; it is picked up again. No duplicates. |
| The database errors while dispatching | The failure is logged, the attempt counter goes up, it retries. After **5** failed attempts the row is left unprocessed so an alert can find it. |
| The payload is invalid (a bug) | It is retired immediately with the reason saved in `last_error`. |
| The audience resolves to nobody | The row is marked done with the note *"audience resolved to no active recipients"*. |
| The socket/Redis is down | The notification is still saved. The browser polls every 60 s while disconnected. |
| The dispatcher runs twice on the same row | A processed row is never processed again. |

---

## 9. The database tables

All three are in `migrations/0050_notifications.sql`, and all have **RLS** (the
database only shows a company its own rows).

### `notification_outbox` — the to-do list
One row per `notify()` call.

| Column | Meaning |
|---|---|
| `id` | Row id |
| `organization_id` | Which company |
| `payload` | JSON: the type, audience, title, body, link… exactly what you passed |
| `enqueued_at` | When your transaction wrote it |
| `processed_at` | `NULL` = still waiting. Set when the dispatcher finishes it |
| `attempts` | How many tries so far |
| `last_error` | Why a try failed, or a note about an empty audience/invalid payload |

### `notification` — what people actually see
**One row per recipient.**

| Column | Meaning |
|---|---|
| `id` | Notification id |
| `organization_id`, `recipient_id` | Which company, which person |
| `type` | e.g. `task.assigned` |
| `priority` | `informational` / `operational` |
| `title`, `body`, `link` | What is shown |
| `metadata` | Small extra ids (JSON) |
| `read_at` | `NULL` = unread |
| `created_at` | When it was created |
| `expires_at` | After this it is hidden and later deleted |

### `notification_delivery` — the delivery log
One row per notification **per channel** (`in-app`, and later `email`, `push`,
`whatsapp`) recording `delivered` / `failed` / `skipped` and when. It has no link to
`notification` on purpose, so the log **outlives** the notification when that is
cleaned up.

---

## 10. The REST API

All four are **for the logged-in user only**. There is no parameter for "someone
else's" and no way to pass a recipient. An id that isn't yours returns 404, exactly
like one that doesn't exist.

Send the same `Authorization: Bearer <token>` header as every other API call.
Responses use the usual `{ "success": true, "data": ... }` envelope.

### `GET /api/notifications`
The notification centre. Newest first.

| Query | Default | Meaning |
|---|---|---|
| `unread` | `false` | `true` = only unread |
| `limit` | `20` | 1–50 |
| `cursor` | – | Pass the previous response's `nextCursor` to get the next page |

```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "0192…", "type": "task.assigned", "priority": "operational",
        "title": "You were assigned a task", "body": "Prepare the Q4 report",
        "link": "/company/tasks", "metadata": { "taskId": "…" },
        "read": false, "readAt": null, "createdAt": "2026-09-25T10:00:00.000Z"
      }
    ],
    "unreadCount": 3,
    "nextCursor": "eyJ…"      // null when there are no more
  }
}
```

Paging uses a **cursor** (a bookmark), not page numbers, so new notifications
arriving while you scroll never cause repeats or gaps.

### `GET /api/notifications/unread-count`
Just the badge number: `{ "data": { "unreadCount": 3 } }`. Cheap.

### `POST /api/notifications/:id/read`
Marks one as read. Returns the updated notification. 404 if it isn't yours.

### `POST /api/notifications/read-all`
Marks all of yours as read. Returns `{ "updated": 4 }`.

*Why no registry "action" for these?* Every other route in TapCRM is guarded by a
named permission. These are different: **everyone** may read **their own**
notifications (the PRD gives the `notifications` module `own` scope to every role),
so there is nothing to grant or deny. They follow the same pattern as
`/api/identity/sessions` — see `routes.ts`.

---

## 11. Realtime (sockets)

Code: [`platform/realtime/index.ts`](../packages/server/src/platform/realtime/index.ts).

- **Library:** socket.io. With Redis it can run on several servers; without Redis it
  falls back to a single server (fine for local dev).
- **Connecting:** the browser connects to `/socket.io` and sends its access token.
  The server checks the **same token and session** as a normal API call. No valid
  token → rejected.
- **Rooms:** each connected user is put in exactly one private room,
  `org:<organizationId>:user:<userId>`, **chosen by the server**. The client
  cannot join or create rooms — the server does not even listen for such requests.
  The organization is part of the room name, so a user with the same id in
  another company could never share it.
- **Staying safe:** every 2 minutes the server re-checks the token and session.
  If the session was revoked or expired, the socket is disconnected. The browser
  reconnects with a fresh token.
- **Events sent** (payloads deliberately carry **ids only**, never text —
  rule RT-4):

  | Event | Payload | Meaning |
  |---|---|---|
  | `notification:new` | `{ id, type, priority, createdAt }` | You have a new notification — refetch |
  | `notification:read` | `{ id }` or `{ all: true }` | You read something in another tab — update your badge |

- **`emitToUser(orgId, userId, event, payload)`** is the helper that sends them. It
  is **best-effort and never throws**. Only call it **after** a transaction has
  committed.

*Why no text in the socket message?* If the socket carried the whole notification,
there would be two ways for data to leave the server, and the second one would
bypass the normal security checks. Keeping the socket to "something changed" keeps
the API as the single, checked path.

---

## 12. The frontend

| File | What it does |
|---|---|
| `notifications/api/notificationsApi.ts` | Four small functions calling the four endpoints. Reuses `identityRequest` so token refresh and login redirects work automatically. |
| `notifications/useNotifications.ts` | A React hook. On mount it loads the first page and connects the socket. It listens for `notification:new` / `notification:read`, refetches when told, falls back to polling every **60 s** while the socket is down, and reconnects if the token expires. Also provides `markRead`, `markAllRead`, `loadMore`. Updates are optimistic (the badge changes instantly and rolls back if the server says no). |
| `notifications/NotificationBell.tsx` | The bell icon with unread badge (`99+` cap), the dropdown list, "Mark all read", "Load older", and the toast for live arrivals. Closes on Escape or outside click. Clicking an item marks it read and navigates to its `link`. Operational notifications show an **Action** tag. |
| `company/layout/CompanyHeader.tsx` | Renders `<NotificationBell onNavigate={...} />` next to the theme toggle. |
| `vite.config.ts` | Proxies `/socket.io` (with WebSockets) to the API in dev. |

You normally **don't touch the frontend** to add a new notification type — the bell
renders any type. You only edit it if you want a special icon or layout for one
type.

---

## 13. Rules — do and don't

1. **Import only from `notifications/facade.js`.** Not the repository, dispatcher or
   routes. (This is a team rule from `docs/TECH.md` §3; CI catches only some
   violations, so check your own imports.)
2. **Call `notify()` inside your `db.transaction`,** using the same `tx`. If you call
   it outside, you lose the "both or neither" guarantee.
3. **Don't send sockets, emails or HTTP requests inside a transaction.** That is
   rule TX-2. `notify()` exists precisely so you don't have to.
4. **Don't `await` delivery or expect a result.** `notify()` returns nothing useful;
   the notification appears a moment later.
5. **Keep `metadata` tiny** — ids and flags. The client refetches through the API,
   where permissions apply. Never put personal data, whole records or secrets in a
   notification.
6. **`link` is an in-app path** (`/company/tasks`), never a full URL. The engine
   rejects anything else so a notification can't be used to send people to a
   malicious site.
7. **Notify the right people.** Prefer `holders` when the notification points at
   something protected. Don't blast a whole department for a one-person matter.
8. **Don't notify for noise.** Too many notifications train people to ignore all of
   them. Use `operational` only when action is needed.
9. **Never edit the tables by hand in application code.** Go through `notify()`.
10. **Write a test.** At minimum, one that calls your service and checks `notify`
    was given the right input.

### Common mistakes

| Mistake | What goes wrong | Fix |
|---|---|---|
| `notify()` called *after* the transaction ends | Notification can exist for something that rolled back | Move it inside the callback |
| Using a different `tx`/`db` than the transaction | Not atomic | Pass the same `tx` |
| Notifying yourself and wondering why nothing arrives | The actor is excluded by default | Add `includeActor: true` if you really want it |
| `link: 'https://…'` or `link: 'tasks'` | `notify()` throws | Start with a single `/` |
| Empty list: `audience: { users: [] }` | `notify()` throws | Check the list first (`if (ids.length)`) |
| Putting the entire task in `metadata` | Wrong (data leak, size) | `metadata: { taskId }` |
| Inventing a type string inline | Typos, hard to find | Add to `NOTIFICATION_TYPES` |

---

## 14. Trying it locally

You need the API and web app running (`npm run dev:api`, `npm run dev:web`) and a
seeded company (`npm run seed:demo -- --organization=<CODE>` — see the setup notes).

**Easiest: use a real flow** — add your `notify()` call to a feature, perform the
action in the UI, and watch the recipient's bell.

**Manual: insert an outbox row yourself.** This is exactly what `notify()` does:

```sql
INSERT INTO notification_outbox (organization_id, payload)
SELECT organization_id, jsonb_build_object(
  'type','system.test','priority','operational','title','Hello from the outbox',
  'body','It works','link','/company/dashboard','metadata','{}'::jsonb,
  'expiresInDays',90,'actorId',NULL,
  'audience', jsonb_build_object('users', jsonb_build_array(id::text)))
FROM app_user WHERE email = 'demo.hr.head@example.test';
```

Run it in `psql` as the migration role
(`docker compose exec postgres psql -U tapcrm_migrator -d tapcrm`).

> In the local Docker database the migration role is a superuser, so row-level
> security doesn't get in the way. On a database where it does, first run
> `SELECT set_config('app.organization_id', '<the organization uuid>', false);`.

Log in as that user in a browser; within ~2 seconds the bell should light up.

---

## 15. It didn't arrive — debugging checklist

Work down the list; each step tells you which part is at fault.

**1. Did `notify()` run at all?** Did it throw? Look at the API terminal / your test
output. A validation error message names the field.

**2. Is there an outbox row?**
```sql
SELECT id, processed_at, attempts, last_error, enqueued_at
FROM notification_outbox ORDER BY enqueued_at DESC LIMIT 5;
```
- No row → `notify()` wasn't reached, or your transaction rolled back.
- `processed_at` is `NULL` → the dispatcher hasn't handled it. Is the API running?
  Is `NOTIFICATION_DISPATCHER_ENABLED` not `false`? A **brand-new organization can
  wait up to 60 seconds** (the dispatcher refreshes its organization list once a
  minute) — restart the API to skip the wait.
- `attempts` = 5 and `last_error` filled → dispatching keeps failing; read the
  message.

**3. Did it become notifications?**
```sql
SELECT recipient_id, type, title, read_at, created_at
FROM notification ORDER BY created_at DESC LIMIT 5;
```
- `last_error` says *"audience resolved to no active recipients"* → nobody matched.
  Common causes: the only recipient was the actor, an inactive user, a user from a
  different organization, or `holders` matched nobody.
- `last_error` says *"invalid payload…"* → the JSON didn't pass validation.

**4. Row exists but the bell is empty?** Call the API in the browser dev tools
(Network tab) — `GET /api/notifications`. If it returns the row, it's a frontend
issue. If not, you're probably logged in as a different user or organization.

**5. Row exists but no live update (works only after refresh)?** The socket isn't
connecting. In the Network tab, look for a `socket.io` request.
- Not there / failing → restart `npm run dev:web` (the proxy for `/socket.io` needs a
  restart), and check the API terminal for `realtime unavailable`.
- Note: the client polls every 60 s as a fallback, so it will appear eventually.

**6. Still stuck?** Ask in the team channel with: the outbox row (`id`,
`last_error`), what you expected, and what the API terminal printed.

---

## 16. Testing your notification

There are two kinds of tests, and the notification module has examples of both.

### 16.1 Unit test (fast, no database) — do this one always
Check that your service calls `notify` with the right input. Mock the module:

```ts
import { vi } from 'vitest';
vi.mock('../notifications/facade.js', () => ({
  notify: vi.fn(),
  NOTIFICATION_TYPES: { TASK_ASSIGNED: 'task.assigned' },
}));
// ...run your function...
expect(notify).toHaveBeenCalledWith(
  expect.anything(), expect.anything(),
  expect.objectContaining({ type: 'task.assigned', audience: { users: [bobId] } }),
);
```

See [`notifications.test.ts`](../packages/server/src/modules/notifications/notifications.test.ts)
for tests of the facade itself (it writes exactly one outbox row, throws on bad
input, etc.).

### 16.2 Integration test (real PostgreSQL) — for important flows
[`notifications.integration.test.ts`](../packages/server/src/modules/notifications/notifications.integration.test.ts)
runs the whole engine against a real database: rollback produces nothing, replay is a
no-op, permission holders/overrides, tenant isolation, paging, the four endpoints.
These tests are **off by default**. To run them you need a throw-away test database
whose name contains `test`, migrated, then:

```
TAPCRM_INTEGRATION_DB=1  MIGRATION_DATABASE_URL=...  DATABASE_URL=...  REDIS_URL=...  \
JWT_ACCESS_SECRET=...  JWT_REFRESH_SECRET=...  npx vitest run packages/server/src/modules/notifications
```

(They refuse to run against a database without `test` in its name — on purpose.)
Copy that file's setup as a template if you write your own.

Also run before pushing: `npx tsc --build` and `npx eslint packages`.

---

## 17. Configuration

Both are optional; put them in `.env` only if you want to change the default.

| Setting | Default | Meaning |
|---|---|---|
| `NOTIFICATION_DISPATCHER_ENABLED` | `true` | `false` turns the dispatcher off (notifications then pile up in the outbox) |
| `NOTIFICATION_DISPATCH_INTERVAL_MS` | `2000` | How often the dispatcher checks for work (minimum 100) |

Redis (`REDIS_URL`) is only used to share socket messages between several API
servers. **Notifications are delivered without it.**

A scheduled job (`platform/jobs.ts`) deletes expired notifications once a day and
removes processed outbox rows older than 7 days.

---

## 18. What is not built yet

Be aware of these so you don't assume they exist:

- **Email, push and WhatsApp** channels. Only in-app exists. The delivery log table
  and the dispatcher are already shaped for them — a channel is a new step after the
  in-app delivery in `dispatcher.ts`.
- **User preferences** (per type/channel), **digests** and **quiet hours**.
  `priority` is already stored so these can honour "operational is never silenced".
- **A full "all notifications" page.** Today there is only the header dropdown.
- **Per-record audience checks.** `holders` checks the permission, not the reach over
  one specific record (see section 6).
- **Only Tasks is wired so far.** The engine is ready for every other module (Leave,
  Leads, Attendance…). Follow the Tasks pattern in section 5.

---

## 19. Cheat sheet

```ts
// 1. types.ts:   LEAVE_APPROVED: 'leave.approved'
// 2. In your service, INSIDE db.transaction:
import { notify, NOTIFICATION_TYPES } from '../notifications/facade.js';

await notify(tx, ctx, {
  type: NOTIFICATION_TYPES.LEAVE_APPROVED,
  priority: 'informational',              // or 'operational' if they must act
  audience: { users: [employeeId] },      // or positions / departments / holders
  title: 'Your leave was approved',
  body: '12–14 Oct',
  link: '/company/leave',                 // in-app path only
  metadata: { leaveId },                  // small ids only
});
```

| I want to notify… | Use |
|---|---|
| One or a few specific people | `users` |
| Everyone with a job title | `positions` |
| Everyone in a department | `departments` |
| Whoever is allowed to open the thing | `holders: { action: '…' }` |
| Not this person | `excludeUserIds` |
| Also the person who did it | `includeActor: true` |

| Symptom | First thing to check |
|---|---|
| Nothing created | `SELECT … FROM notification_outbox` — is there a row? |
| Row stuck | Is the API running? Read `last_error` |
| Created, but no bell | `GET /api/notifications` in the Network tab |
| Bell only updates on refresh | The `socket.io` request; restart `dev:web` |

**Remember:** inside the transaction · in-app `link` · small `metadata` · register the
type · one test.

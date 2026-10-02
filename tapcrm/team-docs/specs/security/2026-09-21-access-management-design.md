# `access-management` — Design

**Date** 21 September 2026
**Module** F3 `access-management` (PRD §8.3, P0 Foundation)
**Status** Approved in conversation; implementation starting

---

## 1. Why this module

PRD §18 makes P0 strictly first. Two of its five modules are done (`identity`
partially, `organization`). `access-management` is the largest remaining gap:
today permissions can only be changed by editing seed data and re-running the
seed. This module makes PRD §4 operable by a person who is not an engineer.

**Exit test.** A position can be created, given per-action policies, staffed, and
its effect verified from the access explorer.

---

## 2. What already exists

Verified against the codebase on 21 Sep 2026, not assumed.

| Thing | Where | State |
| --- | --- | --- |
| `position_policy`, `user_override`, `role_change_request` tables | `migrations/0002` | Exist, with tenant RLS |
| Policy resolution (position + override merge, expiry at read time) | `authz-adapter.ts:128` `resolveSet` | Done — satisfies AM-7's "evaluated at authorization time" |
| Position policy editor (`GET`/`PUT /api/org/positions/:id/policies`) | `organization` module | Done, incl. `positionGrantable` refusal |
| `effectivePolicy(ctx, action)` | `authz/engine.ts` | Exists **and is already used** by the organization module |
| `isWithinCeiling`, `scopeBreadth` | `contracts/scope.ts` | Exist, already used at `positions/service.ts:564` |
| Ceiling-check precedent | `positions/service.ts:550-585` | The pattern this module copies |
| A1 segregation of duties | `authz/sod.ts` | Reads the registry's declared `initiatorField`; denies when the field is absent |
| `subordinateIds` | scope resolver | Exists |
| Audit outbox → hash-chained `audit_entry` | `modules/audit/drainer.ts` | Built 21 Sep; this is the first module whose writes will be chained |

**Registry facts.** `access:delegate` declares `superAdminOnly: true` and
`users:manage` declares `superAdminOnly: false, delegationAllowed: false`.
The seeded HR position receives `users:manage` through the employee-directory
position policy; delegation remains unavailable for both capabilities.
`access:decide-role-change` declares `initiatorField: 'requestedBy'`, matching
`role_change_request.requested_by`.

### Corrections to earlier claims

Two statements made while presenting this design were wrong and are corrected
here:

1. `effectivePolicy` and `isWithinCeiling` are **not** unused. The organization
   module already uses both for position-policy ceilings. This strengthens the
   chosen approach — there is a precedent to follow — but the original claim was
   false.
2. `client/.../navigation.ts` holds **no** action mapping (label, path, icon
   only). AM-4's screen list cannot be derived from it as-is; a `requiredAction`
   field must be added to each nav item.

---

## 3. Decisions taken

| # | Decision | Reason |
| --- | --- | --- |
| D1 | Scope: 6 manifest routes, the delegation guard, the access explorer and the override panel | Smallest build satisfying the exit test end to end, keeping the security-critical guard in one reviewable change |
| D2 | AM-9 and AM-10 deferred | They need an override-list route the manifest does not define, and a route with no manifest entry refuses to boot (RM-1). Recorded as a question for the document owners, alongside the three already in the README |
| D3 | Override expiry is audited, not notified | The `notifications` module is P7. Building a second ad-hoc email path would have to be unpicked later. AM-7 also requires expiry be "as auditable as the grant", which this satisfies |
| D4 | Build fresh on current `main`; leave `origin/Dev/Pranay` untouched | That branch holds a ~5,200-line implementation but shares **no common ancestor** with `main` and registers 7 routes with an `authOnly` flag that does not exist here. User decision |

---

## 4. Architecture

A **delegation guard** (`access-management/delegation.ts`) invoked by the
override service before any write.

The alternative — registering the four constraints in the authz engine
alongside A1–A4 — fits badly. Engine constraints take `(ctx, action, resource)`
and judge a resource being acted upon; these four judge the *content of a
proposed grant*. Routing that through the engine means passing the request body
as a pseudo-resource. The engine already anticipates the chosen split:
`effectivePolicy` is documented as being "for ceiling validation by domain
services".

```
POST /api/access/override
  │
  ├─ framework: authorize(ctx, 'access:delegate', targetUser)   → 403 "not you"
  │
  ├─ delegation guard: the four constraints on the PAYLOAD      → 422 + predicate
  │     rootOfTrust · ceiling · boundary · seniority
  │
  └─ service: write user_override + audit_outbox, one transaction
```

### 4.1 The four constraints (PRD §4.6)

| Constraint | Rule | Implementation |
| --- | --- | --- |
| Root of trust | `access:delegate` is grantable only by Super Admin; `users:manage` is seeded for HR but never grantable by delegation | Read `REGISTRY[action].grantPolicy`; refuse when `superAdminOnly` or `!delegationAllowed` and the actor is not Super Admin |
| Ceiling | Cannot grant an action, or a wider scope, than the actor holds | `effectivePolicy(ctx, action)` must exist and be `allowed`; `isWithinCeiling(granted, held)`; granted `fields` must be a subset of the actor's |
| Boundary | The target must be inside the actor's own scope | Reuse `userPolicy.check()` rather than writing a second reachability rule |
| Seniority | Target's level strictly lower than the actor's | `target.organizationalLevel < actor.organizationalLevel` |

Super Admin bypasses all four; the engine already audits that bypass.

Domain validity is checked first, as the position editor does: a scope
undefined for the action's domain (`all-people` against a business resource,
PD-1) is refused before the ceiling is considered.

### 4.2 Error semantics

Ceiling, boundary, seniority and root-of-trust failures return **422 with the
unmet predicate named**, matching `ORG_POSITION_POLICY_CEILING_EXCEEDED` in the
organization module.

This is deliberate and differs from an early draft of this design that proposed
403. The framework's 403 gate — "do you hold `access:delegate`?" — has already
passed by the time the guard runs. What is refused is the *content* of the
grant, which is NF-23b's "not this record, not yet", and WF-4 requires the unmet
predicate be named so the caller can act on it.

---

## 5. Endpoints

All six already exist in the manifest; none are implemented.

| Method | Path | Action | Does |
| --- | --- | --- | --- |
| GET | `/api/access/effective/:userId` | `access:view` | AM-4 direction 1 |
| GET | `/api/access/who-can/:action` | `access:view` | AM-4/AM-5 direction 2 |
| POST | `/api/access/override` | `access:delegate` | AM-6, guarded |
| DELETE | `/api/access/override/:id` | `access:delegate` | Revoke |
| POST | `/api/access/role-change-request` | `access:request-role-change` | AM-12 |
| POST | `/api/access/role-change-request/:id/decide` | `access:decide-role-change` | AM-12, A1 |

### 5.1 `GET /access/effective/:userId`

Returns every effective policy with its `source` (`position` or `override`),
`scope`, `fields`, and for overrides the `reason`, `grantedBy`, `grantedAt` and
`expiresAt`. Includes the subject's subordinate set. Reuses the same SQL shape
as `resolveSet` so the explorer can never disagree with the engine.

Protected capabilities are returned with a `locked` marker naming the governing
constraint (AM-3), derived from `grantPolicy`.

### 5.2 `GET /access/who-can/:action` — AM-5

Three sources, unioned:

1. Users whose position policy allows the action, minus those whose active
   override denies it.
2. Users with an active, unexpired, unrevoked override allowing it.
3. **Every Super Admin.** `globalAccess` is derived from account type and stored
   nowhere, so a query over the policy tables alone would silently omit the
   principals who hold everything. "Who can see payroll?" would be wrong in the
   most dangerous direction.

Each row carries the user, their scope, and why (`position` / `override` /
`super-admin`).

### 5.3 Role-change decide — AM-12 and AM-8

On **approval**, in one transaction:

1. Verify the request is `pending` (422 otherwise).
2. Apply `app_user.position_id = to_position_id`.
3. **Revoke every active override for that user** (AM-8: "changing a user's
   position clears their overrides, since an override is relative to a
   position").
4. Increment `session_version` — a role change is an authority change (ID-7).
5. Write audit entries for the decision, the position change and each revoked
   override.

A1 self-approval is already blocked by the engine via `requestedBy`, and by a
`CHECK` constraint on the table. Both remain; neither is relied on alone.

---

## 6. Client

Two screens under `/company/access`, following the existing
`organization/pages` structure.

PRD Appendix A lists these as `/admin/access`. The shipped client already uses a
`/company/...` prefix for every tenant screen (`/company/organization`,
`/company/employees`), so this follows the code rather than the document. The
divergence is pre-existing and worth raising with the document owners rather
than resolving unilaterally in this module.

- **Access explorer** — two tabs. *Person*: effective policies grouped by
  module, each showing source and scope, plus subordinates and reachable
  screens. *Capability*: pick an action, see everyone who holds it and why.
- **Override panel** — grant and revoke on the same page. Controls the actor
  cannot use are disabled with the reason on hover (AM-11), driven by the same
  `grantPolicy` data the server enforces, so the UI cannot offer what the server
  will refuse.

`navigation.ts` gains an optional `requiredAction` per item; the explorer's
"screens they can reach" is the intersection of that map with the subject's
effective policy set.

---

## 7. Supporting work

- **Nightly job** in the existing BullMQ scheduler (`platform/jobs.ts`,
  alongside the geofence purge): marks overrides whose `expires_at` has passed
  and writes one audit event each. It never makes the access decision — that is
  already handled at resolution time (AM-7).
- **Audit (AM-13).** Every write in this module writes `audit_outbox` inside the
  business transaction, which the drainer chains into `audit_entry`.

---

## 8. Testing

**Unit** — the four constraints, including deliberate near-misses: equal
seniority (must fail), one scope step too wide, a target outside the actor's
boundary, a field not held by the actor, and `access:delegate` attempted by a
non-Super-Admin.

**Integration, against real PostgreSQL** (the opt-in harness added with the
audit drainer):

- The exit test: create a position → set policies → staff a user → the explorer
  reports the expected effective set.
- A Sales Team Lead cannot grant a capability they do not hold.
- Super Admin grants one named lead visibility of one supervisor's records, with
  a reason, changing no position.
- "Who can see payroll?" returns the correct list **including Super Admins**.
- An override with a 30-day expiry stops applying on day 31.
- Approving a role change clears the subject's overrides (AM-8).
- Self-approval of a role-change request is refused (A1).

---

## 9. Out of scope, with reasons

| Item | Why |
| --- | --- |
| AM-9 (override overview, 180-day ageing) | D2 — no manifest binding |
| AM-10 (30%-of-holders recommendation) | D2 — same |
| Expiry notifications | D3 — belongs to `notifications` (P7) |
| Role-change queue screen | D1 — API is built; screen follows |
| Delegation settings screen | D1 |
| Employee assignment screen | D1 |

---

## 10. Known gaps to report to the document owners

Add to the README's existing list:

> **`GET /api/access/overrides` is not in AUTHORIZATION.md §6.5.** PRD AM-9 and
> AM-10 require an organization-wide view of active overrides, which needs a
> bound route. No action in §6.4 covers it. Until one is issued, AM-9 and AM-10
> cannot be implemented without a route that fails the RM-1 boot check.

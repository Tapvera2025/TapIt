# TapCRM

A role-based operating system for a services company — Sales, Delivery and People
as one chain of custody. See `docs/PRD.md` for what it does and why.

**Status: P0 Foundation scaffold.** The platform layer is built and verified;
most of the 42 modules are not yet implemented. `npm run ci` prints exactly
what is missing.

---

## Quick start

```bash
nvm use                 # Node 24 (TECH.md §2.3)
npm install
cp .env.example .env    # fill in secrets; never commit this file

docker compose up -d    # PostgreSQL 18, Redis 8, MinIO
npm run migrate         # forward-only, as the admin role
npm run seed            # org structure + the 147-action registry projection

npm run verify          # registry drift → typecheck → lint → CI gates → tests
npm run dev:api         # http://localhost:4000
npm run dev:web         # http://localhost:5173
```

---

## How this repository is wired

The load-bearing idea, from `TECH.md` NF-21: **the action registry is the single
source of authorization truth.** Neither the server routes nor the client routes
are the source — both reference it, and drift fails the build.

```
docs/AUTHORIZATION.md §6.4, §6.5     ← authoritative: 147 actions, 292 bindings
            │
            ▼  tools/extract-registry.ts   (asserts RG-1…RG-6 at build time)
packages/contracts/src/registry.generated.ts
            │
            ├──► type Action = union of 147 literals   → a typo is a compile error
            ├──► server route bindings                 → boot fails on drift (RM-1)
            ├──► client screen metadata                → sidebar/controls only
            └──► seeds/registry.seed.json              → registry_action projection
```

`docs/AUTHORIZATION.md` is generated from the delivered PDF by
`tools/convert-authorization-pdf.py`, which asserts every total the document
states about itself (147 actions, 65 sensitive, 25 approval-bearing, 82
delegable, 38 people-domain, 101 business-domain) and refuses to write the file
if any disagree.

### Packages

| Package | Contains | May import |
| --- | --- | --- |
| `contracts` | `Action`, `Scope`, `Domain`, `Principal`, `Decimal`, error codes | nothing |
| `authz` | The authorization engine. Three public functions. | `contracts` |
| `server` | 42 modules + the platform layer | `contracts`, `authz`, `platform` |
| `client` | React 19 + Vite | `contracts` |

**Module boundary rule** (`TECH.md` §3): a module may import `contracts`, `authz`
and `platform`. It may **not** import another module's `service`, `repository` or
`policy`. Cross-module work goes through a façade, a transactional outbox event,
or a queue — chosen by the *transactional relationship*, not by preference
(§3.1).

### The three layers that must not be confused

| Question | Answers | Failure |
| --- | --- | --- |
| May this principal act? | the authorization engine | **403** — "not you" |
| Is this record eligible? | the module's state machine | **422** — "not this record, not yet" |
| Does this tenant own the row? | the DAL, backed by PostgreSQL RLS | no rows |

`NF-23b`: conflating the first two "turns every commercial policy change into a
change to the security-critical component."

---

## What is verified

Everything below was run against real PostgreSQL 18.6.

| Property | Rule | How |
| --- | --- | --- |
| Missing tenant context returns **zero rows** | TN-7 | RLS policy on `current_organization_id()` |
| Cross-tenant write is **refused** | TN-7 | `WITH CHECK` on every tenant table |
| App role cannot bypass RLS | PG-3 | `NOBYPASSRLS`, asserted in CI |
| Audit is append-only | AU-2 | `UPDATE`/`DELETE` revoked from the app role |
| Super Admin **cannot** self-approve | A1, AC-3 | SoD at step 2, before the bypass at step 4 |
| Denied list filters compile to `FALSE` | AZ-I2 | `MATCH_NOTHING`, never an empty fragment |
| Denied fields are **omitted**, not nulled | AZ-I3 | `project()` deletes keys |
| HR holds no business-domain policy | P7 | 0 rows, verified against the seed |
| `billing:set-terms` never in any position | P8, AC-4b | 0 rows, derived from `positionGrantable` |
| No branch head holds `org:view-policies` | OR-13 | declared carve-out in `seeds/matrix.ts` |
| Project Manager has `tasks:assign`, not `tasks:review` | PA-6 | declared carve-out |

Run `npm run ci` for the architectural gates and `npm test` for the engine suite.

---

## Open items

### Blocking go-live

These are deliberately **not** defaulted — `SD-2`: "Guessing a GST rate is a
statutory problem."

| ID | Blocks |
| --- | --- |
| BD-27 | `tax_rate`, `invoice_series` unseeded |
| BD-2 | organization structure roster not loaded (§17.2) |
| BD-5 | `leave_type` unseeded |
| BD-28 | financial cutover / opening balances (§17.3) |

### Questions for the document owners

1. **PRD §6 permission matrix — column count.** The header names twelve
   positions; every one of the 42 rows carries eleven values. Read as eleven
   (with "Agent / Dev" and "Employee" as one baseline column) every row agrees
   with the §6.1 prose, so that is what `seeds/matrix.ts` implements — flagged at
   the top of that file. Please confirm.

2. **`GET /api/changes` is bound to two actions** — `delivery:view` and
   `changes:classify` (AUTHORIZATION.md §6.5). §6.2 makes method+path the
   authorization key, so this is ambiguous and the boot-time router check will
   reject the second registration.

3. **Four modules have matrix cells but no registry actions** — `chat`,
   `notifications`, `live-status`, `client-portal` appear in PRD §6 with real
   scopes but have no entries in AUTHORIZATION.md §6.4, so no policy can be
   emitted for them. CI-8 reports this on every seed run.

4. **PRD §5 says "Thirty-six modules"** then totals 42. The group counts sum to
   42 and TECH.md agrees, so 42 is taken as correct.

### Not yet built

`npm run ci` reports the live numbers. At the time of writing: 4 of 291 route
bindings and 5 of 63 resource policies are implemented — the `organization`
module, built to prove the pipeline end to end. The remaining Foundation modules
(`identity`, `access-management`, `audit`, `system-administration`) are next,
per the `PRD.md` §18 sequencing: **P0 is strictly first — everything depends on
the authorization engine.**

---

## Commands

| Command | Does |
| --- | --- |
| `npm run verify` | The full chain. Run before pushing. |
| `npm run registry:extract` | Regenerate the registry from `docs/AUTHORIZATION.md` |
| `npm run registry:extract -- --check` | CI-9 drift check, no write |
| `npm run migrate` / `migrate:status` | Forward-only migrations |
| `npm run seed` | Idempotent (SD-1) |
| `npm run ci` | Architectural gates (§15) |
| `npm run ci -- --strict` | Release verification — phased gaps become blocking |
| `npm test` | Engine suite |

---

## Conventions worth knowing before the first commit

- **Money is never a `number`.** `Decimal` is a branded string; `0.1 + 0.2` is
  not `0.3` and an invoice built on that does not reconcile (PG-5, CI-21).
- **SQL is snake_case; contracts are camelCase.** The DAL maps at the boundary
  (§5.1). This matters more than it looks: AUTHORIZATION.md declares initiator
  fields in camelCase, and a raw row reaching the engine makes A1 deny every
  legitimate approval.
- **Handlers never call `authorize`.** The framework already did (API-1).
- **`globalAccess` has no storage.** It is derived from account type — "a
  boolean on a record is a boolean somebody can set" (§4.7).
- **A denied filter is `FALSE`, never `''`.** An omitted `WHERE` matches
  everything (AZ-I2).

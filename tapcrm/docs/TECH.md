# TapCRM — Technical Design

**Version** 1.5 **Status** Final engineering draft — PostgreSQL architecture; implementation-ready; go-live remains blocked only by `DECISIONS.md` BD-2, BD-5, BD-27 and BD-28

> **Next validation is a spike, not another review.** The remaining risks — recursive CTE latency under load, transaction contention on invoice numbering and audit streams, audit-writer throughput, and whether the CI architectural checks are practically enforceable — are things static documentation cannot prove. The recommended next step is an implementation spike covering **schema + DAL + authorization engine + one financial transaction path**, measured against the §18 reference dataset. **Companion to** `PRD.md`, `AUTHORIZATION.md`, `DECISIONS.md`

---

## 1. What This Document Is

`PRD.md` states what the product does. `AUTHORIZATION.md` states how an access decision is made and **contains the authoritative action registry**. This document states how both are built.

**It does not redefine anything.** Where this document and either of the other two appear to disagree, they are correct and this one has a bug. In particular:

| Concern Authoritative source              |                           |
| ----------------------------------------- | ------------------------- |
| The 147 actions and their attributes      | `AUTHORIZATION.md` §6.4   |
| The 292 API bindings                      | `AUTHORIZATION.md` §6.5   |
| Scope semantics and the decision pipeline | `AUTHORIZATION.md` §2, §3 |
| Protected constraints A1–A4, P1–P8        | `AUTHORIZATION.md` §4     |
| Business rules and module behaviour       | `PRD.md` §8–§14           |
| Unresolved business inputs                | `DECISIONS.md`            |

This document adds: the stack, the physical data model, how the registry is represented in code, the mapping from the permission matrix to executable policy, and the handful of problems in this system that are genuinely hard to build.

### 1.1 Contents

1. What this document is
2. Stack
3. Repository structure
4. Tenancy and the data access layer
5. Data model
6. The authorization engine
7. Permission matrix → executable policy
8. API layer
9. Hard problems
10. Real-time
11. Background jobs
12. File storage
13. Observability
14. Testing
15. CI gates
16. Environments and deployment
17. Seeding and migration
18. Performance engineering
19. Technical decisions

---

## 2. Stack

### 2.1 The Database Decision

**PostgreSQL is the primary datastore.** This replaces the previous MongoDB decision and is recorded as technical decision `BD-31` in this document.

The decision is specific to TapCRM's workload. The product is not only a CRM; it contains payroll, attendance, approvals, invoice numbering, payment allocation, double-entry accounting, period close, receivables, payables, statutory configuration and tenant isolation. These are constraint-heavy workflows where database-level integrity materially reduces application risk.

| Requirement | Why PostgreSQL fits |
| --- | --- |
| `LG-1` a journal that does not balance cannot be saved | A deferred constraint trigger validates debit/credit equality at transaction commit. |
| `IN-8` invoice numbering is gapless per series and financial year | A dedicated `invoice_series` row is locked with `SELECT ... FOR UPDATE` and the number allocation occurs in the same transaction as the invoice and journal. PostgreSQL sequences are **not** used for statutory invoice numbers because rolled-back sequence values are not gapless. |
| `A4` nothing posts into a closed period | The posting transaction locks the accounting-period row before checking status; the database trigger path enforces the same invariant for non-service callers. |
| `LG-7` trial balance remains balanced | Journal rows and account balances are updated atomically in one transaction, with a database constraint/trigger layer preventing invalid journal states. |
| `PY-1` / `LV-11` payroll and leave reconcile to the rupee | Multi-row, multi-table transactions provide atomic commit/rollback semantics. |
| `MT-2` / `MT-3` tenant isolation is enforced, not remembered | PostgreSQL Row-Level Security (RLS) provides a database-level backstop beneath the application authorization/DAL. |

**Scale is not the reason for the decision.** The 3-year targets in `PRD.md` are well within PostgreSQL's capability with appropriate indexing, partitioning and operational capacity. The reason is correctness and operational simplicity at the business-invariant boundary.

**One engine remains preferable to a hybrid.** Do not put finance in PostgreSQL while leaving CRM in MongoDB. That would create two transaction domains around invoice → payment → ledger, exactly where TapCRM needs atomicity. PostgreSQL is therefore the single system of record.

### 2.2 Non-Negotiable Prerequisites

| # | Prerequisite |
| --- | --- |
| PG-1 | **PostgreSQL 18.x** for production and production-shaped environments, using the latest supported minor release. At the document date, the current supported 18.x release is 18.4. Do not deploy PostgreSQL 19 beta to production. |
| PG-2 | Production uses a **managed PostgreSQL service** with automated backups, point-in-time recovery, Multi-AZ/high-availability capability and monitored failover. The provider is intentionally not hard-coded into the product architecture. |
| PG-3 | Runtime roles never have `BYPASSRLS`. Table ownership belongs to a migration/admin role, not the application role. |
| PG-4 | Every tenant-owned table has `organization_id UUID NOT NULL`, RLS enabled and RLS forced. Every foreign key crossing tenant-owned tables is tenant-safe. |
| PG-5 | Money uses `NUMERIC(p,s)` / PostgreSQL `numeric`, never JavaScript `number` for authoritative monetary values. API responses use string-encoded decimals plus currency code. |
| PG-6 | All application SQL is executed through the DAL/query layer. Raw SQL is allowed where it is the correct tool, but it must still carry explicit tenant context and pass CI checks. |

### 2.3 The Rest of the Stack

| Layer | Choice | Note |
| --- | --- | --- |
| Runtime | Node.js 24 LTS, TypeScript strict | Types are load-bearing: `Action`, `Scope` and `Domain` are compiler-checked unions. |
| API | Express 5 with typed route wrapper | Raw `app.get()`/`app.post()` is not used for product routes. |
| Database | PostgreSQL 18.x | Primary system of record. RLS, foreign keys, checks, deferred constraints and transactions are first-class integrity mechanisms. |
| Query layer | `pg` + Kysely | Typed query construction without hiding SQL. Complex CTEs, locking and PostgreSQL-specific features remain accessible. |
| Migrations | Versioned SQL migrations | Forward-only, reviewed, recorded in `schema_migrations`; no model auto-sync. |
| Connection pooling | `pg.Pool` with bounded pool size | Production pool sizing is based on DB connection budget; do not equate HTTP concurrency with database connections. |
| Cache / pub-sub | Redis | Session versions, permission sets, socket fan-out and queue backing. |
| Real-time | Socket.IO with Redis adapter | §10. |
| Jobs | BullMQ on Redis | Idempotent, with run records. §11. |
| Files | S3-compatible object storage + CDN | Signed URLs only. §12. |
| Frontend | React 19, TypeScript, Vite | Route metadata generated from the registry. §8.4. |
| Auth | JWT access + rotating refresh, Argon2id | Per PRD authentication requirements. |
| Search | PostgreSQL full-text search initially | `tsvector` + GIN indexes for scoped search; introduce a dedicated search tier only when measured budgets require it. |
| PDF | Server-side renderer for invoices, payslips and reports | Issued artifacts are deterministic from immutable source data and stored write-once. |
| Observability | Structured logs, metrics, traces | §13. |

### 2.4 Principles That Constrain Implementation

| # | Principle |
| --- | --- |
| T-1 | **Fail closed.** Unknown action, unresolved constraint, missing tenant context or ambiguous scope — all deny. |
| T-2 | **The database is the last line, not the only line.** Application authorization is still required; PostgreSQL constraints and RLS ensure a defect cannot silently corrupt or cross tenant boundaries. |
| T-3 | **No tenant query without tenant context.** The DAL sets transaction-local tenant context and RLS independently enforces it. |
| T-4 | **Immutable means no update path.** Financial/audit records that become immutable are protected by database privileges and triggers/constraints, not merely handler discipline. |
| T-5 | **Derived values are derived.** Health, progress, aging, capacity, profitability and KPIs are computed or transactionally materialized, never authored by users. |
| T-6 | **One implementation per capability.** Two code paths answering the same question will eventually answer it differently. |
| T-7 | **SQL is not forbidden. Unsafe SQL is forbidden.** PostgreSQL-specific SQL is an approved implementation tool at the DAL boundary; application modules never build arbitrary SQL strings from user input. |

## 3. Repository Structure

A modular monolith. Not microservices: the authorization engine is called on every request by every module, and putting a network boundary in front of it would be the single worst decision available.

```
/packages
  /contracts        Shared types. Action union, Scope union, Domain union,
                    DTOs, error codes. Imported by server and client.
  /authz            The authorization engine. No module imports another
                    module's internals; everything imports this.
  /server
    /modules
      /<module>     One directory per module in PRD §5 — 42 of them.
        routes.ts       Binding declarations only (§8.2)
        service.ts      Business logic
        policy.ts       ResourcePolicy implementation
        state.ts        State machine, where the module owns one
        repository.ts   Data access, via the DAL only
        jobs.ts         Scheduled work
        events.ts       Emitted domain events
    /platform
      /dal          Data access layer, tenancy injection (§4.2)
      /audit        Both audit streams, hash chaining (§9.5)
      /notify       Notification dispatch with authorization-aware audience
      /files        Storage and signing
      /jobs         Queue, scheduling, run records
      /realtime     Socket server, room derivation
  /client
    /modules        Mirrors the server module list
    /platform       Router, permission context, API client
/migrations         Versioned migration scripts, forward-only
/seeds              Org structure, chart of accounts, leave types, actions
/tools              Registry codegen, CI checks (§15)

```

**Module boundary rule.** A module may import `contracts`, `authz` and `platform`. It may **not** import another module's `service`, `repository` or `policy`. The 42 modules are the seams; treating them as suggestions is how scattered permission logic comes to exist.

### 3.1 Choosing the Cross-Module Mechanism

Three mechanisms, and the choice is determined by the **transactional relationship**, not by preference. Making events the default is a common mistake that turns a transactional invariant into an eventual-consistency bug.

| Mechanism Use when Example     |                                                                                        |                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Synchronous façade**         | **A cannot complete without B.** They share a transaction and must commit together.    | Issuing an invoice must post its journal. If the journal fails, the invoice must not exist. |
| **Transactional outbox event** | **A commits independently; B reacts afterward.** A's correctness does not depend on B. | Invoice issued → notify the client, emit a socket event, update a dashboard rollup.         |
| **Queue**                      | Work is **slow, retryable, or calls an external system**.                              | e-Invoicing IRN submission, PDF generation, payroll runs, dunning email.                    |

| # Rule  |                                                                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MB-1    | A façade is a **narrow, explicitly exported** interface — `LedgerFacade.post(tx, entry)` — that takes the caller's transaction session. It is not a licence to reach into the other module.                        |
| MB-2    | A façade call **participates in the caller's transaction**. That is the whole reason it exists rather than an event.                                                                                               |
| MB-3    | **Never use an event where a façade is required.** "Invoice issued → someone will post the journal shortly" means a window in which the books do not balance. If the two must be atomic, they share a transaction. |
| MB-4    | **Never use a façade where a queue is required.** TX-2 forbids I/O inside a transaction; an external call must be an outbox row drained afterwards.                                                                |
| MB-5    | Every façade is listed in the owning module's public surface and its callers are known. A façade with many unrelated callers is a signal the boundary is in the wrong place.                                       |

Façades that exist by design: `LedgerFacade` (invoice, payment, payroll, payables → accounting), `AuditFacade` (every module → audit outbox), `NotificationFacade` (audience resolution through the authorization engine).

---

## 4. Tenancy and the Data Access Layer

`PRD.md` §17.1 MT-1 to MT-6 are requirements for this release. PostgreSQL RLS is the database backstop; the DAL remains the primary application boundary.

### 4.1 Every Tenant-Owned Table Carries `organization_id`

| # | Rule |
| --- | --- |
| TN-1 | Every tenant-owned table has `organization_id UUID NOT NULL` from the first migration. |
| TN-2 | Every tenant-owned table has RLS enabled and forced. No runtime application role has `BYPASSRLS`. |
| TN-3 | Genuinely global reference data — country codes, currency codes and similar immutable reference data — lives in explicitly global tables. Adding a new global table requires review. |
| TN-4 | Tenant-owned parent tables expose a composite unique key `(organization_id, id)` where needed so child foreign keys can enforce same-tenant relationships. |

### 4.2 The Data Access Layer

No module imports a database driver pool directly. All access goes through the DAL, which takes the request context and establishes database tenant context.

```ts
interface Db {
  query<T>(ctx: RequestContext, sql: SqlFragment): Promise<T[]>;
  one<T>(ctx: RequestContext, sql: SqlFragment): Promise<T>;
  maybeOne<T>(ctx: RequestContext, sql: SqlFragment): Promise<T | null>;
  transaction<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T>;
}

interface Tx {
  query<T>(sql: SqlFragment): Promise<T[]>;
  one<T>(sql: SqlFragment): Promise<T>;
  maybeOne<T>(sql: SqlFragment): Promise<T | null>;
}
```

| # | Rule |
| --- | --- |
| TN-5 | A `RequestContext` carries `organizationId`, principal and request id. It cannot be constructed without an organization for tenant-bound work. |
| TN-6 | Every tenant-bound database unit of work starts with a transaction-local setting such as `SELECT set_config('app.organization_id', $1, true)`. The setting is never persisted on a pooled connection. |
| TN-7 | Every tenant-owned table has an RLS policy using `current_setting('app.organization_id', true)`. Missing tenant context therefore matches no rows and fails closed. `WITH CHECK` prevents inserts/updates into another tenant. |
| TN-8 | The DAL still emits explicit `organization_id` predicates in important queries. RLS is the backstop, not an excuse to fetch broadly and let the database filter everything. |
| TN-9 | Background jobs construct a context **per organization**. A job iterating organizations does so explicitly; it never runs with an absent tenant context. |
| TN-10 | Service accounts carry `organizationId` on the credential, applied before any user-supplied `recordFilter` (`PRD.md` SV-2b). |

### 4.2.1 Database RLS Pattern

Representative table:

```sql
ALTER TABLE lead ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead FORCE ROW LEVEL SECURITY;

CREATE POLICY lead_tenant_isolation
ON lead
USING (
  organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
)
WITH CHECK (
  organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
);
```

The application role cannot disable this policy. Migration/admin roles are separate and are never used by the request path.

### 4.2.2 Three Data Access Surfaces

| DAL | Scope | Who may use it |
| --- | --- | --- |
| `db` — tenant | Sets tenant context and requires tenant-scoped work. | Every product module. |
| `globalDb` — global | Accesses allow-listed global reference tables. | Reference-data code only. |
| `platformDb` — privileged | Explicitly allow-listed cross-tenant operations. | Platform administration, retention, seeding and controlled operational tooling. |

### 4.3 What Compensates for the Remaining Application Risk

RLS removes the most dangerous PostgreSQL-era failure mode — a missing tenant filter becoming a cross-customer read/write. It does **not** make authorization complete.

| Threat | Defended? | Mechanism |
| --- | --- | --- |
| Developer forgets `organization_id` | Yes | DAL + RLS + CI. |
| Query bypasses DAL | Partially | RLS still protects tenant-owned tables; CI-16 remains a release gate. |
| Wrong object-level authorization | No | Authorization engine/resource policy tests. |
| Compromised application process using the app DB role | Partially | RLS prevents cross-tenant access; business-level authorization can still be bypassed by trusted DB access. |
| Migration/admin credential compromised | No | Separate credentials, least privilege, managed secret store, audit and operational controls. |

### 4.4 Immutability With Database Privileges

For append-only data, the runtime application role has `SELECT` and `INSERT` but no `UPDATE` or `DELETE`. The migration/admin role owns the table.

```sql
REVOKE UPDATE, DELETE ON audit_activity FROM tapcrm_app;
REVOKE UPDATE, DELETE ON journal_entry FROM tapcrm_app;
```

State-transition records such as issued invoices may require controlled updates before they become immutable. That transition is enforced through an explicit service path plus a database trigger/constraint that rejects illegal post-issue mutations.

**Important:** RLS is not an authorization replacement. A user can be authorized to see a project but not necessarily its commercials, and RLS cannot express TapCRM's full business policy. The authorization engine remains the sole business authorization decision point.

## 5. Data Model

Schemas live in `/server/platform/dal`. PostgreSQL is the system of record. Tables use snake_case in SQL; TypeScript contracts use the product's existing camelCase naming.

### 5.1 Conventions

| Convention | Rule |
| --- | --- |
| Keys | `uuid` primary keys. PostgreSQL 18's `uuidv7()` is preferred for new identifiers because it provides UUID semantics with time-ordered locality. IDs are identifiers, never business timestamps. |
| Timestamps | `timestamptz`, stored in UTC. Local timezone is display/business-policy data only (`PRD.md` NF-15). |
| Money | `numeric(p,s)` with explicit currency code. Never JavaScript `number` for authoritative money. |
| Soft delete | Does not exist for business records. Lifecycle state is explicit; immutable financial/audit records are never deleted by application code. |
| Enums | Text plus `CHECK` constraints rather than PostgreSQL enum types for business states. This keeps additive state changes migration-friendly. |
| Validation | Application validation first; PostgreSQL `NOT NULL`, `CHECK`, `UNIQUE`, `FOREIGN KEY`, triggers and RLS are the database backstop. |
| Flexible fields | `jsonb` is allowed for genuinely flexible payloads such as custom fields, before/after audit snapshots and provider metadata. Core relational facts remain typed columns. |
| Naming | SQL uses `snake_case`; API contracts remain camelCase. The query layer performs the mapping. |

### 5.2 Relational Modelling Rules

The previous MongoDB embed/reference decision is replaced by normal relational modelling:

> **Use a separate table when a child has independent lifecycle, querying, authorization or unbounded growth. Use a JSONB column only for bounded, schema-flexible data that is always owned by its parent.**

| Table/shape | Decision |
| --- | --- |
| `journal_entry` + `journal_line` | Separate tables. Journal lines are independently indexed and validated by a deferred constraint trigger. |
| `invoice` + `invoice_line` | Separate tables. Lines have their own foreign key and ordering. |
| `receipt` + `receipt_allocation` | Separate tables because allocations participate in reconciliation queries. |
| `attendance_record` + `attendance_event` | Separate tables. Events are append-heavy and independently queried for device reconciliation. |
| `deal.commercials` | `jsonb` only for genuinely flexible commercial metadata; security-sensitive commercial fields that have business semantics are typed columns. |
| `audit_* before/after` | `jsonb` snapshots; actor, target, action, sequence and timestamps are typed columns. |
| `account_balance` | Maintained aggregate table, updated in the same transaction as the journal. It is derived data and never manually authored. |

### 5.3 Tables

| Group | Tables |
| --- | --- |
| Identity | `organization`, `app_user`, `session`, `refresh_token`, `mfa_enrollment`, `service_account`, `geofence_location`, `geofence_event` |
| Org | `department`, `team`, `position`, `position_policy`, `user_override`, `designation`, `role_change_request`, `registry_action` |
| People | `employee_profile`, `onboarding_workflow`, `user_status`, `attendance_record`, `attendance_correction`, `attendance_event`, `break_policy`, `break_breach`, `shift`, `shift_assignment`, `shift_request`, `biometric_device`, `biometric_punch`, `leave_type`, `leave_request`, `leave_balance`, `holiday`, `payroll_run`, `payslip`, `salary_structure`, `payroll_config`, `performance_record` |
| Sales | `territory`, `routing_rule`, `lead`, `lead_source`, `lead_activity`, `callback`, `handover`, `deal`, `deal_approval`, `proposal`, `contract` |
| Delivery | `project_brief`, `project`, `milestone`, `task`, `task_time_entry`, `delivery`, `change_request`, `allocation` |
| Client | `client`, `client_contact`, `client_request`, `account_ownership`, `renewal_opportunity` |
| Finance | `billing_terms`, `rate_card`, `invoice`, `invoice_series`, `invoice_line`, `credit_note`, `recurring_schedule`, `receipt`, `receipt_allocation`, `refund`, `bank_reconciliation`, `vendor`, `vendor_bill`, `expense_claim`, `payment_run`, `ledger_account`, `journal_entry`, `journal_line`, `account_balance`, `accounting_period`, `tax_rate` |
| Cross-cutting | `conversation`, `message`, `row`, `notification`, `notification_delivery`, `notice`, `notepad`, `todo`, `sheet`, `audit_access`, `audit_activity`, `audit_outbox`, `domain_outbox` |

### 5.4 Two Shapes That Are Easy to Get Wrong

**`deal` carries two ownership/attribution fields:** `originating_agent_id` and `closed_by`. Visibility is the union of both authorization chains (`PRD.md` DL-12a). Do not collapse them into a generic `owner_id`.

**`task` has no duplicated project-manager field.** Project Manager authority resolves through `project.project_manager_id` using a correlated subquery or join. For large portfolios, the query is indexed on `(organization_id, project_manager_id)` and the authorization test is load-tested rather than denormalised prematurely.

### 5.5 Indexing

Indexes are explicit migration artifacts. Every tenant-scoped query pattern has an index whose leading columns support tenant filtering and the actual predicate/sort.

```sql
-- Identity / org
CREATE UNIQUE INDEX ux_user_org_email ON app_user (organization_id, email);
CREATE INDEX ix_user_org_department ON app_user (organization_id, department_id);
CREATE INDEX ix_user_org_team ON app_user (organization_id, team_id);
CREATE INDEX ix_user_org_reports_to ON app_user (organization_id, reports_to);

CREATE UNIQUE INDEX ux_position_org_code ON position (organization_id, code);
CREATE UNIQUE INDEX ux_position_policy ON position_policy (organization_id, position_id, action);
CREATE UNIQUE INDEX ux_user_override ON user_override (organization_id, user_id, action);

-- Sales
CREATE INDEX ix_lead_scope ON lead (organization_id, assigned_to, status, created_at DESC);
CREATE INDEX ix_lead_phone ON lead (organization_id, phone);
CREATE INDEX ix_lead_email ON lead (organization_id, email);
CREATE INDEX ix_callback_queue ON callback (organization_id, assigned_to, callback_at);
CREATE INDEX ix_deal_originating ON deal (organization_id, originating_agent_id);
CREATE INDEX ix_deal_closed_by ON deal (organization_id, closed_by);
CREATE INDEX ix_deal_client ON deal (organization_id, client_id);
CREATE INDEX ix_deal_status ON deal (organization_id, lifecycle_status, closed_at DESC);

-- Delivery
CREATE INDEX ix_project_manager ON project (organization_id, project_manager_id, status);
CREATE INDEX ix_project_client ON project (organization_id, client_id);
CREATE INDEX ix_task_assignee ON task (organization_id, assigned_to, status);
CREATE INDEX ix_task_project ON task (organization_id, project_id, status);
CREATE INDEX ix_task_due ON task (organization_id, due_date);

-- People
CREATE UNIQUE INDEX ux_attendance_day ON attendance_record (organization_id, user_id, work_date);
CREATE INDEX ix_attendance_date ON attendance_record (organization_id, work_date);

-- Finance
CREATE UNIQUE INDEX ux_invoice_number ON invoice (organization_id, series_id, number);
CREATE INDEX ix_invoice_client_status ON invoice (organization_id, client_id, status);
CREATE INDEX ix_invoice_due ON invoice (organization_id, due_date);
CREATE UNIQUE INDEX ux_invoice_series ON invoice_series (organization_id, code, financial_year);
CREATE INDEX ix_journal_period ON journal_entry (organization_id, period_id, posted_at DESC);
CREATE INDEX ix_journal_line_account ON journal_line (organization_id, account_id, posted_at DESC);
CREATE UNIQUE INDEX ux_account_balance ON account_balance (organization_id, account_id, period_id);
CREATE UNIQUE INDEX ux_accounting_period ON accounting_period (organization_id, financial_year, month);
```

| # | Rule |
| --- | --- |
| IX-1 | Tenant-scoped indexes lead with `organization_id` unless a PostgreSQL-specific query plan demonstrates a better equivalent. |
| IX-2 | Every tenant-scoped unique constraint includes `organization_id`, unless the business requirement explicitly says the value is globally unique. |
| IX-3 | Indexes are created only through versioned migrations. No ORM auto-sync. |
| IX-4 | Every new query pattern adds or reuses an appropriate index in the same change. CI runs `EXPLAIN (ANALYZE, BUFFERS)` against representative queries. |
| IX-5 | Partial indexes are preferred where status predicates make them substantially smaller and the predicate is stable. |

### 5.6 Audit Storage and Partitioning

`audit_access` and `audit_activity` are append-only PostgreSQL tables. At the 3-year target, they are **range-partitioned monthly by `occurred_at`**. Partitioning is limited to high-growth append-heavy tables; normal business tables are not partitioned without measured need.

```sql
CREATE TABLE audit_activity (
  organization_id uuid NOT NULL,
  stream text NOT NULL CHECK (stream IN ('access', 'activity')),
  sequence bigint NOT NULL,
  occurred_at timestamptz NOT NULL,
  actor_id uuid,
  actor_type text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  before_data jsonb,
  after_data jsonb,
  reason text,
  source_ip inet,
  request_id uuid,
  hash_version smallint NOT NULL,
  prev_hash bytea,
  hash bytea NOT NULL,
  PRIMARY KEY (organization_id, stream, sequence, occurred_at)
) PARTITION BY RANGE (occurred_at);
```

Because PostgreSQL requires a partition key to participate in a partitioned table's global unique/primary-key constraint, **global sequence uniqueness is enforced by the unpartitioned `audit_stream_state` row and the single writer transaction**, not by pretending a partition-local unique index is global. This is an intentional design choice.

The `audit_stream_state` table holds `(organization_id, stream, next_sequence, last_hash)`. The writer locks that row with `FOR UPDATE`, allocates the next sequence and inserts the audit row in the same transaction. This makes the chain globally ordered across partitions.

Older partitions are archived to WORM object storage with a manifest and hash anchor before removal, preserving end-to-end verification.

## 6. The Authorization Engine

`AUTHORIZATION.md` defines the model. This is how it is built.

### 6.1 Representing the Registry

The registry in `AUTHORIZATION.md` §6.4 is the source of truth. It is **not** retyped by hand into code — it is the input to a code generator.

```
AUTHORIZATION.md §6.4  ──┐
AUTHORIZATION.md §6.5  ──┼──► tools/extract-registry.ts ──► registry.generated.ts
                                                       └──► registry.seed.ts

```

| # Rule  |                                                                                                                                                                                                                                                                                                                                                     |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RG-I1   | `tools/extract-registry.ts` parses the markdown tables into a typed structure. The generated file is committed, and CI regenerates and diffs it. A drift between the row and the code fails the build.                                                                                                                                         |
| RG-I2   | The generated file exports `type Action = 'leads:view' \| ...` — a union of 147 literals. Every function that takes an action takes this type. A typo is a compile error, not a runtime deny.                                                                                                                                                       |
| RG-I3   | Registry rows are also seeded into the `registry_action` table via parameterized `INSERT ... ON CONFLICT DO UPDATE` statements, so Access Management can render descriptions and grantability without shipping the markdown to the client. The table is regenerated on deploy; it is a **projection, never edited**, and a row absent from the generated set is removed. |
| RG-I4   | Invariants RG-1 to RG-6 are asserted by the extractor at build time, not at runtime. An invalid registry cannot be compiled.                                                                                                                                                                                                                        |

```
// registry.generated.ts — shape, not content
export interface ActionDefinition {
  action: Action;
  module: ModuleName;
  resource: ResourceType | null;
  domain: 'people' | 'business' | 'derived';
  sensitive: boolean;
  approvalBearing: boolean;
  initiatorField: string | null;
  grantPolicy: {
    positionGrantable: boolean;
    delegationAllowed: boolean;
    superAdminOnly: boolean;
  };
}
export const REGISTRY: Readonly<Record<Action, ActionDefinition>>;

```

### 6.2 The Engine's Public Surface

Three functions. Everything else is internal.

```
// Single record. Throws AuthorizationError, never returns a boolean the
// caller might forget to check.
authorize(ctx: RequestContext, action: Action, resource?: Resource): Promise<void>;

// List queries. Returns a filter, never an unbounded one.
visibilityFilter<T>(ctx: RequestContext, action: Action): Promise<QueryFilter<T>>;

// Serialization. Removes fields the caller may not see.
project<T>(ctx: RequestContext, action: Action, record: T): Partial<T>;

```

| # Rule  |                                                                                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AZ-I1   | `authorize` throws on denial. A function returning `boolean` invites `if (can(...))` with a forgotten negation; a throwing function fails safe when a developer forgets to handle it.                                    |
| AZ-I2   | `visibilityFilter` returns `MATCH_NOTHING` — a fragment that provably matches no row, such as `false` — on denial. It never returns an empty fragment.                                                                   |
| AZ-I3   | `project` **deletes** denied keys from the object. It does not set them to null (`AUTHORIZATION.md` principle 8).                                                                                                        |
| AZ-I4   | Serialization happens once, at the response boundary, and every response passes through it. A handler that assembles JSON by hand bypasses field policy, so handlers return domain objects and the framework serializes. |

### 6.3 The Pipeline in Code

Implementing `AUTHORIZATION.md` §3 in its exact order. The order is the specification; reordering for efficiency is a correctness bug.

```
async function authorize(ctx, action, resource?) {
  // 1. Authentication and account state — middleware, before this call
  //    (session version compared, account active)

  // 2. Segregation of duties — BEFORE any privilege
  await sod.assert(ctx.principal, action, resource);

  // 3. Absolute constraints — A1..A4, also before privilege
  await absolute.assert(ctx, action, resource);

  // 4. Super Admin bypass — globalAccess is DERIVED, never read from storage
  if (ctx.principal.accountType === 'super-admin') {
    audit.bypass(ctx, action, resource);
    return;
  }

  // 5. Privileged constraints — P1..P8
  await privileged.assert(ctx, action, resource);

  // 6. Policy resolution — position policy merged with unexpired overrides
  const policy = await policies.resolve(ctx, action);
  if (!policy?.allowed) throw new AuthorizationError(action, 'no_policy');

  // 7. Scope — delegated to the resource policy
  if (resource) {
    const ok = await registry.policyFor(resource.type)
                             .check(ctx.principal, action, resource, policy.scope);
    if (!ok) throw new AuthorizationError(action, 'out_of_scope');
  }

  // 8. Constraints declared on the policy itself
  await constraints.assert(policy, ctx, resource);

  // 9. Audit — sensitive actions on use, not only on grant
  if (REGISTRY[action].sensitive) audit.sensitiveUse(ctx, action, resource);
}

```

**`globalAccess`** **has no storage and no lookup.**

```
const globalAccess = (p: Principal) => p.accountType === 'super-admin';

```

There is no column, no policy row, no override row and no code path that reads it from anywhere. This is enforced by a CI check that greps for any assignment to a `globalAccess` field (§15).

### 6.4 Policy Resolution and Caching

```
async function resolve(ctx, action): Promise<PermissionPolicy | null> {
  const set = await permissionSet(ctx);      // request-scoped, then Redis
  return set.policies[action] ?? null;
}

```

The resolved permission set is computed once and cached at two levels.

| Level Lifetime Invalidated by  |                                     |                                                                                                              |
| ------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Request                        | The request                         | —                                                                                                            |
| Redis                          | Session, bounded by `cacheDeadline` | `permissions:changed` event; position policy edit; override grant, revoke or expiry; team or position change |

| # Rule  |                                                                                                                                                                                                                              |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AZ-I5   | **`cacheDeadline`** **= the earliest** **`expires_at`** **among the principal's unexpired overrides**, or the session expiry if there are none. A cached set can never outlive an override expiry (`AUTHORIZATION.md` OV-3). |
| AZ-I6   | Override expiry is evaluated **at resolution time**: rows with `expires_at <= now()` are excluded by the query. The nightly job only marks, notifies and audits (OV-1, OV-2).                                                |
| AZ-I7   | Editing a position's policies invalidates every holder's cache and emits `permissions:changed` to each connected holder.                                                                                                     |

### 6.5 Scope Resolution

The expensive part. Computed once per request and memoised on the context.

```ts
interface ScopeResolver {
  subordinateIds(p: Principal): Promise<Set<UserId>>;
  teamIds(p: Principal): Promise<Set<TeamId>>;
  poolIds(p: Principal): Promise<Set<TeamId>>;
  departmentId(p: Principal): Promise<DepartmentId>;
  participantMatch(p: Principal, policy: PermissionPolicy,
                   action: Action): Promise<SqlFragment>;
}
```

**Transitive closure uses PostgreSQL recursive CTEs.** The hierarchy depth is bounded to the organization's configured maximum (five levels in the current PRD model), so a recursive query is preferable to maintaining a potentially stale authorization cache.

```sql
WITH RECURSIVE subordinates AS (
  SELECT id
  FROM app_user
  WHERE organization_id = $1
    AND id = $2
    AND status = 'active'

  UNION ALL

  SELECT u.id
  FROM app_user u
  JOIN subordinates s ON u.reports_to = s.id
  WHERE u.organization_id = $1
    AND u.status = 'active'
)
SELECT id FROM subordinates;
```

For team descendants, recursion starts from the principal's own team and descends only through `parent_team_id`. It never ascends to a parent and then descends through a sibling branch; this is the protected constraint P6.

| Approach | When |
| --- | --- |
| Recursive CTE per request | **Default.** Always current. Target: under 5 ms p95 on the reference dataset, measured rather than assumed. |
| Materialised closure table | Only if §18 budgets fail. Maintain synchronously in the same transaction as hierarchy changes and verify nightly. |

Start with the CTE. Do not pre-optimise a security-critical path into a cache that can be wrong.

### 6.6 Resource Policies

One per resource type, registered at boot.

```ts
interface ResourcePolicy<T> {
  resourceType: ResourceType;
  domain: Domain | ((r: T) => Domain);

  check(p: Principal, a: Action, r: T, s: Scope): Promise<boolean>;
  filter(p: Principal, a: Action, s: Scope): Promise<SqlFragment>;

  participantFields(a: Action): string[];
  initiatorField(a: Action): string | null;
}
```

`SqlFragment` is a server-only type produced by the DAL/query layer. It is never exported to the browser. Kysely parameterises values; user input is never concatenated into SQL.

| # | Rule |
| --- | --- |
| AZ-I6b | Boot-time completeness check. Every `resource` named in the registry must have a registered policy. Missing policy is a startup failure. |
| AZ-I7b | `filter` and `check` must agree. A property test per resource policy generates representative records and asserts that every filtered record passes the object check and every permitted record is represented by the filter. |

**Example — `TaskPolicy`:**

```ts
async filter(p: Principal, action: Action, scope: Scope): Promise<SqlFragment> {
  switch (scope) {
    case 'department':
      return sql`task.department_id = ${p.departmentId}`;
    case 'team':
      return sql`task.sub_team_id = ANY(${sql.val(await teamIds(p))}::uuid[])`;
    case 'pool':
      return sql`task.assigned_to = ANY(${sql.val(await poolMembers(p))}::uuid[])`;
    case 'own':
      return sql`(
        task.assigned_to = ${p.id}
        OR task.assigned_by = ${p.id}
        OR EXISTS (
          SELECT 1
          FROM project
          WHERE project.id = task.project_id
            AND project.organization_id = ${p.organizationId}
            AND project.project_manager_id = ${p.id}
        )
      )`;
    default:
      return MATCH_NOTHING;
  }
}
```

`MATCH_NOTHING` must compile to a predicate that is provably false, such as `FALSE`. **Never** use an empty filter as the deny representation. In SQL, an omitted `WHERE` clause means "match everything", which is the most dangerous possible failure mode.

### 6.7 Constraints

Declarative registration, never inline in a handler (`AUTHORIZATION.md` §4.4).

```
registerConstraint({
  id: 'P2',
  kind: 'privileged',
  appliesTo: ['payroll:view'],
  evaluate: (p, action, resource) =>
    hasPolicy(p, 'payroll:manage') || resource.subjectId === p.id
      ? PASS
      : DENY('P2: payslips are readable by their subject and payroll only'),
});

```

| # Rule  |                                                                                                                                                                                          |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AZ-I8   | Constraints A1–A4 register as `absolute` and run at step 3. P1–P8 register as `privileged` and run at step 5. The `kind` decides the step; nothing else does.                            |
| AZ-I9   | A constraint that throws is a **deny**, logged as a defect. A constraint engine that fails open is not a constraint engine.                                                              |
| AZ-I10  | Adding a protected constraint means adding a registry entry and a test. There is no handler-level alternative, and a code review that finds constraint logic in a controller rejects it. |

### 6.8 Segregation of Duties

```
async function assertSod(p, action, resource) {
  const def = REGISTRY[action];
  if (!def.approvalBearing) return;               // not an approval action
  if (!def.initiatorField) throw new ConfigError(action);  // build-time caught
  const initiator = get(resource, def.initiatorField);
  if (initiator === undefined) throw new AuthorizationError(action, 'sod_unresolved');
  if (initiator === p.id) throw new AuthorizationError(action, 'sod_self');
}

```

| # Rule  |                                                                                                                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AZ-I11  | An `approvalBearing` action with a null `initiatorField` fails the build (GP-5), so the `ConfigError` above is unreachable in a shipped build and exists to make that explicit.              |
| AZ-I12  | A declared field **missing from the record** denies (`AUTHORIZATION.md` SD-B). A segregation control that silently passes when the schema drifts is worse than none, because it is believed. |
| AZ-I13  | This runs at step 2, **before** the Super Admin bypass. Super Admin is refused here like everyone else. A test asserts it for every approval-bearing action.                                 |

---

## 7. Permission Matrix → Executable Policy

**Required by** **`PRD.md`** **NF-22b.** The matrix in `PRD.md` §6 is a human-readable summary. This section is the mechanical translation, so that no implementer has to infer what a cell means.

### 7.1 Cell Grammar

A cell is one of:

```
glob | acct | — | <scope> | <scope>*

```

| Cell Translates to  |                                                                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `glob`              | **No policy rows.** Held by `accountType = 'super-admin'` (§6.3). Nothing is written to `position_policy`.                                                                                   |
| `acct`              | **No policy rows for a position.** Client isolation is absolute constraint A2, applied at step 3 before policy resolution. Client principals hold a fixed client policy set, not a position. |
| `—`                 | No rows for that module's actions. Absent means denied.                                                                                                                                      |
| `<scope>`           | For **every** action of that module: a `position_policy` row with `allowed = true, scope = <scope>`.                                                                                         |
| `<scope>*`          | For the module's **`:view`** **action only**: `allowed = true, scope = <scope>`. No rows for any write action.                                                                               |

### 7.2 The `*` Modifier, Precisely

`dept*` on `projects` for the Sales Head means exactly:

```
INSERT INTO position_policy (position_id, action, allowed, scope)
VALUES (:salesHead, 'projects:view', true, 'department');
-- and NOTHING for projects:manage or projects:view-financials

```

Read-only is the **absence of write policy rows**, not a flag on a row. This is why it cannot be bypassed by a handler that forgets a check: there is no capability to check.

### 7.3 Module → Actions Expansion

`<scope>` on a module expands to all of that module's actions in the registry. The generator reads `REGISTRY[action].module` and groups. Two carve-outs, both declared explicitly in the seed rather than inferred:

| Carve-out Reason                                                                                                   |                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `billing-terms` at any scope never includes `billing:set-terms`                                                    | `positionGrantable = false` (P8). The seed asserts it and fails if a matrix cell would produce it.                                 |
| Any module cell never includes an action with `superAdminOnly = true` unless the position is seeded by Super Admin | The seed emits these separately with an explicit comment, so a reviewer can see every Super-Admin-granted capability in one place. |

### 7.4 Worked Examples

| Position Matrix cell Emitted rows             |                     |                                                                                                                                                                   |
| --------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sales Head, `leads` = `dept`                  | all lead actions    | `leads:view/create/edit/reassign` → `department`                                                                                                                  |
| Sales Head, `projects` = `—`                  | none                | *(no rows)*                                                                                                                                                       |
| Project Manager, `tasks` = `own`              | all task actions    | `tasks:view/assign/update/manage-dependencies/log-time` → `own`. **Not** `tasks:review` — see below.                                                              |
| Project Manager, `resource-planning` = `own*` | view only           | `resources:view` → `own`. No `resources:allocate`.                                                                                                                |
| Project Manager, `deals` = `part*`            | view only           | `deals:view` → `participant`. No `deals:view-commercials`, no write.                                                                                              |
| HR, `payroll` = `all-ppl`                     | all payroll actions | `payroll:view/manage/manage-config` → `all-people`, **plus** the mandatory field policy on `payslip` (MF-4), which is not a policy row but a resource-level rule. |
| Sub-team Manager, `delivery` = `team*`        | view only           | `delivery:view` → `team`. No `delivery:approve`, no `changes:classify`.                                                                                           |

**`tasks:review`** **for a Project Manager.** The matrix says `tasks` = `own`, and a naïve expansion would grant `tasks:review`. It must not (PA-6). This is the third carve-out and it is declared in the seed with the rule id as a comment:

```
EXCLUDE.set('project-manager', ['tasks:review']);  // PRD PA-6

```

| # Rule  |                                                                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MX-1    | Every carve-out is **declared data**, not a condition in the generator. A reader can list every exception in one place.                                                   |
| MX-2    | A CI check asserts every matrix cell produces at least one policy row unless the cell is `—`, `glob` or `acct`. A cell that silently produces nothing is a typo.          |
| MX-3    | A CI check asserts the emitted rows for every position reconcile back to the matrix (RM-16). The matrix is generated from the seed in CI and diffed against the row. |

---

## 8. API Layer

### 8.1 Conventions

| Concern Rule  |                                                                                                                                                                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base          | `/api`, **initially versionless**. Compatibility is maintained through additive change and an explicit breaking-change policy (API-6). A version prefix is introduced if and when a breaking contract change becomes unavoidable — the absence of one is a compatibility commitment, not an assumption about deployment topology. |
| Response      | `{ success, data, meta?, message? }`                                                                                                                                                                                                                                                                                              |
| Error         | `{ success: false, code, message, details? }`                                                                                                                                                                                                                                                                                     |
| Pagination    | `page`, `limit`, `sort`. Default 50, maximum 200. Cursor pagination on `audit_*` and `message`.                                                                                                                                                                                                                                   |
| Times         | ISO 8601 UTC on the wire. Display conversion is client-side.                                                                                                                                                                                                                                                                      |
| Money         | String-encoded decimal plus a currency code. Never a JSON number.                                                                                                                                                                                                                                                                 |
| Mutations     | Return the updated resource, so the client needs no follow-up read.                                                                                                                                                                                                                                                               |

### 8.2 Status Codes — the Distinction That Matters

| Code Meaning  |                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| 400           | Malformed request                                                                                     |
| 401           | Unauthenticated                                                                                       |
| 403           | **Authenticated, not permitted.** "Not you."                                                          |
| 404           | Not found **or not visible to this caller** — client isolation returns 404, never 403 (`PRD.md` CP-2) |
| 409           | Conflict — concurrent edit, duplicate                                                                 |
| **422**       | **Authorized, but the record is not eligible.** "Not this record, not yet."                           |
| 429           | Rate limited                                                                                          |

**403 and 422 are different failures with different remedies** (`AUTHORIZATION.md` WF-3). 403 means ask for access. 422 means complete the missing step — and the body names the unmet predicate:

```
{ "success": false, "code": "DEAL_NOT_ELIGIBLE",
  "message": "Cannot record win: advance payment is not confirmed",
  "details": { "unmet": ["paymentStatus"],
               "required": ["advance-confirmed", "paid"],
               "actual": "unpaid" } }

```

A 422 without the unmet predicate produces a support ticket every time (WF-4).

### 8.3 Route Binding

Routes declare metadata; they do not implement authorization.

```
route({
  method: 'POST',
  path: '/api/deals/:id/approve',
  action: 'deals:approve',          // must exist in REGISTRY — compile-checked
  resourceParam: 'id',
  handler: dealsService.approve,
});

```

The framework, not the handler:

1. Resolves the binding's action from the registry
2. Loads the resource named by `resourceParam`
3. Calls `authorize(ctx, action, resource)`
4. Invokes the handler
5. Passes the result through `project(ctx, action, result)`

| # Rule  |                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API-1   | A handler that calls `authorize` itself is a code smell and fails review. The framework already did. Handlers do business logic.                                                                                                                                                                                                                                                                                                                 |
| API-2   | A registered route with no binding **fails at boot** (RM-1). A missing binding is a defect and should surface at deploy, not on a request.                                                                                                                                                                                                                                                                                                       |
| API-3   | A binding naming an action outside the registry is a **compile error**, because `action` is typed as the generated union (RG-I2).                                                                                                                                                                                                                                                                                                                |
| API-4   | A binding whose action names a resource must declare `resourceParam` (RM-14), asserted at boot.                                                                                                                                                                                                                                                                                                                                                  |
| API-5   | State-changing routes call `authorize` then the state machine, in that order, and the two are separate (§9.6).                                                                                                                                                                                                                                                                                                                                   |
| API-6   | **Breaking-change policy.** Additive changes — new fields, new optional parameters, new endpoints — ship freely. Removing or renaming a field, narrowing a type, or changing a status code for an existing condition is breaking, and requires either a compatibility shim or a version prefix introduced at that point. The client and server share generated types (§6.1), so a breaking change is a compile error before it is a runtime one. |

### 8.4 Client Route Metadata

Screen definitions are generated from the same registry.

```
screen({
  path: '/sales/deals/:id',
  module: 'deals',
  requires: ['deals:view'],                       // gates navigation
  uses: ['deals:edit', 'deals:approve',
         'deals:view-commercials',
         'deals:confirm-payment'],                // gates controls
});

```

`requires` filters the sidebar. `uses` decides which buttons render. **Neither protects data** — the API binding does, server-side, on every request (RM-7). A control hidden on the client and unguarded on the server is not protected; it is merely inconvenient to find.

---

## 9. Hard Problems

The following areas are genuinely difficult. The constraint-shaped requirements are implemented with PostgreSQL-native integrity mechanisms plus application-level transaction discipline. Each section below states the mechanism, not an intention.

**Everything here depends on PG-1 and a real PostgreSQL transactional environment.** Local and CI must exercise PostgreSQL itself; SQLite is not an acceptable substitute.

### 9.1 Gapless Invoice Numbering Under Concurrency

`IN-8` requires sequential and gapless numbering per invoice series and financial year.

**Do not use PostgreSQL sequences for statutory invoice numbers.** A sequence is intentionally non-transactional: a rolled-back transaction consumes a value permanently. That is incompatible with a strict gapless requirement.

**What does not work**

| Approach | Failure |
| --- | --- |
| `SELECT MAX(number) + 1` | Race condition under concurrent issuance. |
| PostgreSQL `SEQUENCE` | Rollback does not return the consumed value, creating gaps. |
| Allocate at draft creation | Abandoned drafts consume numbers. |

**What works:** lock the series row and allocate inside the same transaction as the invoice and journal.

```sql
BEGIN;

SELECT next_number
FROM invoice_series
WHERE organization_id = $1
  AND id = $2
  AND financial_year = $3
FOR UPDATE;

-- application takes the returned number

UPDATE invoice_series
SET next_number = next_number + 1
WHERE organization_id = $1
  AND id = $2
  AND financial_year = $3;

INSERT INTO invoice (..., organization_id, series_id, number, ...)
VALUES (..., $1, $2, $allocated_number, ...);

-- invoice journal is posted in the same transaction

COMMIT;
```

If any step fails, the row lock and counter increment roll back with the invoice. Concurrent issuers serialize on the same series row.

| # | Rule |
| --- | --- |
| INV-1 | Allocation occurs only at issue, never at draft. |
| INV-2 | Allocation, invoice creation, required journal posting and the audit outbox are one database transaction. External e-invoicing calls occur after commit. |
| INV-3 | `SERIALIZABLE` is **not** the default solution. Use `FOR UPDATE` on the exact series row; retry only on genuine serialization/deadlock failures. |
| INV-4 | `UNIQUE (organization_id, series_id, number)` is the database backstop. |
| INV-5 | An issued invoice keeps its number forever; cancellation uses the prescribed credit-note flow. |
| INV-6 | A nightly gap check runs per organization/series/year and alerts critically on a hole. |

### 9.2 Double-Entry Integrity

`LG-1`: a journal that does not balance **cannot be committed**.

PostgreSQL cannot express `SUM(journal_line.debit) = SUM(journal_line.credit)` as a simple row-level `CHECK`, because the condition spans multiple rows. The correct database mechanism is a **deferred constraint trigger** that validates the complete journal at transaction commit.

```sql
CREATE OR REPLACE FUNCTION assert_journal_balanced()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  debit_total numeric;
  credit_total numeric;
BEGIN
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO debit_total, credit_total
  FROM journal_line
  WHERE organization_id = NEW.organization_id
    AND journal_entry_id = NEW.journal_entry_id;

  IF debit_total <> credit_total THEN
    RAISE EXCEPTION 'JOURNAL_NOT_BALANCED'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER journal_balance_check
AFTER INSERT OR UPDATE OR DELETE ON journal_line
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_journal_balanced();
```

The trigger runs at commit, so the application can insert all lines before the final invariant is evaluated. Application validation remains earlier and faster; the database trigger is the backstop.

### Closed periods

`A4` forbids posting into a closed accounting period. Posting locks the period row before checking status; period close acquires the same lock. This turns the business rule into a serialized database decision instead of a read-then-write race.

```sql
BEGIN;

SELECT status
FROM accounting_period
WHERE organization_id = $1
  AND id = $2
FOR UPDATE;

-- reject unless status = 'open'

INSERT INTO journal_entry (...);
INSERT INTO journal_line (...);
UPDATE account_balance ...;

COMMIT;
```

| # | Rule |
| --- | --- |
| LG-I1 | Every automatic posting is created by the module that owns the business event, inside that event's transaction. |
| LG-I2 | `journal_line` can only reference an existing `journal_entry` through a foreign key. |
| LG-I3 | `account_balance` is updated only in the same transaction as the journal that changes it. |
| LG-I4 | A closed period cannot be modified through any application path, including background jobs. |
| LG-I5 | Money uses `numeric`; rounding occurs exactly once at the business-defined component/line boundary. |
| LG-I6 | A nightly trial-balance reconciliation recomputes balances from journal lines and freezes/reporting-blocks the period on divergence. |

#### 9.2.1 Balance Divergence — Detect, Then Repair

The system never silently "fixes" accounting data. A divergence creates a critical alert, freezes the affected period and records a repair request. A repair is a human-authorised transaction that itself produces a journal/audit trail.

### 9.3 Attendance Recalculation

`AT-2` requires recalculation that is **idempotent and versioned**.

```
function calculate(input: {
  events: AttendanceEvent[];      // ordered, immutable
  shift: ResolvedShift;           // snapshot for that date (SH-2)
  leave: LeaveOverlay | null;
  holiday: Holiday | null;
  breakPolicy: BreakPolicy | null;
}): CalculatedAttendance;

```

| # Rule  |                                                                                                                                                                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AT-I1   | Calculation is a **pure function** over stored inputs. No clock, no configuration lookup, no global state — so replaying it a year later reproduces the same result.                                                                      |
| AT-I2   | The record stores the resolved shift **snapshot** for its date (SH-2). A later template edit cannot retroactively change history.                                                                                                         |
| AT-I3   | `calculationVersion` increments on every recompute. Payroll captures the version it consumed (PY-1), so a run can prove what it was based on.                                                                                             |
| AT-I4   | Recalculation is queued and keyed on `{userId, workDate}`; duplicate triggers collapse. BullMQ job ids provide the dedup key directly.                                                                                                    |
| AT-I5   | The status precedence in AT-3 is a single ordered function with a table-driven test per branch. It is the rule most likely to be "improved" by someone who has not read why the order is fixed, so the test names the order in its title. |

### 9.4 Overnight Shifts

`SH-3`: a shift crossing midnight attributes the whole session to the date the shift **started**. Named separately because it is the most regression-prone rule in the product.

```
function workDateFor(punchAt: Date, shift: ResolvedShift, tz: string): DateOnly {
  const local = toZoned(punchAt, tz);
  if (!shift.isOvernight) return local.date;
  return local.time < shift.endTime ? local.date.minus({ days: 1 }) : local.date;
}

```

| # Rule  |                                                                                                                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SH-I1   | This function exists **once**. The live board, the attendance service, the break evaluator and the payroll job all call it. Three implementations that agree today will disagree after the next edit. |
| SH-I2   | Dedicated tests: punch before midnight, punch after midnight, punch exactly at the boundary, a DST transition, and a shift whose start and end clock times are equal.                                 |

### 9.5 Audit Hash Chaining and the Audit Outbox

`AU-3`: entries are chained so modification or deletion is detectable.

The hash input is a canonical serialization with deterministic key ordering, UTC timestamps, UUID values encoded canonically, exact decimal strings for money, and explicit representations for absent versus null fields.

```text
payload = canonicalJson({
  organizationId, stream, sequence, occurredAt,
  actorId, actorType, action, targetType, targetId,
  before, after, reason, sourceIp, requestId
})

hash = sha256(prevHash || payload)
```

The canonicalization version is stored with every entry so historical entries remain verifiable after implementation changes.

A committed business operation must durably produce its audit intent. Therefore `audit_outbox` is written inside the business transaction:

```text
BUSINESS TRANSACTION
    │
    ├── business mutation
    ├── account_balance update (where financial)
    ├── audit_outbox insert       ← audit intent
    └── domain_outbox insert      ← notifications / IRN / sockets
    │
  COMMIT
    │
    ├── audit writer
    └── domain workers
```

| # | Rule |
| --- | --- |
| AU-I1 | `audit_outbox` is written inside the business transaction. |
| AU-I2 | The audit writer is serialized per `(organization_id, stream)` by the `audit_stream_state` row lock described below. |
| AU-I3 | Each outbox item has a stable idempotency key. Reprocessing the same item is a no-op. |
| AU-I4 | Runtime application role has `SELECT`/`INSERT` on audit tables but no `UPDATE`/`DELETE`. |
| AU-I5 | Outbox rows are removed only after the audit entry is committed and confirmed. |
| AU-I6 | Daily verification recomputes the chain and compares it with stored hashes and external anchors. |
| AU-I7 | Chain heads are externally anchored in WORM object storage. |
| AU-I8 | Retention deletion uses a separate credential and writes a deletion manifest. |

#### 9.5.1 Stream Ownership — PostgreSQL Row Lock

Do not use Redis consumer ownership as the correctness mechanism for the audit chain. The database already has the primitive needed.

```sql
CREATE TABLE audit_stream_state (
  organization_id uuid NOT NULL,
  stream text NOT NULL CHECK (stream IN ('access', 'activity')),
  next_sequence bigint NOT NULL DEFAULT 1,
  last_hash bytea,
  PRIMARY KEY (organization_id, stream)
);
```

The writer transaction locks the state row:

```sql
BEGIN;

SELECT next_sequence, last_hash
FROM audit_stream_state
WHERE organization_id = $1
  AND stream = $2
FOR UPDATE;

-- insert exactly this sequence + hash

UPDATE audit_stream_state
SET next_sequence = next_sequence + 1,
    last_hash = $new_hash
WHERE organization_id = $1
  AND stream = $2;

COMMIT;
```

If another worker tries the same stream, it waits for the row lock, then observes the committed sequence and hash. A paused/crashed worker releases its database lock when its transaction/connection dies; there is no stale distributed lock to fence.

| # | Rule |
| --- | --- |
| AU-L1 | Only the audit writer may allocate stream sequence numbers. |
| AU-L2 | Sequence allocation and audit insertion occur in the same database transaction. |
| AU-L3 | The writer transaction is short; no HTTP, file or queue I/O occurs while holding the row lock. |
| AU-L4 | Lock wait time is measured and alerted; sustained contention indicates insufficient writer parallelism or a hot stream. |
| AU-L5 | Parallelism is across organizations and streams, never within a stream. |
| AU-L6 | Verification asserts monotonic sequence, correct `prev_hash`, and anchor agreement. |

#### 9.5.2 External Anchoring and Archive Verification

A hash chain alone cannot detect an attacker who can rewrite the database and recompute every later hash. Therefore the current chain head for each stream is written hourly to WORM object storage with retention lock and separate write-only credentials.

At archive time, the manifest records first/last sequence, first/last hash, row count, object key and object hash. The archive is removed from the hot table only after the manifest and anchor are durable.

### 9.6 Authorization Versus State Machines

`AUTHORIZATION.md` §11 requires these to be separate systems.

```
await authorize(ctx, 'deals:record-win', deal);      // may you?   → 403
DealState.assertCanTransition(deal, 'won');          // may it?    → 422
await DealState.transition(deal, 'won', ctx);        // then do it

```

| # Rule  |                                                                                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SM-1    | A state machine receives the actor **for the audit trail, not for the decision** (WF-2). It never inspects permissions.                                                                                                              |
| SM-2    | The engine never inspects workflow state to decide permission, except through a declared `Constraint` where the permission genuinely depends on state — P1 is the example: an agent may read commercials only on a deal they closed. |
| SM-3    | Twelve modules own a state machine (WF-5). Each declares states, legal transitions and guarding predicates **as data**, so the transition table can be rendered and reviewed rather than read out of `if` statements.                |
| SM-4    | `assertCanTransition` throws a 422 naming the unmet predicate (§8.2).                                                                                                                                                                |

### 9.7 Transaction Discipline

PostgreSQL makes transactions easier to reason about than the previous MongoDB design, but the application still needs a strict discipline.

| # | Rule |
| --- | --- |
| TX-1 | Every multi-step invariant is executed inside one explicit database transaction. |
| TX-2 | No HTTP, file write, socket emit or external queue/network call occurs inside a business transaction. Write an outbox row and publish after commit. |
| TX-3 | Transactions are short. Long-running reports, PDFs, payroll orchestration and external integrations run outside the request transaction. |
| TX-4 | Operations requiring atomicity include invoice issue, receipt allocation, journal posting, period close, payroll posting and audit-outbox creation. |
| TX-5 | Cross-module façades receive the caller's transaction context so atomic operations share one PostgreSQL transaction. |
| TX-6 | Transaction failures are classified and measured by SQLSTATE/outcome class. |
| TX-7 | Idempotency keys are mandatory for external-facing non-read mutations that may be retried after an ambiguous network failure. |

#### 9.7.1 Transaction Retry and Ambiguous Commit Handling

PostgreSQL commonly surfaces concurrency failures through SQLSTATE `40001` (`serialization_failure`) and `40P01` (`deadlock_detected`). These are retryable at the transaction level.

```text
BEGIN
  │
  ├── business work
  │
  ├── commit
  │     │
  │     ├── success → DONE
  │     ├── 40001 → RETRY WHOLE TRANSACTION
  │     └── 40P01 → RETRY WHOLE TRANSACTION
  │
  └── connection lost around COMMIT
          │
          └── outcome may be ambiguous
               → reconcile using idempotency key / durable command record
               → NEVER blindly repeat a non-idempotent mutation
```

The DAL owns the bounded retry policy. Modules never implement their own retry loops.

### 9.8 Failure Taxonomy

| Condition | Retry? | Status | Caller should |
| --- | --- | --- | --- |
| `40001` serialization failure | Yes, whole transaction | — | Invisible if retry succeeds. |
| `40P01` deadlock | Yes, whole transaction | — | Invisible if retry succeeds. |
| Retry budget exhausted under contention | No | **503** + `Retry-After` | Back off; the system is saturated, not logically invalid. |
| Ambiguous outcome after connection loss around commit | No blind retry | **503** / reconciliation response | Reconcile by idempotency key; do not duplicate the operation. |
| Semantic concurrent edit | No | **409** | Refetch and re-apply using current version. |
| Unique constraint violation | No | **409** | Report the conflicting business key. |
| Foreign-key violation | No | **422** or **409** depending on contract | Name the invalid relationship. |
| Check/constraint violation caused by user input | No | **422** | Name the unmet predicate. |
| Database connection failure | No | **503** | Service unavailable; retry at client boundary. |
| Statement timeout | No | **503** | Alert and investigate query/DB saturation. |
| Authorization denial | No | **403** | Ask for access. |
| Anything unclassified | No | **500** | Alerted and treated as a defect until classified. |

| # | Rule |
| --- | --- |
| FT-1 | The DAL classifies SQLSTATE/driver errors; modules never inspect driver codes to decide HTTP status. |
| FT-2 | `503` and `409` are never conflated. `503` means retry later; `409` means state changed underneath the caller. |
| FT-3 | A database constraint failure that should have been caught by application validation is logged as an engineering defect even when the API returns a safe client error. |
| FT-4 | Each failure class is a separate metric. |

## 10. Real-Time

WebSocket with a Redis adapter so events emitted on one instance reach all.

| # Rule  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RT-1    | The socket handshake authenticates with the same token and the same session-version check as HTTP.                                                                                                                                                                                                                                                                                                                                                                                        |
| RT-2    | **Rooms are derived from the permission set**, joined at connect: `user:<id>`, `team:<id>`, `department:<id>`, `project:<id>` for each project in scope. A principal never joins a room they cannot read.                                                                                                                                                                                                                                                                                 |
| RT-3    | On `permissions:changed`, the socket **recomputes and re-joins**. A narrowed permission must not leave a stale subscription open.                                                                                                                                                                                                                                                                                                                                                         |
| RT-4    | Event payloads carry identifiers and a change type, **not record bodies**. The client refetches through the API, where field projection applies. Pushing bodies over sockets would be a second serialization path that bypasses `project()`.                                                                                                                                                                                                                                              |
| RT-5    | **Event names are not actions.** They share the `module:verb` shape and live in a separate namespace; nothing looks an event up in the registry. Events: `attendance:punch`, `status:changed`, `handover:offered/answered/expired`, `deal:created/approval-required/decided`, `brief:submitted/confirmed/decided`, `project:delivered`, `change:raised`, `task:assigned/revision-needed`, `invoice:issued`, `payment:received`, `message:new`, `notification:new`, `permissions:changed`. |
| RT-6    | Polling is a fallback after repeated reconnect failure, at 60-second intervals.                                                                                                                                                                                                                                                                                                                                                                                                           |

---

## 11. Background Jobs

| # Rule  |                                                                                                                                                           |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JB-1    | Every job is **idempotent** and keyed, so a duplicate delivery is a no-op.                                                                                |
| JB-2    | Every run writes a record: started, finished, outcome, items processed, errors. A job with no run history is indistinguishable from a job that never ran. |
| JB-3    | Jobs construct a `RequestContext` **per organization** (TN-8).                                                                                            |
| JB-4    | A failing job retries with backoff, then dead-letters with an alert. It never retries forever silently.                                                   |

**The scheduled set**

| Job Cadence Notes        |                            |                                                                                       |
| ------------------------ | -------------------------- | ------------------------------------------------------------------------------------- |
| Attendance auto-close    | Hourly                     | Closes open days past shift end + window; flags them                                  |
| Attendance recalculation | On demand                  | Queued, idempotent, keyed (AT-I4)                                                     |
| Break breach evaluation  | End of shift               | Produces pending breaches; applies nothing without confirmation (BM-5)                |
| Callback reminders       | Every minute               | T−60, T−15, T; per-channel delivery records                                           |
| Callback miss detection  | Every 5 minutes            | 30-minute grace, then `Missed`                                                        |
| Lead stall detection     | Daily                      | Auto-flags to Supervisor (LD-7)                                                       |
| Handover expiry          | Every 10 seconds           | Short window; must be prompt                                                          |
| Approval escalation      | Hourly                     | Unanswered past window → next level                                                   |
| Brief SLA escalation     | Hourly                     | Both gates: awaiting confirm, awaiting feasibility                                    |
| Recurring invoices       | Daily                      | Generates drafts, or issues where auto-issue is set (IN-2)                            |
| Dunning                  | Daily                      | Respects dispute pause (RC-4)                                                         |
| Invoice overdue marking  | Daily                      |                                                                                       |
| e-Invoicing submission   | Continuous                 | Post-commit queue (INV-2), retryable                                                  |
| Renewal generation       | Daily                      | From contract end dates                                                               |
| Override expiry          | Nightly                    | **Cleanup only** — never the decision (AZ-I6)                                         |
| Audit chain verification | Daily                      | Critical alert on break                                                               |
| Audit outbox drain       | Continuous                 | Single writer per org+stream under lease with fencing (§9.5.1); backlog depth alerted |
| Audit chain anchoring    | Hourly                     | Writes chain heads to WORM object storage (AN-1)                                      |
| Audit archiving          | Monthly                    | Segments beyond 12 months, with manifest, anchored before removal (AN-5)              |
| Balance reconciliation   | Nightly                    | Divergence freezes the period and reports; repair is human-authorised (§9.2.1)        |
| Trial balance check      | After each batch + nightly | Critical alert on imbalance                                                           |
| Invoice gap check        | Nightly                    | Critical alert on a hole                                                              |
| Retention enforcement    | Nightly                    | Respects legal holds (AU-8)                                                           |
| Device health            | Every 15 minutes           | Silent 60 min during a shift → alert                                                  |
| Notification digest      | Per user preference        | Respects quiet hours                                                                  |
| Payroll generation       | On demand                  | Background, progress-reported, atomic (PY-10)                                         |

---

## 12. File Storage

| # Rule  |                                                                                                                                                                                   |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FS-1    | Object storage with random keys under a sharded prefix. The database stores the relative key; the filename is never derived from user input.                                      |
| FS-2    | URLs are **signed on read** with a short expiry. Nothing bakes a signature into stored data — a stored signature expires and the record breaks permanently.                       |
| FS-3    | Signing happens in one place, at the response boundary, so no read path can forget it.                                                                                            |
| FS-4    | Access inherits the parent record's authorization (DC-1). A leave attachment obeys P4; a contract obeys P1. The signer calls `authorize` against the parent before minting a URL. |
| FS-5    | One size limit product-wide (DC-3).                                                                                                                                               |
| FS-6    | Statutory rows — issued invoices, published payslips — are written to a **write-once** bucket with object lock. A3 at the storage layer, not just the application layer.     |
| FS-7    | Uploads are scanned for malware before becoming readable.                                                                                                                         |

---

## 13. Observability

| Signal Requirement  |                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logs                | Structured JSON with request id, organization id, principal id, action. **Never** log a payslip amount, a deal's commercials, a notepad body or a geofence coordinate.     |
| Metrics             | Request rate and latency by route; authorization denials by action and reason; queue depth and job outcomes; trial-balance status; invoice gap status; audit chain status. |
| Traces              | Sampled, with the authorization step spanned separately so its share of latency is visible against the 20 ms budget (NF-5).                                                |
| Alerts — critical   | Trial balance non-zero · audit chain broken · invoice numbering gap · payroll run failure · a tenant-boundary violation detected                                           |
| Alerts — warning    | Device silent during shift · queue backlog · authorization denial spike for one principal · unreconciled bank items at period end                                          |

**Authorization denial spikes are a security signal, not a UX signal.** A single principal generating many 403s across unrelated resources is either a broken integration or someone probing. It pages.

---

## 14. Testing

Mapping `AUTHORIZATION.md` §10 TS-1 to TS-25 and `PRD.md` NF-23 onto layers.

| Layer Covers      |                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit              | Pure functions: attendance calculation, shift resolution, overnight attribution, GST computation, proration, threshold evaluation, aging buckets |
| Property          | `filter`/`check` agreement per resource policy (AZ-I7b); trial balance balances over randomised posting batches                                  |
| Contract          | Every route's request and response shape against the generated types                                                                             |
| **Authorization** | Every action positive and negative; every protected constraint attempted **through the API** (TS-2, TS-10)                                       |
| Matrix            | Every position × every action, asserting resolved scope matches `PRD.md` §6 (TS-4)                                                               |
| Leakage           | No list endpoint returns a record failing `check`; no count differs from its filtered list length (TS-5)                                         |
| Integration       | The eight workflow stages end to end                                                                                                             |
| Load              | §18 budgets against the reference dataset                                                                                                        |

| # Rule  |                                                                                                                                                          |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TS-I1   | Authorization tests run **against the HTTP surface**. A test calling the engine directly proves the engine works, not that the endpoint uses it (TS-10). |
| TS-I2   | Every numbered rule in `PRD.md` maps to at least one named test. A rule with no test is not implemented (NF-23).                                         |
| TS-I3   | The reference dataset (§18) is generated by a committed script, so load results are comparable across runs.                                              |

---

## 15. CI Gates

The registry is the source of truth because nothing can diverge from it without the build going red. PostgreSQL reduces the amount of application-only correctness work, but CI remains essential for authorization and architecture.

### 15.1 Registry and Routing

| Check | Source |
| --- | --- |
| CI-1 | Every PRD action appears in `AUTHORIZATION.md` and vice versa. |
| CI-2 | Every registry action has at least one route binding. |
| CI-3 | Every binding names a registered action. |
| CI-4 | Every Express route has a binding. |
| CI-5 | Registry invariants RG-1 to RG-6 hold. |
| CI-6 | Resource-bearing actions declare a resource parameter. |
| CI-7 | Every approval-bearing action has a non-null initiator field. |
| CI-8 | Every permission-matrix cell maps to registry actions. |
| CI-9 | Generated registry output matches a fresh extraction. |
| CI-10 | Every registry resource has a registered `ResourcePolicy`. |

### 15.2 Structural

| Check | Rule |
| --- | --- |
| CI-11 | PRD module catalog, permission matrix, build classification and screen inventory contain the same 42 modules. |
| CI-12 | No duplicate rule identifiers. |
| CI-13 | Every BD reference resolves. |
| CI-14 | Every numbered technical rule has at least one automated test referencing its id. |
| CI-15 | No module imports the raw PostgreSQL pool or creates its own database connection. |

### 15.3 Release-Blocking Set

| Guard | Checks |
| --- | --- |
| Tenancy | CI-16, CI-16b, CI-16c: no tenant-bound query path without DAL context; RLS enabled/forced on every tenant table. |
| Authorization | CI-19: no role/account-type checks outside the authorization engine. |
| SQL safety | CI-20: no interpolated user-controlled SQL; query values are parameterised. |
| Money | CI-21: no authoritative money field maps to JavaScript `number`. |
| Match nothing | CI-23: deny filters compile to explicit `FALSE`/empty-result predicates, never an omitted WHERE. |
| Tenant uniqueness | CI-26: tenant-scoped unique constraints include `organization_id` unless explicitly global. |
| Transaction discipline | CI-31: transaction creation/retry is only in platform/DAL. |
| RLS | CI-33: schema scan proves every tenant table has RLS + FORCE RLS and app role lacks BYPASSRLS. |
| FK integrity | CI-34: tenant-owned relations have tenant-safe foreign keys where required. |

### 15.4 Guardrails — Checks That Enforce a Principle

The build also checks:

- `EXPLAIN` plans for representative tenant queries;
- no sequential scan above configured thresholds on critical list endpoints;
- no N+1 query patterns in development tests;
- no application role grants of `UPDATE/DELETE` on append-only audit/journal tables;
- no `SET app.organization_id` outside the DAL;
- no long-running transaction around HTTP/file/queue I/O;
- no PostgreSQL 19 beta in production configuration;
- migration order is deterministic and forward-only.

## 16.1 Container Strategy

TapCRM will use Docker as the standard application packaging and runtime
layer. The primary deployment target is the company's owned server, not a
managed cloud application platform.

### Docker responsibilities

Docker is responsible for:

- Reproducible application/runtime environments.
- Isolation between TapCRM components.
- Consistent local, CI and production application images.
- Controlled dependency and runtime versions.
- Repeatable deployments and rollback.

Docker is **not** the backup strategy and does not by itself provide
high availability.

### Production container topology

The owned server will run the initial production workload using Docker
containers:

```text
Owned Server
│
├── Reverse Proxy / TLS
│
├── TapCRM Web
│
├── TapCRM API
│
├── TapCRM Worker
│
├── PostgreSQL 18.x
│
├── Redis 8.x
│
└── MinIO / S3-compatible object storage
```

The exact container count may change as measured load requires.

### Docker Compose

Docker Compose is the initial orchestration mechanism for local
development and the owned-server deployment. Kubernetes is explicitly
out of scope for the initial architecture.

The system must remain modular enough that API and worker workloads can
later be moved to multiple hosts or a container orchestrator without
changing domain boundaries.

### Managed services are not required initially

The initial production architecture does not assume managed PostgreSQL,
managed Redis or managed object storage. Those services may be adopted
later if operational requirements, scale, availability requirements or
cost justify the migration.

### Data persistence

Application containers are disposable. Persistent data must live in
named Docker volumes or external persistent storage:

- PostgreSQL data volume
- Redis persistence where required
- MinIO/object-storage data

Container recreation must never destroy authoritative application data.

### Backups are separate from the production server

The owned production server is a single infrastructure failure domain.
Therefore:

- PostgreSQL backups must be copied to storage separate from the server.
- Object-storage backups must be copied to separate storage where the
  business retention policy requires them.
- Backups must be encrypted.
- Restore procedures must be tested periodically.
- Docker volumes must never be treated as backups.

### Reverse proxy

A host-level or dedicated containerized reverse proxy terminates TLS and
routes traffic to the appropriate internal container. PostgreSQL, Redis
and object-storage administration endpoints must never be exposed
directly to the public Internet.

### Secrets

Production secrets must not be committed to the repository or baked
into Docker images. They must be injected at deployment time through the
server's secret-management mechanism or protected environment files with
appropriate filesystem permissions.

### Container image policy

Production images must be:

- Built in CI.
- Tagged with an immutable release identifier.
- Pinned to approved base-image versions.
- Scanned for known vulnerabilities.
- Promoted from the tested image rather than rebuilt differently on the
  production server.

## 16. Environments and Deployment

| Environment | Purpose |
| --- | --- |
| Local | Docker Compose: PostgreSQL 18.x, Redis, object-storage emulator, seeded fixtures. |
| CI | Ephemeral PostgreSQL environment; migrations from empty; RLS tests; full test suite. |
| Staging | Production-shaped environment on the owned infrastructure or a separate staging host, anonymised data, statutory integrations in sandbox. |
| Production | Owned production server running Docker containers with PostgreSQL 18.x, Redis, object storage, automated backups and monitored health. |

| # | Rule |
| --- | --- |
| DP-0 | Every environment runs PostgreSQL 18.x or a compatible supported version; local/CI must exercise real PostgreSQL, not SQLite. |
| DP-1 | Migrations are forward-only, recorded, reviewed and run before the new application version serves traffic. |
| DP-2 | Deployments are zero-downtime rolling. Sessions survive in Redis; sockets reconnect. |
| DP-3 | Secrets come from a managed secret store, never source files or the database. |
| DP-4 | RPO 15 minutes, RTO 4 hours. Point-in-time recovery is enabled. |
| DP-5 | Restore is verified on a schedule. An unverified backup is a hypothesis. The result is visible in system administration. |
| DP-6 | Feature flags gate module rollout per department, so modules can ship dark. |
| DP-7 | Statutory integrations have sandbox and production credentials; staging cannot reach production endpoints. |
| DP-8 | Connection pool sizes are explicitly budgeted. Application instances + workers must remain below the managed PostgreSQL connection ceiling with operational headroom. |
| DP-9 | Production server failure and PostgreSQL recovery procedures are tested before go-live and at least annually thereafter. |
| DP-10 | Production containers use restart policies and health checks; an unhealthy application container must not silently remain in service. |
| DP-11 | Public ingress is limited to required HTTP/HTTPS endpoints; PostgreSQL, Redis and object-storage administrative ports remain private. |
| DP-12 | Production deployment is performed from a versioned Compose configuration and immutable application images; ad-hoc container changes are prohibited. |
| DP-13 | Server monitoring covers CPU, memory, disk, filesystem health, Docker health, PostgreSQL health, Redis health and backup status. |
| DP-14 | The owned server remains the initial production failure domain; future HA requires an explicit second-host architecture rather than assuming Docker provides HA. |

## 16.2 Production Server Topology

The initial production topology is intentionally simple:

```text
Internet
   │
   ▼
DNS / CDN / WAF (where used)
   │
   ▼
Reverse Proxy / TLS
   │
   ├── Web container
   └── API container
          │
          ├── Worker container
          ├── PostgreSQL 18.x
          ├── Redis 8.x
          └── MinIO / object storage
```

Internal services communicate over a private Docker network.

Only the reverse proxy is exposed publicly. Database, cache and storage
services are private.

This topology is sufficient for the initial scale target. If the load
test shows that API or worker capacity is insufficient, those workloads
can be replicated first without immediately introducing Kubernetes.

## 17. Seeding and Migration

### 17.1 Seed Order

Dependencies make this order mandatory.

```
1. organization
2. ledger_account          chart of accounts (LG-2)
3. department              hr, sales, projects, development, finance(inactive)
4. position                16 positions (2 finance inactive)
5. position_policy         generated from the §6 matrix per §7
6. registry_action         projection of the registry (RG-I3)
7. designation + specialization
8. leave_type              accrual 0, enforcement off (LV-12)
9. shift                   templates
10. holiday                current year
11. tax_rate               pending BD-27
12. invoice_series         pending BD-27
13. accounting_period      current financial year, open
14. super-admin account

```

| # Rule  |                                                                                                                                                                                                 |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SD-1    | Seeds are **idempotent**. Re-running changes nothing.                                                                                                                                           |
| SD-2    | Steps 11 and 12 are blocked on BD-27 and produce a **visible go-live blocker** rather than a plausible default. Guessing a GST rate is a statutory problem.                                     |
| SD-3    | Step 8 seeds types with zero entitlement and enforcement off, per the LV-G guard. The starting table in BD-5 is offered in the UI as a one-click adoption requiring a named acceptance (LV-G5). |
| SD-4    | Step 5 is generated, never hand-written, and is diffed against the matrix in CI (MX-3).                                                                                                         |

### 17.2 Organization Structure Load

**Blocked on BD-2.** The shape is settled; the roster is data.

| # Rule  |                                                                                                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SD-5    | Structure loads from a reviewed file: every employee with position, department, team and manager.                                                                                   |
| SD-6    | A **dry run** validates and reports every error before writing: cyclic reporting, a manager whose position is not an ancestor, an agent with no pool, a developer with no sub-team. |
| SD-7    | A user without a position **cannot be created** (ED-4). The loader has no bypass.                                                                                                   |
| SD-8    | After load, a verification report renders the org chart and lists every user with a null `reports_to` or `team_id`, for sign-off before P0 exits.                                   |

### 17.3 Financial Cutover

**Blocked on BD-28.**

| # Rule  |                                                                                                                                                                            |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SD-9    | Opening balances load as a single balanced journal dated the cutover, posted to an Opening Balance Equity account. Being balanced, it satisfies LG-1 like any other entry. |
| SD-10   | Open invoices load with their original issue dates and numbers so aging is correct from day one. Their numbers are reserved in the series to preserve gaplessness.         |
| SD-11   | The trial balance is asserted zero immediately after cutover, before any transaction is accepted.                                                                          |

---

## 18. Performance Engineering

Budgets are `PRD.md` §15.1, measured against the 12-month reference dataset and validated against a 3-year stress dataset where stated.

| Budget | Approach |
| --- | --- |
| List first page < 1 s at 500k leads | Keyset pagination, never `OFFSET`. Primary index `(organization_id, assigned_to, status, created_at DESC, id DESC)` and query predicates aligned to the index. |
| Live board < 1.5 s, punch reflected < 3 s | `user_status` is a maintained projection updated in the punch transaction. Board reads the projection; socket deltas notify clients. |
| Monthly attendance < 4 s for 2,000 employees | Read calculated attendance records/rollups; never recompute historical attendance on every request. |
| Payroll < 3 min for 2,000 | Batched, parallel by employee, one transaction per employee, progress via job records. |
| Authorization < 20 ms p95 | Permission set cached; recursive CTE scope resolution memoised per request; registry is in-memory. |
| Search < 1.5 s | PostgreSQL FTS with tenant predicate before ranking; GIN-backed search vector. |
| Audit query < 3 s at 20M | Monthly partitions, bounded date range mandatory, indexes on `(organization_id, occurred_at)` and common actor/target access paths. |
| Report over 12 months < 8 s | Pre-aggregated daily rollups for dashboard tiles; live SQL only for drill-through. Financial statements read `account_balance`, not full journal history. |

| # | Rule |
| --- | --- |
| PF-I1 | Every scope-derived query must have an index strategy that includes tenant visibility and the actual predicate/sort. |
| PF-I2 | CI runs `EXPLAIN (ANALYZE, BUFFERS)` against representative queries and fails on unexpected sequential scans above configured thresholds. |
| PF-I3 | Dashboard tiles have individual time budgets; a tile exceeding its budget renders unavailable rather than blocking the page. |
| PF-I4 | No N+1. DAL development instrumentation logs repeated query shapes within a request. |
| PF-I5 | Load tests include 1,200 concurrent users for the 12-month target and 6,000 for the 3-year target. |
| PF-I6 | Authorization load tests include hierarchy depth, team size and project-portfolio edge cases; recursive CTE is replaced with a closure table only on measured evidence. |
| PF-I7 | Audit load testing must cover the stated 3-year annual volume of 200M events, not only the 20M 12-month query target. |

## 19. Technical Decisions

The technical choices below are resolved for the current architecture. If they change, this document and the implementation plan must change together.

| ID | Decision | Status | Implementation |
| --- | --- | --- | --- |
| **BD-31** | **Primary datastore** | **RESOLVED** | **PostgreSQL 18.x.** It is the single system of record for identity, CRM, delivery, people and finance. RLS, foreign keys, checks, deferred constraint triggers and transactions provide database-level integrity. |
| **BD-32** | Closure table versus recursive CTE | **RESOLVED** | **Recursive CTE at launch.** Move to a maintained closure table only if §18 load testing proves the CTE misses the authorization budget. |
| **BD-33** | Search | **RESOLVED** | **PostgreSQL full-text search at launch.** Revisit a dedicated search tier only if measured search latency or ranking requirements exceed PostgreSQL's budget. |
| **BD-34** | e-Invoicing integration | **RESOLVED** | GSP provider rather than direct IRP integration. The provider absorbs statutory interface changes; TapCRM owns the domain contract and reconciliation. |
| **BD-35** | Mobile | **RESOLVED** | PWA. Employee baseline and client portal are served from one web codebase. |
| **BD-36** | Managed PostgreSQL versus self-hosted PostgreSQL | **RESOLVED** | **Managed PostgreSQL.** Database failover, PITR, backups and operational maintenance are delegated to the managed provider; TapCRM still owns schema, queries, migrations, RLS, restore verification and observability. |

### 19.1 BD-36 Implementation Consequences

```text
                  BD-36 = Managed PostgreSQL
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
           HA/RPO         RLS          backups/PITR
            DP-4         PG-3/4          DP-4/5
```

Managed PostgreSQL is an infrastructure decision, not an excuse to outsource database engineering. The application team still owns schema correctness, query plans, migrations, RLS policies, transaction design, restore drills and database observability.

## Appendix — Traceability

Every rule in this document references the requirement it implements.

| This document Implements  |                                                                              |
| ------------------------- | ---------------------------------------------------------------------------- |
| §4 TN-1 to TN-9           | `PRD.md` MT-1 to MT-6                                                        |
| §6.1 RG-I1 to RG-I4       | `AUTHORIZATION.md` §6.4, RG-1 to RG-6                                        |
| §6.3                      | `AUTHORIZATION.md` §3 pipeline, steps 1–9                                    |
| §6.4 AZ-I5 to AZ-I7       | `AUTHORIZATION.md` OV-1 to OV-4                                              |
| §6.5                      | `AUTHORIZATION.md` §5.5, protected constraint P6                             |
| §6.6                      | `AUTHORIZATION.md` §5.2, §5.4                                                |
| §6.7                      | `AUTHORIZATION.md` §4.4                                                      |
| §6.8                      | `AUTHORIZATION.md` §4.1.1, SD-A to SD-D                                      |
| §7                        | `PRD.md` §6, NF-22b                                                          |
| §8.2                      | `AUTHORIZATION.md` WF-3, WF-4                                                |
| §8.3                      | `AUTHORIZATION.md` RM-1 to RM-8                                              |
| §9.1                      | `PRD.md` IN-8, IN-13                                                         |
| §9.2                      | `PRD.md` LG-1 to LG-5, LG-7, A3, A4                                          |
| §9.7                      | `PRD.md` NF-7, NF-11; the transaction discipline every §9 section depends on |
| §9.3                      | `PRD.md` AT-1 to AT-3, SH-2                                                  |
| §9.4                      | `PRD.md` SH-3                                                                |
| §5.6                      | `PRD.md` AU-3, AU-4; the reason audit is not time-series                     |
| §9.2.1                    | `PRD.md` LG-7; detection-plus-repair for financial integrity                 |
| §9.5                      | `PRD.md` AU-3 to AU-10; TX-5 outbox                                           |
| §9.5.1                    | Distributed ownership for the hash chain                                     |
| §9.5.2                    | `PRD.md` AU-3, AU-4; anchoring and archive verification                      |
| §9.7.1                    | PostgreSQL commit semantics; `ambiguous commit outcome`                   |
| §9.8                      | `AUTHORIZATION.md` WF-3, WF-4; `PRD.md` NF-13                                |
| §9.6                      | `AUTHORIZATION.md` §11, WF-1 to WF-5                                         |
| §10                       | `PRD.md` NF-10, `AUTHORIZATION.md` PD-1, PD-2                                |
| §12                       | `PRD.md` DC-1 to DC-6, FS rules                                              |
| §14                       | `AUTHORIZATION.md` TS-1 to TS-25, `PRD.md` NF-23                             |
| §15                       | `AUTHORIZATION.md` RM-9 to RM-16                                             |
| §17                       | `PRD.md` SD-2, LV-G1 to LV-G5, `DECISIONS.md` BD-2, BD-27, BD-28             |
| §18                       | `PRD.md` §15.1, §17                                                          |

*End of document.*
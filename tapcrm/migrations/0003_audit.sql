-- =====================================================================
-- 0003 — Audit (P0 Foundation)
--
-- TECH.md §5.6, §9.5. PRD AU-1..AU-10.
--
-- AU-2: "Both streams are append-only. NO PRINCIPAL, INCLUDING SUPER ADMIN,
-- can edit or delete an entry."
--
-- That is enforced here by DATABASE PRIVILEGE (§4.4), not by handler
-- discipline: the application role is granted SELECT and INSERT and nothing
-- else. A defect in application code cannot rewrite history.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Chain state — the single writer's cursor.
--
-- §5.6: "Because PostgreSQL requires a partition key to participate in a
-- partitioned table's global unique/primary-key constraint, GLOBAL SEQUENCE
-- UNIQUENESS IS ENFORCED BY THE UNPARTITIONED audit_stream_state ROW AND THE
-- SINGLE WRITER TRANSACTION, not by pretending a partition-local unique index
-- is global. This is an intentional design choice."
--
-- The writer locks this row FOR UPDATE, allocates the next sequence and inserts
-- the audit row in the same transaction. That makes the chain globally ordered
-- across partitions.
-- ---------------------------------------------------------------------
CREATE TABLE audit_stream_state (
  organization_id  uuid NOT NULL REFERENCES organization(id),
  stream           text NOT NULL CHECK (stream IN ('access', 'activity')),
  next_sequence    bigint NOT NULL DEFAULT 1,
  last_hash        bytea,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, stream)
);

-- ---------------------------------------------------------------------
-- The two streams — AU-1.
--
--   ACCESS   permission grants, revocations, position changes, delegation, and
--            every read of a protected resource.
--   ACTIVITY material business events.
--
-- One table, discriminated by `stream`, because both share the hash chain
-- machinery and splitting them would mean maintaining two identical chains.
-- ---------------------------------------------------------------------
CREATE TABLE audit_entry (
  organization_id  uuid NOT NULL,
  stream           text NOT NULL CHECK (stream IN ('access', 'activity')),
  sequence         bigint NOT NULL,
  occurred_at      timestamptz NOT NULL DEFAULT now(),

  -- AU-10: actor, target, action, before and after, timestamp, source address,
  -- and the reason where one was required.
  actor_id         uuid,
  actor_type       text NOT NULL
                     CHECK (actor_type IN ('super-admin', 'employee', 'client', 'service', 'system')),
  action           text NOT NULL,
  target_type      text NOT NULL,
  target_id        uuid,
  before_data      jsonb,
  after_data       jsonb,
  reason           text,
  source_ip        inet,
  request_id       text,

  -- AU-3: "Entries are chained by cryptographic hash. Any modification or
  -- deletion breaks the chain and is reported by the integrity verification
  -- job, which runs daily."
  hash_version     smallint NOT NULL DEFAULT 1,
  prev_hash        bytea,
  hash             bytea NOT NULL,

  -- AU-8: legal hold exempts an entry from retention expiry until lifted.
  legal_hold       boolean NOT NULL DEFAULT false,

  PRIMARY KEY (organization_id, stream, sequence, occurred_at)
) PARTITION BY RANGE (occurred_at);

COMMENT ON TABLE audit_entry IS
  'AU-2: append-only. UPDATE and DELETE are revoked from the application role. AU-4: retention is 7 years; entries older than 12 months move to archival storage.';

-- ---------------------------------------------------------------------
-- Partitions — §5.6, range-partitioned MONTHLY by occurred_at.
--
-- At the 3-year target this table holds 200M entries per year (PRD §17), and
-- NF-4d budgets an actor+date-range query at under 3 s. Monthly partitions with
-- a mandatory bounded date range are what make that reachable.
--
-- Only a bootstrap window is created here; the monthly maintenance job creates
-- the next partition ahead of time and archives segments beyond 12 months.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_audit_partition(month_start date) RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  partition_name text := format('audit_entry_%s', to_char(month_start, 'YYYY_MM'));
  month_end date := (month_start + interval '1 month')::date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = partition_name) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF audit_entry FOR VALUES FROM (%L) TO (%L)',
      partition_name, month_start, month_end
    );
    -- Grants do not inherit to new partitions; each needs them explicitly, and
    -- each needs UPDATE/DELETE revoked or the append-only guarantee has a hole.
    EXECUTE format('GRANT SELECT, INSERT ON %I TO tapcrm_app', partition_name);
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM tapcrm_app', partition_name);
    -- RLS does NOT inherit for direct partition access. PostgreSQL applies the
    -- parent's policy only when the query goes through the parent; naming a
    -- partition directly uses that partition's own policies. Since the app role
    -- is granted SELECT on each partition, an omitted policy here would be a
    -- real tenant-isolation hole.
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', partition_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', partition_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I
         USING (organization_id = current_organization_id())
         WITH CHECK (organization_id = current_organization_id())',
      partition_name || '_tenant_isolation', partition_name
    );
  END IF;
END
$$;

-- A default partition catches anything outside the created range rather than
-- rejecting the insert. Losing an audit entry is worse than an unpartitioned row.
CREATE TABLE audit_entry_default PARTITION OF audit_entry DEFAULT;
ALTER TABLE audit_entry_default ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_entry_default FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_entry_default_tenant_isolation ON audit_entry_default
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

DO $$
DECLARE
  m date := date_trunc('month', now() - interval '1 month')::date;
BEGIN
  FOR i IN 0..13 LOOP
    PERFORM create_audit_partition((m + (i || ' month')::interval)::date);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------
-- Outbox — TX-2, §9.5.
--
-- "No HTTP, file write, socket emit or external queue/network call occurs
--  inside a business transaction. Write an outbox row and publish after commit."
--
-- The audit entry itself must be atomic with the business change, but hashing
-- and chaining need the single-writer lock, which would serialise every
-- business transaction in the system. So the business transaction writes here,
-- and the drainer chains it.
-- ---------------------------------------------------------------------
CREATE TABLE audit_outbox (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  stream           text NOT NULL CHECK (stream IN ('access', 'activity')),
  payload          jsonb NOT NULL,
  enqueued_at      timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  attempts         integer NOT NULL DEFAULT 0,
  last_error       text
);

-- Drives the drainer and the backlog-depth alert (§11, §13).
CREATE INDEX ix_audit_outbox_pending ON audit_outbox (organization_id, stream, enqueued_at)
  WHERE processed_at IS NULL;

-- ---------------------------------------------------------------------
-- Domain outbox — the same pattern for business events (MB-3, §3.1).
-- "Invoice issued → notify the client, emit a socket event, update a rollup."
-- ---------------------------------------------------------------------
CREATE TABLE domain_outbox (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  event_name       text NOT NULL,
  payload          jsonb NOT NULL,
  enqueued_at      timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  attempts         integer NOT NULL DEFAULT 0,
  last_error       text
);

CREATE INDEX ix_domain_outbox_pending ON domain_outbox (organization_id, enqueued_at)
  WHERE processed_at IS NULL;

-- ---------------------------------------------------------------------
-- Job runs — JB-2.
-- "Every run writes a record: started, finished, outcome, items processed,
--  errors. A JOB WITH NO RUN HISTORY IS INDISTINGUISHABLE FROM A JOB THAT
--  NEVER RAN."
-- ---------------------------------------------------------------------
CREATE TABLE job_run (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  -- TN-9 / JB-3: "Jobs construct a RequestContext PER ORGANIZATION... it
  -- never runs with an absent tenant context." NOT NULL makes that structural,
  -- and lets this table take the ordinary tenant RLS policy.
  organization_id  uuid NOT NULL REFERENCES organization(id),
  job_name         text NOT NULL,
  -- JB-1: every job is idempotent AND KEYED, so a duplicate delivery is a no-op.
  idempotency_key  text,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  outcome          text CHECK (outcome IN ('success', 'failure', 'partial', 'skipped')),
  items_processed  integer NOT NULL DEFAULT 0,
  error_count      integer NOT NULL DEFAULT 0,
  details          jsonb
);

-- IX-2: a tenant-scoped unique constraint includes organization_id.
CREATE UNIQUE INDEX ux_job_run_idempotency ON job_run (organization_id, job_name, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_job_run_recent ON job_run (organization_id, job_name, started_at DESC);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
SELECT apply_tenant_rls('job_run');
SELECT apply_tenant_rls('audit_stream_state');
SELECT apply_tenant_rls('audit_outbox');
SELECT apply_tenant_rls('domain_outbox');

-- audit_entry is partitioned; RLS is applied to the parent and inherited.
ALTER TABLE audit_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_entry FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_entry_tenant_isolation ON audit_entry
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- ---------------------------------------------------------------------
-- Append-only enforcement — §4.4.
--
--   "For append-only data, the runtime application role has SELECT and INSERT
--    but no UPDATE or DELETE. The migration/admin role owns the table."
--
-- AU-2 becomes a database privilege rather than a promise.
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT ON audit_entry TO tapcrm_app;
REVOKE UPDATE, DELETE ON audit_entry FROM tapcrm_app;
REVOKE UPDATE, DELETE ON audit_entry_default FROM tapcrm_app;
GRANT SELECT, INSERT ON audit_entry_default TO tapcrm_app;

DO $$
DECLARE
  part record;
BEGIN
  FOR part IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'audit_entry'
  LOOP
    EXECUTE format('GRANT SELECT, INSERT ON %I TO tapcrm_app', part.relname);
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM tapcrm_app', part.relname);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------
-- Indexes — §18: "indexes on (organization_id, occurred_at) and common
-- actor/target access paths", with a bounded date range mandatory.
-- ---------------------------------------------------------------------
CREATE INDEX ix_audit_org_time    ON audit_entry (organization_id, occurred_at DESC);
CREATE INDEX ix_audit_actor       ON audit_entry (organization_id, actor_id, occurred_at DESC);
CREATE INDEX ix_audit_target      ON audit_entry (organization_id, target_type, target_id, occurred_at DESC);
CREATE INDEX ix_audit_action      ON audit_entry (organization_id, action, occurred_at DESC);
-- AU-8: held entries are exempt from retention expiry; the purge job needs to
-- find them cheaply.
CREATE INDEX ix_audit_hold        ON audit_entry (organization_id, occurred_at)
  WHERE legal_hold;

-- =====================================================================
-- 0077 — Sales: Connectors, submissions, bid-pool views, routing audit
--
-- Introduces the four tables that power the canonical intake pipeline
-- (PRD v1.1 §6.2), the bidding pool (§8.3) and routing audit (§20).
--
-- See R0 implementation plan step 0.3.
--
-- Tables added:
--   sales_connector          — one row per connected external account
--                              (Meta Page, mailbox, WhatsApp number, GBP
--                              line, website form, import channel, partner)
--   lead_submission          — every durable receipt from an external
--                              source; the idempotency row that makes
--                              webhook replays safe
--   bid_pool_view            — per (lead, agent) record of viewing,
--                              passing or claiming; drives fairness
--                              analytics and the 5-minute pass cooling
--   sales_routing_decision   — audit trail of every routing decision
--                              (bidding, direct, fallback, reassignment)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. sales_connector
--
-- One row per connected external account. `kind` governs which adapter
-- in the server handles its payloads; `external_account_id` disambiguates
-- multiple connections of the same kind (e.g., several Meta Pages).
--
-- Secrets never live in this table. `secret_ref` is an opaque pointer
-- into the platform secret store; rotation changes the stored secret
-- without touching this row.
--
-- Status machine mirrors PRD R-SYNC-01.
-- ---------------------------------------------------------------------
CREATE TABLE sales_connector (
  id                  uuid        PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid        NOT NULL REFERENCES organization(id),
  kind                text        NOT NULL
                        CHECK (kind IN ('website', 'meta', 'email', 'whatsapp', 'gbp', 'import', 'partner')),
  name                text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  external_account_id text,
  external_form_ids   text[]      NOT NULL DEFAULT ARRAY[]::text[],
  config              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  secret_ref          text,
  status              text        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'testing', 'active', 'degraded', 'reconnect_required', 'paused', 'disconnected')),
  cursor              jsonb,
  last_success_at     timestamptz,
  last_test_at        timestamptz,
  last_reconcile_at   timestamptz,
  queue_lag_seconds   integer,
  captured_count      integer     NOT NULL DEFAULT 0 CHECK (captured_count     >= 0),
  linked_count        integer     NOT NULL DEFAULT 0 CHECK (linked_count       >= 0),
  quarantined_count   integer     NOT NULL DEFAULT 0 CHECK (quarantined_count  >= 0),
  current_error       text,
  created_by          uuid        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id)
);

-- One active connection per (org, kind, account) prevents duplicate wiring.
CREATE UNIQUE INDEX uniq_connector_org_kind_account
  ON sales_connector (organization_id, kind, external_account_id)
  WHERE external_account_id IS NOT NULL;

CREATE INDEX ix_connector_org_kind_status
  ON sales_connector (organization_id, kind, status);

CREATE TRIGGER trg_sales_connector_updated
  BEFORE UPDATE ON sales_connector
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT apply_tenant_rls('sales_connector');

-- ---------------------------------------------------------------------
-- 2. lead_submission
--
-- One row per durable external receipt. The partial unique index on
-- (organization_id, connector_id, external_lead_id) is what prevents a
-- replayed webhook from creating two leads (PRD R-DUP-01).
--
-- raw_payload_encrypted is encrypted at rest; retention is 30 days
-- (PRD R-INT-05) and enforced by a scheduled cleanup job that nulls the
-- payload while keeping the audit row.
--
-- outcome enumerates the terminal processing result; outcome_reason
-- carries a human-readable qualifier when a lead was rejected or
-- quarantined.
-- ---------------------------------------------------------------------
CREATE TABLE lead_submission (
  id                     uuid        PRIMARY KEY DEFAULT uuidv7(),
  organization_id        uuid        NOT NULL REFERENCES organization(id),
  connector_id           uuid,
  external_lead_id       text,
  external_form_id       text,
  mapping_version        text,
  provider_submitted_at  timestamptz,
  source_received_at     timestamptz NOT NULL DEFAULT now(),
  first_processed_at     timestamptz,
  raw_payload_encrypted  bytea,
  raw_payload_digest     text,
  normalized_payload     jsonb,
  outcome                text        NOT NULL DEFAULT 'pending'
                           CHECK (outcome IN ('pending', 'created', 'linked_existing', 'duplicate_delivery', 'quarantined', 'rejected', 'failed_retryable')),
  outcome_reason         text,
  lead_id                uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, connector_id) REFERENCES sales_connector (organization_id, id),
  FOREIGN KEY (organization_id, lead_id)      REFERENCES lead             (organization_id, id)
);

-- Idempotency key per PRD R-DUP-01. NULL external_lead_id is allowed
-- (manual, import) but then uniqueness is enforced elsewhere (import
-- row key, manual idempotency key in the service layer).
CREATE UNIQUE INDEX uniq_submission_external_key
  ON lead_submission (organization_id, connector_id, external_lead_id)
  WHERE external_lead_id IS NOT NULL;

CREATE INDEX ix_submission_org_outcome_received
  ON lead_submission (organization_id, outcome, source_received_at DESC);

CREATE INDEX ix_submission_org_lead
  ON lead_submission (organization_id, lead_id)
  WHERE lead_id IS NOT NULL;

-- Retention sweep uses this to find payloads older than 30 days.
CREATE INDEX ix_submission_payload_expiry
  ON lead_submission (source_received_at)
  WHERE raw_payload_encrypted IS NOT NULL;

SELECT apply_tenant_rls('lead_submission');

-- ---------------------------------------------------------------------
-- 3. bid_pool_view
--
-- One row per (lead, agent). Updated in place rather than appended so
-- the fairness dashboard can scan O(agents × open leads) rather than a
-- full history.
--
-- pass_until encodes the 5-minute cooling period (PRD R-FAIR-03). A
-- re-emission of the lead into the agent's pool before pass_until is
-- suppressed by the service layer.
--
-- No set_updated_at trigger: last_seen_at is written explicitly by the
-- service so it reflects user intent, not row touches.
-- ---------------------------------------------------------------------
CREATE TABLE bid_pool_view (
  id                 uuid        PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid        NOT NULL REFERENCES organization(id),
  lead_id            uuid        NOT NULL,
  agent_id           uuid        NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  action             text        NOT NULL DEFAULT 'viewed'
                       CHECK (action IN ('viewed', 'passed', 'claimed')),
  pass_reason        text        CHECK (
                                   (action = 'passed' AND pass_reason IS NOT NULL)
                                   OR (action <> 'passed')
                                 ),
  pass_until         timestamptz CHECK (
                                   (action = 'passed' AND pass_until IS NOT NULL)
                                   OR (action <> 'passed')
                                 ),
  UNIQUE (organization_id, lead_id, agent_id),
  FOREIGN KEY (organization_id, lead_id)  REFERENCES lead     (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, agent_id) REFERENCES app_user (organization_id, id)
);

CREATE INDEX ix_bidview_org_lead_action
  ON bid_pool_view (organization_id, lead_id, action);

CREATE INDEX ix_bidview_org_agent_action
  ON bid_pool_view (organization_id, agent_id, action);

-- Supports the pass-cooling re-emission guard.
CREATE INDEX ix_bidview_org_agent_passuntil
  ON bid_pool_view (organization_id, agent_id, pass_until)
  WHERE action = 'passed';

SELECT apply_tenant_rls('bid_pool_view');

-- ---------------------------------------------------------------------
-- 4. sales_routing_decision
--
-- Audit log for every routing decision: which mode fired, what the
-- candidate list looked like, what the result was and why. Essential
-- for debugging fairness complaints and for the Supervisor
-- claims-distribution dashboard (PRD R-FAIR-04).
--
-- Append-only; no updated_at.
-- ---------------------------------------------------------------------
CREATE TABLE sales_routing_decision (
  id                 uuid        PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid        NOT NULL REFERENCES organization(id),
  lead_id            uuid        NOT NULL,
  mode               text        NOT NULL
                       CHECK (mode IN ('bidding', 'direct', 'fallback', 'reassignment', 'triage_rescue')),
  rules_version      text,
  candidate_snapshot jsonb,
  result             jsonb,
  reason             text,
  actor_id           uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, lead_id)  REFERENCES lead     (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, actor_id) REFERENCES app_user (organization_id, id)
);

CREATE INDEX ix_routingdec_org_lead_created
  ON sales_routing_decision (organization_id, lead_id, created_at DESC);

CREATE INDEX ix_routingdec_org_mode_created
  ON sales_routing_decision (organization_id, mode, created_at DESC);

SELECT apply_tenant_rls('sales_routing_decision');

-- ---------------------------------------------------------------------
-- 5. Grants
--
-- Writes to lead_submission and sales_routing_decision happen from the
-- intake / bidding services; writes to bid_pool_view happen from the
-- bidding service only. sales_connector is written by admin UIs and by
-- the health workers that keep status, counts and cursor fresh.
--
-- DELETE is not granted: lead_submission payload cleanup uses UPDATE
-- (null the payload column) rather than a row delete so the audit
-- trail survives retention.
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE
  ON sales_connector, lead_submission, bid_pool_view, sales_routing_decision
  TO tapcrm_app;

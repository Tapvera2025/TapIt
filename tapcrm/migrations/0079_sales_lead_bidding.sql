-- =====================================================================
-- 0076 — Sales: Lead bidding, attribution, and lifecycle split
--
-- Extends the lead table so the bidding pool (PRD v1.1 §8), split
-- attribution (§13.1) and the separated lifecycle dimensions (§9) can
-- live alongside the legacy single-status column during the R1 cutover.
--
-- See R0 implementation plan step 0.2.
--
-- Design notes:
--   * The existing routing_status column stays binary ('assigned',
--     'unrouted') to keep the existing CHECK constraint intact and
--     callers on the legacy field path working. The richer bidding
--     sub-state lives in the new bid_state column; they are kept
--     consistent by the service layer, not by a DB-level constraint,
--     so legacy writers do not have to learn the new states.
--
--   * lead_stage and lead_outcome split what was conflated in the old
--     status enum. status is kept and still written by legacy code; the
--     new fields are populated by both intake and legacy writes via a
--     service-layer reconciler. Later cutover (post-R1) can drop
--     status, but not in this migration.
--
--   * originating_agent_id is the person credited with sourcing the
--     lead (the first claimer, or the entering agent for outbound).
--     It is separate from owner_id and current_holder_id so sourcing
--     credit survives handovers, reassignments and transfers (PRD
--     §13.1 R-DEAL-02, §19B.5).
--
-- Backfill: originating_agent_id defaults to owner_id for existing
-- rows; lead_stage and lead_outcome are derived from status per PRD
-- §9.2 migration map.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. New columns
-- ---------------------------------------------------------------------
ALTER TABLE lead
  ADD COLUMN entry_method text NOT NULL DEFAULT 'manual'
    CHECK (entry_method IN ('manual', 'website', 'provider_webhook', 'provider_poll', 'import', 'partner_api')),

  ADD COLUMN direction text NOT NULL DEFAULT 'inbound'
    CHECK (direction IN ('inbound', 'outbound')),

  ADD COLUMN originating_agent_id uuid,

  ADD COLUMN claimed_at timestamptz,

  ADD COLUMN bid_state text NOT NULL DEFAULT 'none'
    CHECK (bid_state IN ('none', 'pool_open', 'claimed', 'triage', 'fallback_assigned')),

  ADD COLUMN bid_pool_opened_at timestamptz,
  ADD COLUMN bid_pool_expires_at timestamptz,

  ADD COLUMN sla_first_contact_due_at timestamptz,

  ADD COLUMN lead_stage text NOT NULL DEFAULT 'new'
    CHECK (lead_stage IN ('new', 'contacted', 'discovery', 'qualified')),

  ADD COLUMN lead_outcome text NOT NULL DEFAULT 'active'
    CHECK (lead_outcome IN ('active', 'nurture', 'converted', 'closed_lost', 'archived')),

  ADD COLUMN qualified_at timestamptz,
  ADD COLUMN converted_at timestamptz;

-- ---------------------------------------------------------------------
-- 2. Composite tenant-scoped FK for originating_agent_id
-- ---------------------------------------------------------------------
ALTER TABLE lead
  ADD CONSTRAINT fk_lead_originating_agent
    FOREIGN KEY (organization_id, originating_agent_id)
    REFERENCES app_user (organization_id, id);

-- ---------------------------------------------------------------------
-- 3. Bid-state / bid-pool consistency guard
--
-- Only enforce the minimum required to prevent nonsense states:
--   * pool_open requires both pool timestamps.
--   * claimed and fallback_assigned require claimed_at.
--   * triage and none have no timestamp requirement.
-- Owner / holder constraints stay governed by the existing
-- routing_status CHECK so legacy writes remain valid.
-- ---------------------------------------------------------------------
ALTER TABLE lead
  ADD CONSTRAINT ck_lead_bid_state_timestamps
    CHECK (
      (bid_state = 'pool_open'
         AND bid_pool_opened_at  IS NOT NULL
         AND bid_pool_expires_at IS NOT NULL)
      OR
      (bid_state IN ('claimed', 'fallback_assigned')
         AND claimed_at IS NOT NULL)
      OR
      bid_state IN ('none', 'triage')
    );

-- ---------------------------------------------------------------------
-- 4. Indexes for the bid-pool hot paths
-- ---------------------------------------------------------------------
CREATE INDEX ix_lead_org_bidstate_open
  ON lead (organization_id, bid_pool_expires_at)
  WHERE bid_state = 'pool_open';

CREATE INDEX ix_lead_org_bidstate_triage
  ON lead (organization_id, created_at)
  WHERE bid_state = 'triage';

CREATE INDEX ix_lead_org_originator
  ON lead (organization_id, originating_agent_id)
  WHERE originating_agent_id IS NOT NULL;

CREATE INDEX ix_lead_org_sla_due_active
  ON lead (organization_id, sla_first_contact_due_at)
  WHERE lead_outcome = 'active' AND sla_first_contact_due_at IS NOT NULL;

CREATE INDEX ix_lead_org_outcome_stage
  ON lead (organization_id, lead_outcome, lead_stage);

CREATE INDEX ix_lead_org_entry_method
  ON lead (organization_id, entry_method);

-- ---------------------------------------------------------------------
-- 5. Backfill originating_agent_id from owner_id
--
-- Every assigned lead has an owner; that owner becomes the originator
-- for historical rows. Unassigned leads stay NULL and will be set when
-- the first claim or direct assignment happens.
-- ---------------------------------------------------------------------
UPDATE lead
   SET originating_agent_id = owner_id
 WHERE originating_agent_id IS NULL
   AND owner_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 6. Backfill lead_stage from legacy status (PRD §9.2 map)
-- ---------------------------------------------------------------------
UPDATE lead
   SET lead_stage = CASE status
         WHEN 'new'                 THEN 'new'
         WHEN 'assigned'            THEN 'new'
         WHEN 'contacted'           THEN 'contacted'
         WHEN 'discovery'           THEN 'discovery'
         WHEN 'proposal_sent'       THEN 'discovery'
         WHEN 'follow_up'           THEN 'contacted'
         WHEN 'callback_scheduled'  THEN 'contacted'
         WHEN 'nurture'             THEN 'contacted'
         WHEN 'converted'           THEN 'qualified'
         WHEN 'closed_lost'         THEN 'contacted'
         ELSE 'new'
       END
 WHERE true;

-- ---------------------------------------------------------------------
-- 7. Backfill lead_outcome from legacy status
-- ---------------------------------------------------------------------
UPDATE lead
   SET lead_outcome = CASE status
         WHEN 'nurture'      THEN 'nurture'
         WHEN 'converted'    THEN 'converted'
         WHEN 'closed_lost'  THEN 'closed_lost'
         ELSE 'active'
       END
 WHERE true;

-- ---------------------------------------------------------------------
-- 8. Direction + entry_method backfill from the lead_source relation
--
-- Every legacy lead carries a source_id; use the source's direction
-- as a reasonable default. entry_method stays 'manual' for all old
-- rows because the historical system did not record the ingress route.
-- ---------------------------------------------------------------------
UPDATE lead l
   SET direction = s.direction
  FROM lead_source s
 WHERE s.organization_id = l.organization_id
   AND s.id              = l.source_id;

-- ---------------------------------------------------------------------
-- 9. Fill qualified_at / converted_at where derivable
-- ---------------------------------------------------------------------
UPDATE lead
   SET qualified_at = updated_at
 WHERE lead_stage = 'qualified' AND qualified_at IS NULL;

UPDATE lead
   SET converted_at = updated_at
 WHERE lead_outcome = 'converted' AND converted_at IS NULL;

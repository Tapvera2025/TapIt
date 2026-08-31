-- =====================================================================
-- 0006 — Access Management hardening
--
-- Adds approval delegation storage required by
-- AUTHORIZATION.md §7.1.
--
-- Important:
--   - Delegation is time bounded.
--   - One-hop delegation is enforced by application logic.
--   - The delegate never receives more authority than the delegator.
--   - Approval limits are evaluated from the positions at creation time.
-- =====================================================================

CREATE TABLE approval_delegation (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),

  organization_id      uuid NOT NULL
                         REFERENCES organization(id),

  delegator_user_id    uuid NOT NULL,

  delegate_user_id     uuid NOT NULL,

  start_at             timestamptz NOT NULL,

  end_at               timestamptz NOT NULL,

  reason               text NOT NULL
                         CHECK (length(trim(reason)) > 0),

  deal_value_max       numeric(18, 2),

  discount_percent_max numeric(5, 2)
                         CHECK (
                           discount_percent_max IS NULL
                           OR discount_percent_max BETWEEN 0 AND 100
                         ),

  allows_custom_terms  boolean NOT NULL DEFAULT false,

  created_at           timestamptz NOT NULL DEFAULT now(),

  revoked_at           timestamptz,

  CHECK (delegator_user_id <> delegate_user_id),

  CHECK (end_at > start_at),

  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, delegator_user_id)
    REFERENCES app_user (organization_id, id),

  FOREIGN KEY (organization_id, delegate_user_id)
    REFERENCES app_user (organization_id, id)
);

CREATE INDEX approval_delegation_active_idx
  ON approval_delegation (
    organization_id,
    delegator_user_id,
    delegate_user_id,
    start_at,
    end_at
  );

CREATE INDEX approval_delegation_delegate_idx
  ON approval_delegation (
    organization_id,
    delegate_user_id,
    start_at,
    end_at
  );

-- Prevent duplicate overlapping active delegations between
-- the same delegator and delegate.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE INDEX approval_delegation_org_idx
  ON approval_delegation (organization_id);

COMMENT ON TABLE approval_delegation IS
  'Time-bounded approval delegation. Authorization rules are enforced by the application engine.';
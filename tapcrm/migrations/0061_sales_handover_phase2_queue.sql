-- 0061 — Sales Handover Phase 2 queue support
-- Queue entries remain lead_handover records; this does not create a second
-- Handover table or change permanent Lead ownership.

ALTER TABLE lead_handover
  ADD COLUMN handover_mode text NOT NULL DEFAULT 'direct',
  ADD COLUMN queue_claimed_at timestamptz;

ALTER TABLE lead_handover
  ALTER COLUMN to_user_id DROP NOT NULL;

ALTER TABLE lead_handover
  ADD CONSTRAINT lead_handover_mode_check
    CHECK (handover_mode IN ('direct', 'team_queue')),
  ADD CONSTRAINT lead_handover_receiver_mode_check
    CHECK (handover_mode = 'team_queue' OR to_user_id IS NOT NULL);

CREATE INDEX ix_lead_handover_queue
  ON lead_handover (organization_id, status, handover_mode, offered_at DESC);

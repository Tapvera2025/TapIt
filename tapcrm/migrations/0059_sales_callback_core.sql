-- Callback Phase 1: lifecycle hardening, operational ownership, and reschedule history.

ALTER TABLE lead_callback DROP CONSTRAINT IF EXISTS lead_callback_status_check;
UPDATE lead_callback SET status = 'pending' WHERE status = 'scheduled';

ALTER TABLE lead_callback
  ADD COLUMN outcome text,
  ADD COLUMN parent_callback_id uuid;

ALTER TABLE lead_callback
  ADD CONSTRAINT lead_callback_status_check CHECK (status IN ('pending', 'completed', 'rescheduled', 'not_reachable', 'missed', 'cancelled')),
  ADD CONSTRAINT lead_callback_outcome_check CHECK (outcome IS NULL OR outcome IN ('connected', 'follow_up_required', 'converted', 'not_interested', 'not_reachable', 'other')),
  ADD CONSTRAINT lead_callback_parent_fk FOREIGN KEY (organization_id, parent_callback_id) REFERENCES lead_callback (organization_id, id);

DROP INDEX IF EXISTS ux_lead_callback_scheduled;
CREATE UNIQUE INDEX ux_lead_callback_pending ON lead_callback (organization_id, lead_id) WHERE status = 'pending';
CREATE INDEX ix_lead_callback_parent ON lead_callback (organization_id, parent_callback_id) WHERE parent_callback_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON lead_callback TO tapcrm_app;

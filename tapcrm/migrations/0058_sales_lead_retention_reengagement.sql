ALTER TABLE lead
  ADD COLUMN loss_reason text,
  ADD COLUMN lost_at timestamptz,
  ADD COLUMN previous_lead_id uuid,
  ADD COLUMN phone_normalized text,
  ADD COLUMN email_normalized text;

ALTER TABLE lead
  ADD CONSTRAINT lead_loss_reason_check CHECK (loss_reason IS NULL OR loss_reason IN ('not_interested', 'no_budget', 'no_need', 'competitor', 'unqualified', 'timing', 'duplicate', 'other', 'unspecified')),
  ADD CONSTRAINT lead_previous_lead_fk FOREIGN KEY (organization_id, previous_lead_id) REFERENCES lead (organization_id, id);

UPDATE lead SET phone_normalized = NULLIF(regexp_replace(phone, '[^0-9]', '', 'g'), '') WHERE phone IS NOT NULL;
UPDATE lead SET email_normalized = NULLIF(lower(trim(email::text)), '') WHERE email IS NOT NULL;

CREATE INDEX ix_lead_org_phone_normalized ON lead (organization_id, phone_normalized) WHERE phone_normalized IS NOT NULL;
CREATE INDEX ix_lead_org_email_normalized ON lead (organization_id, email_normalized) WHERE email_normalized IS NOT NULL;
CREATE INDEX ix_lead_org_previous_lead ON lead (organization_id, previous_lead_id) WHERE previous_lead_id IS NOT NULL;

ALTER TABLE lead_activity DROP CONSTRAINT IF EXISTS lead_activity_event_name_check;
ALTER TABLE lead_activity ADD CONSTRAINT lead_activity_event_name_check CHECK (event_name IN ('lead.created', 'lead.assigned', 'lead.status_changed', 'lead.nurtured', 'lead.stalled', 'call.recorded', 'handover.offered', 'handover.accepted', 'handover.declined', 'handover.expired', 'handover.disposition_recorded', 'callback.scheduled', 'callback.rescheduled', 'callback.completed', 'callback.missed', 'callback.cancelled', 'callback.requested', 'deal.creation_requested', 'lead.closed_lost', 'duplicate.warning', 'lead.reengaged'));

-- 0057 — Leads Phase 3 lifecycle, callbacks, and stalled-lead foundation

ALTER TABLE lead ADD COLUMN stalled_at timestamptz;
ALTER TABLE lead ADD COLUMN stalled_reason text;

CREATE TABLE lead_lifecycle_configuration (
  organization_id uuid PRIMARY KEY REFERENCES organization(id),
  stalled_after_days integer NOT NULL DEFAULT 7 CHECK (stalled_after_days BETWEEN 1 AND 365),
  updated_by uuid REFERENCES app_user(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lead_callback (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  lead_id         uuid NOT NULL,
  owner_id        uuid NOT NULL,
  scheduled_at    timestamptz NOT NULL,
  reason          text,
  status          text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'missed', 'cancelled')),
  completed_at    timestamptz,
  missed_at       timestamptz,
  cancelled_at    timestamptz,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, lead_id) REFERENCES lead (organization_id, id),
  FOREIGN KEY (organization_id, owner_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id)
);

CREATE UNIQUE INDEX ux_lead_callback_scheduled ON lead_callback (organization_id, lead_id) WHERE status = 'scheduled';
CREATE INDEX ix_lead_callback_owner_status ON lead_callback (organization_id, owner_id, status, scheduled_at);
CREATE INDEX ix_lead_callback_due ON lead_callback (organization_id, scheduled_at) WHERE status = 'scheduled';
CREATE INDEX ix_lead_stalled ON lead (organization_id, stalled_at, status) WHERE stalled_at IS NOT NULL;

SELECT apply_tenant_rls('lead_lifecycle_configuration');
SELECT apply_tenant_rls('lead_callback');
CREATE TRIGGER trg_lead_lifecycle_configuration_updated BEFORE UPDATE ON lead_lifecycle_configuration FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_lead_callback_updated BEFORE UPDATE ON lead_callback FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE ON lead_lifecycle_configuration, lead_callback TO tapcrm_app;

ALTER TABLE lead_activity DROP CONSTRAINT lead_activity_event_name_check;
ALTER TABLE lead_activity ADD CONSTRAINT lead_activity_event_name_check CHECK (event_name IN (
  'lead.created', 'lead.assigned', 'lead.status_changed', 'lead.nurtured', 'lead.stalled',
  'call.recorded', 'handover.offered', 'handover.accepted', 'handover.declined',
  'handover.expired', 'handover.disposition_recorded', 'callback.scheduled',
  'callback.rescheduled', 'callback.completed', 'callback.missed', 'callback.cancelled',
  'callback.requested', 'deal.creation_requested', 'lead.closed_lost'
));

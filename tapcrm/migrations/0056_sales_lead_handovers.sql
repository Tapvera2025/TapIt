-- 0056 — Leads Phase 2 handover workflow
-- Handover is live-call handling; it never changes lead.owner_id.

CREATE TABLE lead_handover (
  id                         uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id            uuid NOT NULL REFERENCES organization(id),
  lead_id                    uuid NOT NULL,
  from_user_id               uuid NOT NULL,
  to_user_id                 uuid NOT NULL,
  status                     text NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  offered_at                 timestamptz NOT NULL DEFAULT now(),
  accepted_at               timestamptz,
  declined_at               timestamptz,
  expired_at                timestamptz,
  disposition               text CHECK (disposition IN ('accepted', 'rejected', 'callback')),
  disposition_at            timestamptz,
  reason                    text,
  annotations               jsonb NOT NULL DEFAULT '{}'::jsonb,
  time_to_accept_seconds    integer,
  time_to_outcome_seconds   integer,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, lead_id) REFERENCES lead (organization_id, id),
  FOREIGN KEY (organization_id, from_user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, to_user_id) REFERENCES app_user (organization_id, id),
  CHECK ((status = 'accepted' AND accepted_at IS NOT NULL) OR status <> 'accepted'),
  CHECK ((status = 'declined' AND declined_at IS NOT NULL) OR status <> 'declined'),
  CHECK ((status = 'expired' AND expired_at IS NOT NULL) OR status <> 'expired'),
  CHECK ((disposition IS NULL AND disposition_at IS NULL) OR (disposition IS NOT NULL AND disposition_at IS NOT NULL)),
  CHECK ((disposition IS NULL) OR status = 'accepted')
);

CREATE TABLE lead_handover_annotation (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  handover_id     uuid NOT NULL,
  author_id       uuid NOT NULL,
  annotation      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, handover_id) REFERENCES lead_handover (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, author_id) REFERENCES app_user (organization_id, id)
);

CREATE UNIQUE INDEX ux_lead_handover_pending ON lead_handover (organization_id, lead_id) WHERE status = 'pending';
CREATE INDEX ix_lead_handover_lead ON lead_handover (organization_id, lead_id, offered_at DESC);
CREATE INDEX ix_lead_handover_from ON lead_handover (organization_id, from_user_id, status);
CREATE INDEX ix_lead_handover_to ON lead_handover (organization_id, to_user_id, status);
CREATE INDEX ix_lead_handover_annotation ON lead_handover_annotation (organization_id, handover_id, created_at);

SELECT apply_tenant_rls('lead_handover');
SELECT apply_tenant_rls('lead_handover_annotation');

CREATE TRIGGER trg_lead_handover_updated BEFORE UPDATE ON lead_handover FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE ON lead_handover TO tapcrm_app;
GRANT SELECT, INSERT ON lead_handover_annotation TO tapcrm_app;

ALTER TABLE lead_activity DROP CONSTRAINT lead_activity_event_name_check;
ALTER TABLE lead_activity ADD CONSTRAINT lead_activity_event_name_check CHECK (event_name IN (
  'lead.created', 'lead.assigned', 'handover.offered', 'handover.accepted',
  'handover.declined', 'handover.expired', 'handover.disposition_recorded',
  'callback.requested', 'deal.creation_requested', 'lead.closed_lost'
));

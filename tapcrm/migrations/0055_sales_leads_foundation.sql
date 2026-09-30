-- =====================================================================
-- 0055 — Sales Leads foundation
--
-- Phase 1 only: ownership, source/campaign configuration, routing result,
-- lifecycle foundation, and a business activity timeline.
-- =====================================================================

CREATE TABLE lead_source (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  name            text NOT NULL,
  direction       text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, name)
);

CREATE TABLE campaign (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  name            text NOT NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, name)
);

CREATE TABLE lead (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  lead_number       bigint GENERATED ALWAYS AS IDENTITY,
  owner_id          uuid,
  current_holder_id uuid,
  territory_id      uuid,
  sales_team_id     uuid,
  sales_pool_id     uuid,
  source_id         uuid NOT NULL,
  campaign_id       uuid,
  status            text NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new', 'assigned', 'contacted', 'discovery', 'proposal_sent', 'follow_up', 'callback_scheduled', 'nurture', 'converted', 'closed_lost')),
  routing_status    text NOT NULL DEFAULT 'unrouted'
                      CHECK (routing_status IN ('assigned', 'unrouted')),
  contact_name      text NOT NULL,
  company_name      text,
  phone             text,
  email             citext,
  created_by        uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, lead_number),
  FOREIGN KEY (organization_id, owner_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, current_holder_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, territory_id) REFERENCES sales_territories (organization_id, id),
  FOREIGN KEY (organization_id, sales_team_id) REFERENCES team (organization_id, id),
  FOREIGN KEY (organization_id, sales_pool_id) REFERENCES team (organization_id, id),
  FOREIGN KEY (organization_id, source_id) REFERENCES lead_source (organization_id, id),
  FOREIGN KEY (organization_id, campaign_id) REFERENCES campaign (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  CHECK ((routing_status = 'assigned' AND owner_id IS NOT NULL AND current_holder_id IS NOT NULL) OR routing_status = 'unrouted'),
  CHECK (sales_pool_id IS NULL OR sales_team_id IS NOT NULL)
);

CREATE TABLE lead_activity (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  lead_id         uuid NOT NULL,
  event_name      text NOT NULL CHECK (event_name IN ('lead.created', 'lead.assigned')),
  actor_id        uuid,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, lead_id) REFERENCES lead (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, actor_id) REFERENCES app_user (organization_id, id)
);

SELECT apply_tenant_rls('lead_source');
SELECT apply_tenant_rls('campaign');
SELECT apply_tenant_rls('lead');
SELECT apply_tenant_rls('lead_activity');

CREATE TRIGGER trg_lead_source_updated BEFORE UPDATE ON lead_source FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_campaign_updated BEFORE UPDATE ON campaign FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_lead_updated BEFORE UPDATE ON lead FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE ON lead_source, campaign, lead TO tapcrm_app;
GRANT SELECT, INSERT ON lead_activity TO tapcrm_app;

CREATE INDEX ix_lead_org_owner ON lead (organization_id, owner_id);
CREATE INDEX ix_lead_org_holder ON lead (organization_id, current_holder_id);
CREATE INDEX ix_lead_org_status ON lead (organization_id, status, routing_status);
CREATE INDEX ix_lead_org_source ON lead (organization_id, source_id);
CREATE INDEX ix_lead_org_campaign ON lead (organization_id, campaign_id);
CREATE INDEX ix_lead_org_territory ON lead (organization_id, territory_id);
CREATE INDEX ix_lead_org_team_pool ON lead (organization_id, sales_team_id, sales_pool_id);
CREATE INDEX ix_lead_org_phone ON lead (organization_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX ix_lead_org_email ON lead (organization_id, email) WHERE email IS NOT NULL;
CREATE INDEX ix_lead_activity_lead ON lead_activity (organization_id, lead_id, created_at);

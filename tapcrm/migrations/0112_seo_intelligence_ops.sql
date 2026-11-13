-- SEO Intelligence: fix proposals, change events, alerts, reports, audit log.

CREATE TABLE seo_fix_proposals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id       uuid REFERENCES seo_findings(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  target_integration text NOT NULL,
  diff_preview     text,
  tests_description text,
  status           text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_review', 'approved', 'executing', 'executed', 'failed', 'rolled_back', 'rejected')),
  proposed_by      uuid NOT NULL,
  reviewer_id      uuid,
  approved_at      timestamptz,
  execution_result text,
  deployment_link  text,
  rollback_link    text,
  ai_analysis_id   uuid REFERENCES seo_ai_analysis_runs(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE seo_fix_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_fix_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_fix_proposals_tenant ON seo_fix_proposals
  USING (organization_id = current_organization_id());

CREATE TABLE seo_change_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  event_type       text NOT NULL CHECK (event_type IN ('deployment', 'cms_edit', 'pull_request', 'manual')),
  actor_id         uuid,
  affected_url_patterns text[] NOT NULL DEFAULT '{}',
  source           text,
  notes            text,
  event_date       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE seo_change_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_change_events FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_change_events_tenant ON seo_change_events
  USING (organization_id = current_organization_id());

CREATE TABLE seo_alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  trigger_type     text NOT NULL,
  dedup_key        text NOT NULL,
  severity         text NOT NULL CHECK (severity IN ('critical', 'high', 'moderate', 'low')),
  message          text NOT NULL,
  metadata         jsonb NOT NULL DEFAULT '{}',
  acknowledged_at  timestamptz,
  acknowledged_by  uuid,
  delivered_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, dedup_key)
);
ALTER TABLE seo_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_alerts_tenant ON seo_alerts
  USING (organization_id = current_organization_id());
CREATE INDEX seo_alerts_site_unacked ON seo_alerts (site_id, created_at DESC)
  WHERE acknowledged_at IS NULL;

CREATE TABLE seo_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  status           text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'published', 'archived')),
  approved_by      uuid,
  approved_at      timestamptz,
  snapshot_inputs  jsonb NOT NULL DEFAULT '{}',
  export_key       text,
  client_visible   boolean NOT NULL DEFAULT false,
  revision         integer NOT NULL DEFAULT 1,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE seo_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_reports_tenant ON seo_reports
  USING (organization_id = current_organization_id());

CREATE TABLE seo_audit_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  actor_id         uuid,
  action           text NOT NULL,
  object_type      text NOT NULL,
  object_id        uuid,
  before_state     jsonb,
  after_state      jsonb,
  reason           text,
  reviewer_id      uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE seo_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_audit_log_tenant ON seo_audit_log
  USING (organization_id = current_organization_id());
CREATE INDEX seo_audit_log_org_date ON seo_audit_log (organization_id, created_at DESC);
CREATE INDEX seo_audit_log_object ON seo_audit_log (object_type, object_id);

-- Composite indexes per §9.3
CREATE INDEX seo_org_client_site ON seo_sites (organization_id, client_id, id);

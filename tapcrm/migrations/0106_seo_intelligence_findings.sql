-- SEO Intelligence: rules catalog, evaluations, findings, root-cause groups.

CREATE TABLE seo_rules (
  rule_id          text NOT NULL,
  rule_version     text NOT NULL DEFAULT 'v1',
  group_code       text NOT NULL,
  severity         text NOT NULL CHECK (severity IN ('critical', 'high', 'moderate', 'low', 'informational')),
  applicability    text NOT NULL,
  result_schema    jsonb NOT NULL DEFAULT '{}',
  remediation_tmpl text,
  verification_tmpl text,
  active           boolean NOT NULL DEFAULT true,
  tested           boolean NOT NULL DEFAULT false,
  disabled_reason  text,
  introduced_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, rule_version)
);

-- 120 candidate rules seeded here at activation time; initially all untested/inactive.
-- CI-9 equivalent: tests must pass before active=true is set.

CREATE TABLE seo_rule_evaluations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_run_id      uuid NOT NULL REFERENCES seo_scan_runs(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  page_obs_id      uuid REFERENCES seo_page_observations(id) ON DELETE CASCADE,
  rule_id          text NOT NULL,
  rule_version     text NOT NULL,
  result           text NOT NULL CHECK (result IN ('pass', 'fail', 'review', 'skipped', 'unknown')),
  severity         text NOT NULL CHECK (severity IN ('critical', 'high', 'moderate', 'low', 'informational')),
  confidence       text NOT NULL DEFAULT 'direct'
    CHECK (confidence IN ('direct', 'corroborated', 'inferred', 'unknown')),
  affected_target  text,
  evidence         jsonb NOT NULL DEFAULT '{}',
  proposed_fix     text,
  evaluated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE seo_rule_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_rule_evaluations FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_rule_evals_tenant ON seo_rule_evaluations
  USING (organization_id = current_organization_id());
CREATE INDEX seo_rule_evals_run ON seo_rule_evaluations (scan_run_id);
CREATE INDEX seo_rule_evals_rule ON seo_rule_evaluations (scan_run_id, rule_id, result);

CREATE TABLE seo_findings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  rule_id          text NOT NULL,
  rule_version     text NOT NULL,
  -- Stable signature for recurrence detection
  signature        text NOT NULL,
  affected_target  text NOT NULL,
  status           text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'assigned', 'in_progress', 'ready_for_verification',
                      'verified_resolved', 'accepted_exception', 'false_positive',
                      'unverifiable', 'reopened')),
  severity         text NOT NULL CHECK (severity IN ('critical', 'high', 'moderate', 'low', 'informational')),
  confidence       text NOT NULL CHECK (confidence IN ('direct', 'corroborated', 'inferred', 'unknown')),
  priority_score   numeric(5,2),
  assigned_to      uuid,
  first_seen_run   uuid NOT NULL REFERENCES seo_scan_runs(id),
  latest_run       uuid NOT NULL REFERENCES seo_scan_runs(id),
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolution_run   uuid REFERENCES seo_scan_runs(id),
  UNIQUE (site_id, signature)
);
ALTER TABLE seo_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_findings FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_findings_tenant ON seo_findings
  USING (organization_id = current_organization_id());
CREATE INDEX seo_findings_site_status ON seo_findings (site_id, status, priority_score DESC);
CREATE INDEX seo_findings_site_rule ON seo_findings (site_id, rule_id);

CREATE TABLE seo_finding_instances (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id       uuid NOT NULL REFERENCES seo_findings(id) ON DELETE CASCADE,
  scan_run_id      uuid NOT NULL REFERENCES seo_scan_runs(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  affected_url     text NOT NULL,
  evidence         jsonb NOT NULL DEFAULT '{}',
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (finding_id, scan_run_id, affected_url)
);
ALTER TABLE seo_finding_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_finding_instances FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_finding_instances_tenant ON seo_finding_instances
  USING (organization_id = current_organization_id());
CREATE INDEX seo_finding_instances_finding ON seo_finding_instances (finding_id);
CREATE INDEX seo_finding_instances_run ON seo_finding_instances (scan_run_id);

CREATE TABLE seo_root_cause_groups (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  hypothesis       text NOT NULL,
  template_sig     text,
  evidence_quality text NOT NULL DEFAULT 'inferred'
    CHECK (evidence_quality IN ('direct', 'corroborated', 'inferred', 'unknown')),
  owner_id         uuid,
  confidence_class text NOT NULL DEFAULT 'possible'
    CHECK (confidence_class IN ('confirmed', 'probable', 'possible', 'speculative')),
  dismissed        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE seo_root_cause_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_root_cause_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_root_cause_groups_tenant ON seo_root_cause_groups
  USING (organization_id = current_organization_id());

CREATE TABLE seo_root_cause_members (
  group_id    uuid NOT NULL REFERENCES seo_root_cause_groups(id) ON DELETE CASCADE,
  finding_id  uuid NOT NULL REFERENCES seo_findings(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, finding_id)
);

CREATE TABLE seo_issue_exceptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id       uuid REFERENCES seo_findings(id) ON DELETE CASCADE,
  rule_id          text,
  scope_url        text,
  organization_id  uuid NOT NULL,
  reason           text NOT NULL,
  approved_by      uuid NOT NULL,
  approved_at      timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz,
  revoked_at       timestamptz,
  revoked_by       uuid
);
ALTER TABLE seo_issue_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_issue_exceptions FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_issue_exceptions_tenant ON seo_issue_exceptions
  USING (organization_id = current_organization_id());

CREATE TABLE seo_tasks_bridge (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id       uuid REFERENCES seo_findings(id) ON DELETE CASCADE,
  group_id         uuid REFERENCES seo_root_cause_groups(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  crm_task_id      uuid NOT NULL,
  owner_id         uuid,
  sync_status      text NOT NULL DEFAULT 'active'
    CHECK (sync_status IN ('active', 'completed', 'unlinked')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE seo_tasks_bridge ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_tasks_bridge FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_tasks_bridge_tenant ON seo_tasks_bridge
  USING (organization_id = current_organization_id());

-- SEO Intelligence: AI visibility prompt sets, observations, analysis runs.

CREATE TABLE seo_ai_prompt_sets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  name             text NOT NULL,
  brand_aliases    text[] NOT NULL DEFAULT '{}',
  platforms        text[] NOT NULL DEFAULT '{}',
  locale           text NOT NULL DEFAULT 'en-US',
  language         text NOT NULL DEFAULT 'en',
  cadence          text NOT NULL DEFAULT 'weekly'
    CHECK (cadence IN ('manual', 'daily', 'weekly', 'monthly')),
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE seo_ai_prompt_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_ai_prompt_sets FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_ai_prompt_sets_tenant ON seo_ai_prompt_sets
  USING (organization_id = current_organization_id());

CREATE TABLE seo_ai_prompts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_set_id    uuid NOT NULL REFERENCES seo_ai_prompt_sets(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  prompt_text      text NOT NULL,
  intent           text,
  version          integer NOT NULL DEFAULT 1,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE seo_ai_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_ai_prompts FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_ai_prompts_tenant ON seo_ai_prompts
  USING (organization_id = current_organization_id());

CREATE TABLE seo_ai_observations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id           uuid NOT NULL REFERENCES seo_ai_prompts(id) ON DELETE CASCADE,
  site_id             uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  organization_id     uuid NOT NULL,
  provider            text NOT NULL,
  platform            text NOT NULL,
  locale              text NOT NULL,
  -- The answer pointer — do NOT store full AI answers in this table
  answer_blob_id      uuid REFERENCES seo_evidence_blobs(id),
  -- Extracted facts from the answer
  brand_mentioned     boolean,
  domain_cited        boolean,
  citation_urls       text[] NOT NULL DEFAULT '{}',
  competitor_mentions jsonb NOT NULL DEFAULT '[]',
  -- Coverage / completeness
  state               text NOT NULL DEFAULT 'success'
    CHECK (state IN ('success', 'partial', 'no_answer', 'failed', 'quota_exhausted', 'budget_blocked')),
  -- Denominator is explicit: only successful comparable observations count
  provider_request_id uuid REFERENCES seo_provider_requests(id),
  observed_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE seo_ai_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_ai_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_ai_observations_tenant ON seo_ai_observations
  USING (organization_id = current_organization_id());
CREATE INDEX seo_ai_obs_prompt_date ON seo_ai_observations (prompt_id, observed_at DESC);
CREATE INDEX seo_ai_obs_site_date ON seo_ai_observations (site_id, observed_at DESC);

CREATE TABLE seo_ai_analysis_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id       uuid REFERENCES seo_findings(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  evidence_ids     uuid[] NOT NULL DEFAULT '{}',
  model_id         text NOT NULL,
  model_version    text,
  policy_version   text NOT NULL,
  -- Structured output (JSON-schema validated)
  analysis         jsonb NOT NULL DEFAULT '{}',
  schema_valid     boolean NOT NULL DEFAULT false,
  token_count      integer,
  compute_cost_usd numeric(10,6),
  requires_review  boolean NOT NULL DEFAULT true,
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE seo_ai_analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_ai_analysis_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_ai_analysis_runs_tenant ON seo_ai_analysis_runs
  USING (organization_id = current_organization_id());

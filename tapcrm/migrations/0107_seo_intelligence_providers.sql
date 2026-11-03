-- SEO Intelligence: provider connections, usage metering, request log, evidence blobs.

CREATE TABLE seo_provider_connections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  provider            text NOT NULL,
  delegated_account   text,
  property_ids        text[] NOT NULL DEFAULT '{}',
  scope               text[] NOT NULL DEFAULT '{}',
  status              text NOT NULL DEFAULT 'not_connected'
    CHECK (status IN ('not_connected', 'pending_approval', 'connected', 'revoked', 'error')),
  -- Encrypted reference only; raw secrets never stored here.
  secret_ref          text,
  last_checked_at     timestamptz,
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider)
);
ALTER TABLE seo_provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_provider_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_provider_connections_tenant ON seo_provider_connections
  USING (organization_id = current_organization_id());

CREATE TABLE seo_provider_usage (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,
  client_id           uuid,
  provider            text NOT NULL,
  endpoint            text NOT NULL,
  month               text NOT NULL,  -- YYYY-MM
  units_used          integer NOT NULL DEFAULT 0,
  units_limit         integer,
  estimated_usd       numeric(10,4) NOT NULL DEFAULT 0,
  actual_usd          numeric(10,4),
  budget_outcome      text NOT NULL DEFAULT 'within_budget'
    CHECK (budget_outcome IN ('within_budget', 'warning_70', 'warning_90', 'cap_reached', 'overrun')),
  pricing_version     text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider, endpoint, month)
);
ALTER TABLE seo_provider_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_provider_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_provider_usage_tenant ON seo_provider_usage
  USING (organization_id = current_organization_id());

CREATE TABLE seo_provider_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,
  idempotency_key     text UNIQUE,
  provider            text NOT NULL,
  endpoint            text NOT NULL,
  normalized_request  jsonb NOT NULL DEFAULT '{}',
  outcome             text NOT NULL CHECK (outcome IN ('success', 'partial', 'failed', 'quota_exhausted', 'budget_blocked')),
  units               integer,
  estimated_usd       numeric(10,4),
  actual_usd          numeric(10,4),
  pricing_version     text,
  request_id          text,
  provider_metadata   jsonb NOT NULL DEFAULT '{}',
  requested_at        timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  error_code          text
);
ALTER TABLE seo_provider_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_provider_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_provider_requests_tenant ON seo_provider_requests
  USING (organization_id = current_organization_id());
CREATE INDEX seo_provider_requests_org_provider ON seo_provider_requests (organization_id, provider, requested_at DESC);
CREATE INDEX seo_provider_requests_idempotency ON seo_provider_requests (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE seo_evidence_blobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  content_hash     text NOT NULL,
  capture_mode     text NOT NULL CHECK (capture_mode IN ('raw_html', 'rendered_html', 'screenshot', 'ai_answer', 'headers')),
  storage_key      text NOT NULL,
  byte_size        integer,
  encrypted        boolean NOT NULL DEFAULT true,
  visibility       text NOT NULL DEFAULT 'internal'
    CHECK (visibility IN ('internal', 'team', 'client')),
  expires_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, content_hash, capture_mode)
);
ALTER TABLE seo_evidence_blobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_evidence_blobs FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_evidence_blobs_tenant ON seo_evidence_blobs
  USING (organization_id = current_organization_id());

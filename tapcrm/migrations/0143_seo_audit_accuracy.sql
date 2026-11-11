-- =====================================================================
-- 0143 — SEO checkups: accurate findings and controlled spending
--
-- 1. A rendered page keeps what its raw HTML said (raw_signals), so C008
--    compares the canonical and robots directives JavaScript changed rather
--    than two hashes that always differ.
-- 2. Paid data sources get per-site monthly allowances. Google searches
--    (SerpApi) already had one; AI Overview checks now spend from it too, so
--    a search request no longer always belongs to a tracked keyword.
--    Perplexity answers and Moz backlink lookups get their own allowance and
--    a call log. Every allowance starts at 0: nothing is spent until an
--    administrator approves a number.
-- 3. The rule catalogue each organization sees follows the corrected rules:
--    a matching title and H1 is informational, a missing x-default is low,
--    a short page is a moderate review item, and the two checks the crawler
--    cannot measure (image file size, schema/content mismatch) show as
--    unavailable instead of "included".
-- 4. Search terms harvested from Search Console were all tracked, which
--    queued hundreds of paid position checks per site. They become
--    suggestions; the next harvest tracks the strongest ten for sites that
--    track nothing.
-- =====================================================================

ALTER TABLE seo_page_observations ADD COLUMN raw_signals jsonb;

ALTER TABLE seo_serp_search_request ALTER COLUMN keyword_id DROP NOT NULL;
ALTER TABLE seo_serp_search_request
  ADD COLUMN purpose text NOT NULL DEFAULT 'rank' CHECK (purpose IN ('rank', 'ai_overview'));
ALTER TABLE seo_serp_search_request
  ADD CONSTRAINT seo_serp_request_keyword_check CHECK ((purpose = 'rank') = (keyword_id IS NOT NULL));

CREATE TABLE seo_provider_allowance (
  organization_id uuid NOT NULL,
  site_id         uuid NOT NULL,
  provider        text NOT NULL CHECK (provider IN ('perplexity', 'moz')),
  monthly_limit   integer NOT NULL DEFAULT 0 CHECK (monthly_limit BETWEEN 0 AND 100000),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, site_id, provider),
  FOREIGN KEY (organization_id, site_id) REFERENCES seo_sites(organization_id, id) ON DELETE CASCADE
);
SELECT apply_tenant_rls('seo_provider_allowance');

CREATE TABLE seo_provider_call (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  site_id         uuid NOT NULL,
  provider        text NOT NULL CHECK (provider IN ('perplexity', 'moz')),
  purpose         text NOT NULL,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, site_id) REFERENCES seo_sites(organization_id, id) ON DELETE CASCADE
);
SELECT apply_tenant_rls('seo_provider_call');
CREATE INDEX seo_provider_call_month ON seo_provider_call (organization_id, site_id, provider, requested_at);

UPDATE registry_seo_rule SET severity = 'moderate' WHERE rule_id = 'T001';
UPDATE registry_seo_rule SET severity = 'informational' WHERE rule_id = 'T004';
UPDATE registry_seo_rule SET severity = 'low' WHERE rule_id = 'G002';
UPDATE registry_seo_rule SET tested = false WHERE rule_id IN ('A003', 'D009');

UPDATE seo_keywords k SET tracked = false
FROM seo_keyword_sets s
WHERE s.id = k.set_id AND s.organization_id = k.organization_id
  AND s.name = 'GSC Harvest' AND k.tracked = true;

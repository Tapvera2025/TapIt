-- Persist fairness caps alongside the routing strategy so a tenant can
-- tune per-agent limits without a code deploy. R1 shipped
-- loadFairnessConfig() returning module defaults; this table now owns
-- the truth, and the service falls back to the defaults when no row
-- or no override exists.

ALTER TABLE sales_routing_configuration
  ADD COLUMN IF NOT EXISTS active_lead_max integer,
  ADD COLUMN IF NOT EXISTS daily_claim_max integer;

ALTER TABLE sales_routing_configuration
  ADD CONSTRAINT sales_routing_configuration_active_lead_max_check
    CHECK (active_lead_max IS NULL OR active_lead_max BETWEEN 1 AND 1000),
  ADD CONSTRAINT sales_routing_configuration_daily_claim_max_check
    CHECK (daily_claim_max IS NULL OR daily_claim_max BETWEEN 1 AND 1000);

COMMENT ON COLUMN sales_routing_configuration.active_lead_max IS
  'Per-agent cap on simultaneously-open leads; NULL falls back to module default (20).';
COMMENT ON COLUMN sales_routing_configuration.daily_claim_max IS
  'Per-agent cap on claims per operational day; NULL means uncapped.';

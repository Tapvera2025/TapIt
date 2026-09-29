-- =====================================================================
-- 0053 — Sales routing configuration
--
-- Routing configuration is independent of territory count. A tenant may have
-- no territories and still use the global eligible-agent fallback.
-- =====================================================================

CREATE TABLE sales_routing_configuration (
  organization_id    uuid PRIMARY KEY REFERENCES organization(id),
  enabled            boolean NOT NULL DEFAULT true,
  assignment_strategy text NOT NULL DEFAULT 'fewest_open_leads'
                       CHECK (assignment_strategy IN ('fewest_open_leads', 'round_robin', 'manual_queue')),
  updated_by         uuid NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, updated_by)
    REFERENCES app_user (organization_id, id)
);

SELECT apply_tenant_rls('sales_routing_configuration');

CREATE TRIGGER trg_sales_routing_configuration_updated
  BEFORE UPDATE ON sales_routing_configuration
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE ON sales_routing_configuration TO tapcrm_app;

-- Payment webhook journal rows may be unresolved (organization_id IS NULL),
-- but nullable tenant keys still require the same isolation as other records.
-- The runtime role may read only its own tenant's resolved events; rows for
-- other tenants or without a tenant remain invisible. Existing read-only
-- runtime grants and privileged migration access are unchanged.
SELECT apply_tenant_rls('payment_webhook_event');

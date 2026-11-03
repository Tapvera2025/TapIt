-- Standalone audits belong to an organization without requiring a CRM client.
-- Keep the composite tenant/client foreign key for sites that are linked.
ALTER TABLE seo_sites ALTER COLUMN client_id DROP NOT NULL;

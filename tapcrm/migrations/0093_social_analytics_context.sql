-- Retain native reporting context and per-post results without inventing metrics.
ALTER TABLE social_analytics_snapshot ADD COLUMN post_id uuid,
  ADD COLUMN note text,
  ADD COLUMN series jsonb NOT NULL DEFAULT '[]',
  ADD CONSTRAINT social_analytics_post_fk FOREIGN KEY (organization_id,client_id,post_id)
    REFERENCES social_post(organization_id,client_id,id);
CREATE INDEX ix_social_analytics_post ON social_analytics_snapshot(organization_id,client_id,post_id);
-- Approval and audit histories are immutable through the runtime role.
REVOKE UPDATE, DELETE ON social_approval, social_audit_log FROM tapcrm_app;

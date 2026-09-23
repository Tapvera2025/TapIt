ALTER TABLE role_change_request
  ADD COLUMN requested_reports_to uuid;

ALTER TABLE role_change_request
  ADD CONSTRAINT fk_role_change_requested_reports_to
  FOREIGN KEY (organization_id, requested_reports_to)
  REFERENCES app_user (organization_id, id);

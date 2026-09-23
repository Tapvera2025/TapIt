ALTER TABLE role_change_request
  ADD COLUMN requested_team_id uuid;

ALTER TABLE role_change_request
  ADD CONSTRAINT fk_role_change_requested_team
  FOREIGN KEY (organization_id, requested_team_id)
  REFERENCES team (organization_id, id);

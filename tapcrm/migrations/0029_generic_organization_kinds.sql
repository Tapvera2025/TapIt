-- Organization kinds are extensible metadata, not a fixed Sales/Delivery taxonomy.
-- Existing values remain valid; future departments and teams may use their own
-- generic kind labels without changing the schema.
ALTER TABLE department DROP CONSTRAINT IF EXISTS department_kind_check;
ALTER TABLE team DROP CONSTRAINT IF EXISTS team_kind_check;

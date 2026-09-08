-- =====================================================================
-- 0024 - Pre-authentication identity email directory
--
-- Login begins with email, before a tenant context exists. This small global
-- directory resolves the tenant and user id; app_user remains authoritative
-- and is still read through tenant RLS after the directory lookup.
-- =====================================================================

CREATE TABLE identity_email_directory (
  email           citext PRIMARY KEY,
  user_id         uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES organization(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);

INSERT INTO identity_email_directory(email, user_id, organization_id)
SELECT email, id, organization_id
FROM app_user
WHERE email IS NOT NULL;

CREATE OR REPLACE FUNCTION sync_identity_email_directory() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM identity_email_directory
    WHERE organization_id = OLD.organization_id AND user_id = OLD.id;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND (
    OLD.email IS DISTINCT FROM NEW.email OR
    OLD.organization_id IS DISTINCT FROM NEW.organization_id
  ) THEN
    DELETE FROM identity_email_directory
    WHERE organization_id = OLD.organization_id AND user_id = OLD.id;
  END IF;

  IF NEW.email IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM identity_email_directory
      WHERE email = NEW.email
        AND NOT (user_id = NEW.id AND organization_id = NEW.organization_id)
    ) THEN
      RAISE EXCEPTION 'Email is already assigned to another identity'
        USING ERRCODE = '23505';
    END IF;

    INSERT INTO identity_email_directory(email, user_id, organization_id)
    VALUES (NEW.email, NEW.id, NEW.organization_id)
    ON CONFLICT (email) DO UPDATE
      SET updated_at = now();
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER trg_app_user_identity_email_directory
  AFTER INSERT OR UPDATE OF email, organization_id OR DELETE ON app_user
  FOR EACH ROW
  EXECUTE FUNCTION sync_identity_email_directory();

GRANT SELECT, INSERT, UPDATE, DELETE ON identity_email_directory TO tapcrm_app;

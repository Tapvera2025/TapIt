-- =====================================================================
-- 0017 - Global CRM identity email uniqueness
--
-- ID-1: a CRM email belongs to one app_user globally, regardless of tenant
-- or account type. citext keeps the comparison case-insensitive.
-- =====================================================================

-- Existing development data was created before ID-1 and can contain the same
-- Super Admin email in multiple companies. The organization owner email is the
-- existing source of truth for those records; use it only when it is not
-- already claimed by another app_user.
WITH duplicate_emails AS (
  SELECT lower(email) AS email
  FROM app_user
  WHERE email IS NOT NULL
  GROUP BY lower(email)
  HAVING count(*) > 1
)
UPDATE app_user u
SET email = lower(o.owner_email)
FROM organization o, duplicate_emails d
WHERE u.organization_id = o.id
  AND lower(u.email) = d.email
  AND u.account_type = 'super-admin'
  AND lower(o.owner_email) <> lower(u.email)
  AND NOT EXISTS (
    SELECT 1
    FROM app_user existing
    WHERE lower(existing.email) = lower(o.owner_email)
      AND existing.id <> u.id
  );

DROP INDEX IF EXISTS ux_user_org_email;

CREATE UNIQUE INDEX ux_app_user_email_global
  ON app_user (email)
  WHERE email IS NOT NULL;

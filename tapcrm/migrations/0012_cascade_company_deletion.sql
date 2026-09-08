-- =====================================================================
-- 0012 — Cascade deletion for tenant-owned company data
-- =====================================================================
-- Tenant tables carry organization_id. Their internal foreign keys must also
-- cascade so deleting an organization cannot leave dependent tenant records.
-- Platform users, platform sessions, and the shared module catalog are kept.
DO $migration$
DECLARE
  fk record;
  definition text;
BEGIN
  FOR fk IN
    SELECT c.oid, c.conname, c.conrelid::regclass AS table_name
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND EXISTS (
        SELECT 1
        FROM pg_attribute a
        WHERE a.attrelid = c.conrelid
          AND a.attname = 'organization_id'
          AND NOT a.attisdropped
      )
      AND c.confrelid NOT IN ('platform_user'::regclass, 'module'::regclass)
  LOOP
    definition := regexp_replace(
      pg_get_constraintdef(fk.oid),
      '\s+ON (DELETE|UPDATE)\s+(NO ACTION|CASCADE|RESTRICT|SET NULL|SET DEFAULT)',
      '',
      'gi'
    );
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.table_name, fk.conname);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I %s ON DELETE CASCADE',
      fk.table_name,
      fk.conname,
      definition
    );
  END LOOP;
END
$migration$;

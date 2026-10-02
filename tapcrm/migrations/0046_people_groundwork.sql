-- =====================================================================
-- 0046 - People groundwork (attendance design, step 0)
-- =====================================================================

-- ---------------------------------------------------------------------
-- btree_gist, for the "no two periods overlap" constraints that shift
-- assignments, PIN mappings and salary structures use from step 1 on
-- (EXCLUDE USING gist with plain equality columns beside a daterange).
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------
-- PRD §5.8 dependency column for the People modules. Enabling a module
-- enables its whole closure (platform/modules/service.ts), so enabling
-- payroll also enables attendance, leave, break-management and shifts.
-- ---------------------------------------------------------------------
INSERT INTO module_dependency (module_id, depends_on_module_id)
SELECT m.id, d.id
FROM (VALUES
  ('live-status',      'attendance'),
  ('attendance',       'shifts'),
  ('break-management', 'attendance'),
  ('biometric',        'attendance'),
  ('leave',            'attendance'),
  ('holidays',         'shifts'),
  ('payroll',          'attendance'),
  ('payroll',          'leave'),
  ('payroll',          'break-management')
) AS dep(module_key, depends_on_key)
JOIN module m ON m.key = dep.module_key
JOIN module d ON d.key = dep.depends_on_key
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- Domain outbox drainer (design §5.5, TX-2, D22).
--
-- claimed_until: a drainer claims a batch for a short lease, publishes it
-- outside any transaction, then marks it processed. A crashed drainer's
-- claim simply lapses, so delivery is at least once and never lost.
-- ---------------------------------------------------------------------
ALTER TABLE domain_outbox ADD COLUMN claimed_until timestamptz;

-- NOTIFY is delivered when the inserting transaction commits, so a drainer
-- waiting on LISTEN wakes as soon as an event is safe to publish.
CREATE OR REPLACE FUNCTION notify_domain_outbox() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  PERFORM pg_notify('domain_outbox', NEW.organization_id::text);
  RETURN NULL;
END
$$;

CREATE TRIGGER domain_outbox_notify
  AFTER INSERT ON domain_outbox
  FOR EACH ROW EXECUTE FUNCTION notify_domain_outbox();

-- ---------------------------------------------------------------------
-- Job runs (design §5.4, JB-1 to JB-4). One row per job, organization and
-- idempotency key; a retry of the same key updates the same row.
-- ---------------------------------------------------------------------
ALTER TABLE job_run
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN dead_lettered_at timestamptz;

-- =====================================================================
-- 0161 — One project per delivery brief, and one brief per project
--
-- A brief already links to at most one project (R-DEL-04), but nothing
-- stopped the same project being linked to several briefs, so one project
-- could silently absorb another deal's delivery. The service now refuses it;
-- this unique index is the final guard.
--
-- Existing data with a project already shared by several briefs would make
-- the index fail, and a failed migration blocks the whole deploy. In that
-- case the index is skipped with a warning naming the projects, so they can
-- be untangled and the index created by hand; the service check applies
-- either way.
-- =====================================================================

DO $$
DECLARE
  shared text;
BEGIN
  SELECT string_agg(format('%s/%s (%s briefs)', organization_id, project_id, n), ', ')
    INTO shared
    FROM (
      SELECT organization_id, project_id, count(*) AS n
        FROM delivery_brief
       WHERE project_id IS NOT NULL
       GROUP BY organization_id, project_id
      HAVING count(*) > 1
    ) d;

  IF shared IS NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS ux_delivery_brief_project
      ON delivery_brief (organization_id, project_id)
      WHERE project_id IS NOT NULL;
  ELSE
    RAISE WARNING 'ux_delivery_brief_project not created: projects linked to several delivery briefs: %', shared;
  END IF;
END
$$;

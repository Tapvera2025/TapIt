-- When the current owner got the lead.
--
-- My Work shows a lead that was just handed to someone so they make first
-- contact, even when it is past the first steps (PRD R-REASSIGN-04: the new
-- owner receives the lead in My Work). A trigger keeps it current on every
-- path that changes the owner: creation, claim, routing, triage rescue and
-- reassignment.

ALTER TABLE lead ADD COLUMN assigned_at timestamptz;

-- The latest reassignment if there was one, otherwise when the lead was
-- claimed or created.
UPDATE lead l
   SET assigned_at = COALESCE(
         (SELECT max(d.created_at)
            FROM sales_routing_decision d
           WHERE d.organization_id = l.organization_id
             AND d.lead_id         = l.id
             AND d.mode IN ('reassignment', 'triage_rescue')),
         l.claimed_at,
         l.created_at)
 WHERE l.owner_id IS NOT NULL;

CREATE OR REPLACE FUNCTION lead_track_assigned_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.owner_id IS NULL THEN
    NEW.assigned_at := NULL;
  ELSIF TG_OP = 'INSERT' OR NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    NEW.assigned_at := now();
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_lead_assigned_at
  BEFORE INSERT OR UPDATE OF owner_id ON lead
  FOR EACH ROW EXECUTE FUNCTION lead_track_assigned_at();

-- Trigger functions run when their trigger fires; nothing calls them directly.
REVOKE ALL ON FUNCTION lead_track_assigned_at() FROM PUBLIC;

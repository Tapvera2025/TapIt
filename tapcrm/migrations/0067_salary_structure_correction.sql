-- =====================================================================
-- 0067 - Correcting a salary structure entered by mistake
--
-- A salary structure is history: it is never edited or deleted, and a new
-- salary ends the one before it. A structure entered with a wrong figure
-- could therefore never be put right for its start date. It can now be
-- voided — kept, with who voided it and why — and replaced by a corrected
-- structure from the same date, provided no published payslip used it
-- (a published payslip is corrected by a revision instead).
--
-- Only structures in force take part in the no-overlap rule.
-- =====================================================================

ALTER TABLE salary_structure
  ADD COLUMN voided_at   timestamptz,
  ADD COLUMN voided_by   uuid,
  ADD COLUMN void_reason text;

ALTER TABLE salary_structure
  ADD CONSTRAINT chk_salary_structure_void_fields
  CHECK (
    (voided_at IS NULL) = (voided_by IS NULL)
    AND (voided_at IS NULL) = (void_reason IS NULL)
    AND (void_reason IS NULL OR char_length(btrim(void_reason)) > 0)
  );

ALTER TABLE salary_structure
  ADD CONSTRAINT fk_salary_structure_voided_by
  FOREIGN KEY (organization_id, voided_by) REFERENCES app_user(organization_id, id);

ALTER TABLE salary_structure
  DROP CONSTRAINT salary_structure_organization_id_user_id_daterange_excl;

ALTER TABLE salary_structure
  ADD CONSTRAINT excl_salary_structure_in_force
  EXCLUDE USING gist (
    organization_id WITH =,
    user_id WITH =,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[)') WITH &&
  ) WHERE (voided_at IS NULL);

-- Guard: identity columns never change; effective_to may only narrow; a void
-- is final and freezes the row.
CREATE OR REPLACE FUNCTION salary_structure_immutability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id
    OR OLD.user_id IS DISTINCT FROM NEW.user_id
    OR OLD.currency IS DISTINCT FROM NEW.currency
    OR OLD.effective_from IS DISTINCT FROM NEW.effective_from
    OR OLD.created_by IS DISTINCT FROM NEW.created_by
  THEN
    RAISE EXCEPTION 'salary_structure: identity columns are immutable';
  END IF;
  IF OLD.voided_at IS NOT NULL AND (
    NEW.voided_at IS DISTINCT FROM OLD.voided_at
    OR NEW.voided_by IS DISTINCT FROM OLD.voided_by
    OR NEW.void_reason IS DISTINCT FROM OLD.void_reason
    OR NEW.effective_to IS DISTINCT FROM OLD.effective_to
  ) THEN
    RAISE EXCEPTION 'salary_structure: a voided structure is final';
  END IF;
  -- effective_to may only decrease (never extend or become NULL once set)
  IF NEW.effective_to IS NULL AND OLD.effective_to IS NOT NULL THEN
    RAISE EXCEPTION 'salary_structure: effective_to cannot be removed once set';
  END IF;
  IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS NOT NULL AND NEW.effective_to > OLD.effective_to THEN
    RAISE EXCEPTION 'salary_structure: effective_to cannot be extended';
  END IF;
  RETURN NEW;
END;
$$;

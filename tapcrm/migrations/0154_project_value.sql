-- =====================================================================
-- 0154 — Project value, upfront paid and due amount (replaces budget)
--
-- Product decision: a project records what the client pays for it, not a
-- budget. "Project value" is the agreed price; "upfront paid" is what the
-- client paid at the start; "due amount" is what is still owed — always
-- project value minus upfront paid, so it is a generated column and can
-- never drift from the two it is worked out from.
--
-- Existing budgets carry over as the project value. Amounts stay in the
-- project's currency (snapshotted from the client at creation).
-- =====================================================================

ALTER TABLE project RENAME COLUMN budget TO project_value;
ALTER TABLE project RENAME CONSTRAINT project_budget_check TO project_project_value_check;

ALTER TABLE project
  ADD COLUMN upfront_amount numeric(18, 2) CHECK (upfront_amount IS NULL OR upfront_amount >= 0),
  ADD CONSTRAINT project_upfront_within_value
    CHECK (upfront_amount IS NULL OR (project_value IS NOT NULL AND upfront_amount <= project_value)),
  ADD COLUMN due_amount numeric(18, 2)
    GENERATED ALWAYS AS (project_value - COALESCE(upfront_amount, 0)) STORED;

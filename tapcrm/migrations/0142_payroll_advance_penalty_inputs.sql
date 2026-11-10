-- =====================================================================
-- 0142 — Advance recoveries and penalties reach the payslip
--
-- Advances (0070) and penalties (0072) were recorded "for future payroll
-- deduction" and never reached a run: HR had to export them and type each
-- one into Bonuses & Deductions by hand, so they were easy to miss. Each
-- scheduled advance deduction and each active penalty now owns one payroll
-- input for its payroll month, written and revoked by its own module the way
-- break deductions are (0063). Publishing the payslip marks the deduction
-- completed and the penalty recovered.
--
-- An approved advance is recovered in full from the salary of the month it
-- was given for (`planned_by = 'approval'`). HR can spread it with its own
-- schedule, which replaces that default plan while it is still unpaid.
--
-- Backfill: only deductions HR scheduled and active penalties, for months
-- with no published payroll and no hand-typed advance recovery already in
-- place — nothing is charged twice and no published payslip changes.
-- Travelling allowance stays out of payroll (0081 made it a dashboard-only
-- statement on purpose).
-- =====================================================================

ALTER TABLE employee_advance_deduction
  ADD COLUMN planned_by text NOT NULL DEFAULT 'hr' CHECK (planned_by IN ('hr', 'approval'));

ALTER TABLE payroll_input
  ADD COLUMN advance_deduction_id uuid REFERENCES employee_advance_deduction (id),
  ADD COLUMN penalty_id uuid REFERENCES employee_penalty (id);

ALTER TABLE payroll_input DROP CONSTRAINT IF EXISTS payroll_input_kind_check;
ALTER TABLE payroll_input
  ADD CONSTRAINT payroll_input_kind_check
  CHECK (kind IN ('break-deduction', 'adjustment', 'advance-recovery', 'arrear', 'bonus', 'tds', 'penalty'));
ALTER TABLE payroll_input
  ADD CONSTRAINT payroll_input_penalty_source_check CHECK ((kind = 'penalty') = (penalty_id IS NOT NULL));
ALTER TABLE payroll_input
  ADD CONSTRAINT payroll_input_advance_source_check
  CHECK (advance_deduction_id IS NULL OR kind = 'advance-recovery');

-- One live charge per source; revoked history is kept.
CREATE UNIQUE INDEX uq_payroll_input_active_advance_deduction
  ON payroll_input (organization_id, advance_deduction_id)
  WHERE advance_deduction_id IS NOT NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX uq_payroll_input_active_penalty
  ON payroll_input (organization_id, penalty_id)
  WHERE penalty_id IS NOT NULL AND revoked_at IS NULL;

INSERT INTO payroll_input
  (organization_id, user_id, period_start, kind, amount, label, reason, advance_deduction_id, created_by)
SELECT d.organization_id, d.employee_id, d.payroll_period, 'advance-recovery',
       (d.scheduled_amount_paise - d.deducted_amount_paise) / 100.0,
       'Salary advance recovery',
       'Advance of ' || to_char(a.requested_for_period, 'Mon YYYY') || ', scheduled recovery',
       d.id, a.approved_by
FROM employee_advance_deduction d
JOIN employee_advance a ON a.organization_id = d.organization_id AND a.id = d.advance_id
WHERE a.status = 'approved'
  AND d.status IN ('pending', 'partial')
  AND d.scheduled_amount_paise > d.deducted_amount_paise
  AND NOT EXISTS (
    SELECT 1 FROM payroll_run r
    WHERE r.organization_id = d.organization_id AND r.period_start = d.payroll_period AND r.status = 'published')
  AND NOT EXISTS (
    SELECT 1 FROM payroll_input i
    WHERE i.organization_id = d.organization_id AND i.user_id = d.employee_id
      AND i.period_start = d.payroll_period AND i.kind = 'advance-recovery' AND i.revoked_at IS NULL);

INSERT INTO payroll_input
  (organization_id, user_id, period_start, kind, amount, label, reason, penalty_id, created_by)
SELECT p.organization_id, p.employee_id, p.payroll_period, 'penalty', p.amount_paise / 100.0,
       'Penalty: ' || replace(p.penalty_type, '_', ' '),
       COALESCE(NULLIF(btrim(p.remarks), ''), 'Penalty for ' || replace(p.penalty_type, '_', ' ')),
       p.id, p.created_by
FROM employee_penalty p
WHERE p.status = 'active'
  AND p.payroll_status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM payroll_run r
    WHERE r.organization_id = p.organization_id AND r.period_start = p.payroll_period AND r.status = 'published');

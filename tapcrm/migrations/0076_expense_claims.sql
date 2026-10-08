CREATE TABLE expense_claim (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  claimed_by uuid NOT NULL,
  expense_date date NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (char_length(currency) = 3),
  category text NOT NULL CHECK (category IN ('travel','food','accommodation','fuel','office_supplies','communication','client_expense','other')),
  remarks text NOT NULL CHECK (char_length(btrim(remarks)) BETWEEN 3 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  rejection_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, claimed_by) REFERENCES app_user(organization_id, id),
  FOREIGN KEY (organization_id, reviewed_by) REFERENCES app_user(organization_id, id),
  CHECK ((status = 'rejected') = (rejection_reason IS NOT NULL AND btrim(rejection_reason) <> '')),
  CHECK ((status = 'pending') = (reviewed_by IS NULL AND reviewed_at IS NULL)),
  CHECK ((status = 'approved') = (rejection_reason IS NULL))
);

CREATE TABLE expense_claim_attachment (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  expense_claim_id uuid NOT NULL,
  original_filename text NOT NULL,
  stored_filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  relative_path text NOT NULL,
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, expense_claim_id) REFERENCES expense_claim(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, uploaded_by) REFERENCES app_user(organization_id, id)
);

CREATE INDEX expense_claim_org_idx ON expense_claim (organization_id);
CREATE INDEX expense_claim_claimant_idx ON expense_claim (organization_id, claimed_by, created_at DESC);
CREATE INDEX expense_claim_status_idx ON expense_claim (organization_id, status, created_at DESC);
CREATE INDEX expense_claim_date_idx ON expense_claim (organization_id, expense_date DESC);
CREATE INDEX expense_claim_created_idx ON expense_claim (organization_id, created_at DESC);
CREATE INDEX expense_attachment_claim_idx ON expense_claim_attachment (organization_id, expense_claim_id, created_at);

SELECT apply_tenant_rls('expense_claim');
SELECT apply_tenant_rls('expense_claim_attachment');
GRANT SELECT, INSERT, UPDATE, DELETE ON expense_claim, expense_claim_attachment TO tapcrm_app;

INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, actions.action, true, 'all-people'
FROM position p
CROSS JOIN (VALUES ('payables:claim'), ('payables:approve-claim')) AS actions(action)
WHERE p.code IN ('hr', 'hr-executive') AND p.status = 'active'
ON CONFLICT (organization_id, position_id, action) DO UPDATE
SET allowed = EXCLUDED.allowed, scope = EXCLUDED.scope;

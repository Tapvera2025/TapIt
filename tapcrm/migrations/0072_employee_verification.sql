-- =====================================================================
-- 0072 - Employee Verification Foundation
--
-- Adds:
--   1. employee_verification: tracks verification lifecycle for an employee
--   2. employee_verification_document: metadata and review state for the 10
--      mandated verification documents
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Employee Verification
-- ---------------------------------------------------------------------
CREATE TABLE employee_verification (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  employee_id      uuid NOT NULL,
  status           text NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING', 'PARTIALLY_VERIFIED', 'VERIFIED', 'REJECTED')),
  verified_at      timestamptz,
  verified_by      uuid,
  rejection_reason text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, employee_id),
  FOREIGN KEY (organization_id, employee_id)
    REFERENCES app_user (organization_id, id) ON DELETE CASCADE
);

SELECT apply_tenant_rls('employee_verification');

CREATE TRIGGER employee_verification_updated_at
  BEFORE UPDATE ON employee_verification
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX ix_employee_verification_emp
  ON employee_verification (organization_id, employee_id);

-- ---------------------------------------------------------------------
-- 2. Employee Verification Document
-- ---------------------------------------------------------------------
CREATE TABLE employee_verification_document (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  verification_id  uuid NOT NULL,
  organization_id  uuid NOT NULL REFERENCES organization(id),
  employee_id      uuid NOT NULL,
  document_type    text NOT NULL
                   CHECK (document_type IN (
                     'AADHAAR',
                     'PAN',
                     'VOTER_ID',
                     'OFFER_LETTER',
                     'PAYSLIP_1',
                     'PAYSLIP_2',
                     'PAYSLIP_3',
                     'EXPERIENCE_LETTER',
                     'MARKSHEET',
                     'PASSPORT_PHOTO'
                   )),
  object_key       text NOT NULL,
  file_name        text NOT NULL,
  file_size        bigint NOT NULL CHECK (file_size > 0),
  mime_type        text NOT NULL,
  status           text NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  rejection_reason text,
  uploaded_at      timestamptz NOT NULL DEFAULT now(),
  uploaded_by      uuid NOT NULL,
  reviewed_at      timestamptz,
  reviewed_by      uuid,
  is_current       boolean NOT NULL DEFAULT true,
  version          integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, verification_id)
    REFERENCES employee_verification (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, employee_id)
    REFERENCES app_user (organization_id, id) ON DELETE CASCADE
);

SELECT apply_tenant_rls('employee_verification_document');

CREATE TRIGGER employee_verification_document_updated_at
  BEFORE UPDATE ON employee_verification_document
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX ix_emp_verif_doc_lookup
  ON employee_verification_document (organization_id, verification_id, is_current);

CREATE INDEX ix_emp_verif_doc_emp_type
  ON employee_verification_document (organization_id, employee_id, document_type, is_current);

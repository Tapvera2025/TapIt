-- Sales v1.1 R2 — Deal entity (R2 plan step 2.1).
--
-- The deal row is the first-class record a Sales HOD closes against. The
-- five state fields (R-DEAL-02) are independent dimensions: lifecycle,
-- deal stage, approval status, contract status, payment status. Only the
-- Won recorder in step 2.14 writes `(deal_stage='closed', lifecycle_status='won')`.
--
-- Attribution mirrors the lead's lineage per R-DEAL-02: the originating
-- agent is permanent (overridable only via explicit reassignment); the
-- responsible closer changes via authorized transfer; closed_by_id is
-- captured at Won.

CREATE TABLE deal (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id          uuid NOT NULL REFERENCES organization(id),
  deal_number              bigint GENERATED ALWAYS AS IDENTITY,
  originating_lead_id      uuid,
  direct_entry_reason      text,
  contact_id               uuid NOT NULL,
  company_id               uuid,
  service_requested        text,
  title                    text NOT NULL,
  scope_summary            text,

  originating_agent_id     uuid NOT NULL,
  responsible_closer_id    uuid NOT NULL,
  closed_by_id             uuid,

  currency                 text NOT NULL DEFAULT 'INR',
  expected_close_at        timestamptz,
  probability_override     numeric(5,2),

  -- Active commercials version. Set when step 2.2's commercials table
  -- exists; wired via application code (no FK yet because the table
  -- is created in the next migration).
  commercials_id           uuid,

  deal_stage               text NOT NULL DEFAULT 'discovery'
                             CHECK (deal_stage IN ('discovery','proposal','negotiation','closing','closed')),
  approval_status          text NOT NULL DEFAULT 'not_required'
                             CHECK (approval_status IN ('not_required','pending','approved','rejected')),
  contract_status          text NOT NULL DEFAULT 'not_required'
                             CHECK (contract_status IN ('not_required','draft','sent','signed','voided')),
  payment_status           text NOT NULL DEFAULT 'unpaid'
                             CHECK (payment_status IN ('unpaid','partial','advance_confirmed','paid','partially_refunded','refunded')),
  lifecycle_status         text NOT NULL DEFAULT 'open'
                             CHECK (lifecycle_status IN ('open','won','lost','cancelled')),

  loss_reason              text,
  lost_at                  timestamptz,
  won_at                   timestamptz,
  cancelled_at             timestamptz,

  created_by               uuid NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, id),
  UNIQUE (organization_id, deal_number),
  FOREIGN KEY (organization_id, originating_lead_id) REFERENCES lead (organization_id, id),
  FOREIGN KEY (organization_id, contact_id)          REFERENCES contact (organization_id, id),
  FOREIGN KEY (organization_id, company_id)          REFERENCES company (organization_id, id),
  FOREIGN KEY (organization_id, originating_agent_id)  REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, responsible_closer_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, closed_by_id)          REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, created_by)            REFERENCES app_user (organization_id, id),
  CHECK (originating_lead_id IS NOT NULL OR direct_entry_reason IS NOT NULL),
  CHECK (loss_reason IS NULL OR lifecycle_status = 'lost'),
  CHECK (won_at IS NULL OR lifecycle_status = 'won'),
  CHECK (closed_by_id IS NULL OR lifecycle_status = 'won')
);

CREATE INDEX ix_deal_org_lifecycle_stage ON deal (organization_id, lifecycle_status, deal_stage);
CREATE INDEX ix_deal_org_closer          ON deal (organization_id, responsible_closer_id);
CREATE INDEX ix_deal_org_originating     ON deal (organization_id, originating_agent_id);
CREATE INDEX ix_deal_org_expected_close  ON deal (organization_id, expected_close_at) WHERE lifecycle_status = 'open';
CREATE INDEX ix_deal_org_lead            ON deal (organization_id, originating_lead_id) WHERE originating_lead_id IS NOT NULL;

SELECT apply_tenant_rls('deal');
CREATE TRIGGER trg_deal_updated BEFORE UPDATE ON deal FOR EACH ROW EXECUTE FUNCTION set_updated_at();
GRANT SELECT, INSERT, UPDATE ON deal TO tapcrm_app;

-- Buying-side contacts tied to a deal with their role.
CREATE TABLE deal_contact (
  organization_id uuid NOT NULL,
  deal_id         uuid NOT NULL,
  contact_id      uuid NOT NULL,
  role            text NOT NULL CHECK (role IN ('primary_buyer','influencer','signatory','billing')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_id, contact_id, role),
  FOREIGN KEY (organization_id, deal_id)    REFERENCES deal (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, contact_id) REFERENCES contact (organization_id, id)
);
CREATE INDEX ix_deal_contact_contact ON deal_contact (organization_id, contact_id);

SELECT apply_tenant_rls('deal_contact');
GRANT SELECT, INSERT, DELETE ON deal_contact TO tapcrm_app;

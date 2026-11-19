-- =====================================================================
-- 0160 — A receipt behind every confirmed deal advance
--
-- Confirming an advance used to flip deal.payment_status and keep the amount
-- and bank reference only in the audit log: no record Finance could list or
-- reconcile, nothing to stop one bank reference (UTR) confirming several
-- deals, and nothing in the ledger. Each confirmation now writes a receipt.
-- A bank reference backs at most one live (not reverted) receipt per company.
-- The ledger journal (Bank Dr / Advances from Customers Cr) is linked when it
-- could be posted; otherwise posting_note says why it is waiting for Finance.
-- =====================================================================

CREATE TABLE deal_payment_receipt (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  deal_id          uuid NOT NULL,
  amount_minor     bigint NOT NULL CHECK (amount_minor > 0),
  currency         text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reference        text NOT NULL CHECK (btrim(reference) <> '' AND length(reference) <= 200),
  note             text CHECK (note IS NULL OR length(note) <= 2000),
  confirmed_by     uuid NOT NULL,
  confirmed_at     timestamptz NOT NULL DEFAULT now(),
  journal_id       uuid,
  posting_note     text CHECK (posting_note IS NULL OR length(posting_note) <= 500),
  reverted_at      timestamptz,
  reverted_by      uuid,
  revert_reason    text CHECK (revert_reason IS NULL OR length(revert_reason) <= 2000),
  reversal_journal_id uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, deal_id) REFERENCES deal (organization_id, id),
  FOREIGN KEY (organization_id, confirmed_by) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, reverted_by) REFERENCES app_user (organization_id, id),
  CHECK ((reverted_at IS NULL) = (reverted_by IS NULL))
);

-- One bank reference, one live receipt, across all of the company's deals.
CREATE UNIQUE INDEX ux_deal_payment_receipt_live_reference
  ON deal_payment_receipt (organization_id, lower(btrim(reference)))
  WHERE reverted_at IS NULL;

CREATE INDEX ix_deal_payment_receipt_deal
  ON deal_payment_receipt (organization_id, deal_id);

SELECT apply_tenant_rls('deal_payment_receipt');

-- Sales v1.1 R2 — Payments: receipts, allocations, Razorpay journal
-- (R2 plan step 2.5).
--
-- Receipt → allocation → deal is the only chain of custody that lets a
-- deal reach "advance_confirmed" or "paid" (R-PAY-01). A receipt must
-- be `verified` before any allocation can land. The Razorpay webhook
-- journal is append-only and deduplicates on `(provider, event_id)`,
-- preserving the exact signed body even for duplicates (R-PAY-02).

CREATE TABLE payment_receipt (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id        uuid NOT NULL REFERENCES organization(id),
  provider               text NOT NULL
                           CHECK (provider IN ('razorpay','bank_transfer','cash','cheque','manual')),
  provider_event_id      text,
  bank_reference         text,
  payer_label            text,
  amount_minor           bigint NOT NULL CHECK (amount_minor > 0),
  currency               text NOT NULL,
  received_at            timestamptz NOT NULL,
  reported_by            uuid NOT NULL,
  verified_by            uuid,
  verified_at            timestamptz,
  state                  text NOT NULL DEFAULT 'reported'
                           CHECK (state IN ('reported','verified','reconciled','voided','refunded','partially_refunded')),
  idempotency_key        text,
  conversion_rate_bps    integer,
  note                   text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, reported_by) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, verified_by) REFERENCES app_user (organization_id, id),
  CHECK (verified_at IS NULL OR verified_by IS NOT NULL),
  CHECK (verified_at IS NULL OR state IN ('verified','reconciled','voided','refunded','partially_refunded'))
);

-- Dedup on provider identity. Partial unique indices allow null columns
-- without colliding on NULL (two bank transfers that arrive without a
-- UTR are two different receipts).
CREATE UNIQUE INDEX uniq_receipt_provider_event
  ON payment_receipt (organization_id, provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;
CREATE UNIQUE INDEX uniq_receipt_bank_reference
  ON payment_receipt (organization_id, provider, bank_reference)
  WHERE bank_reference IS NOT NULL;
CREATE INDEX ix_receipt_org_state ON payment_receipt (organization_id, state, received_at DESC);

SELECT apply_tenant_rls('payment_receipt');
CREATE TRIGGER trg_payment_receipt_updated BEFORE UPDATE ON payment_receipt FOR EACH ROW EXECUTE FUNCTION set_updated_at();
GRANT SELECT, INSERT, UPDATE ON payment_receipt TO tapcrm_app;

CREATE TABLE payment_allocation (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL REFERENCES organization(id),
  receipt_id         uuid NOT NULL,
  deal_id            uuid NOT NULL,
  amount_minor       bigint NOT NULL CHECK (amount_minor > 0),
  allocated_by       uuid NOT NULL,
  allocated_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, receipt_id)   REFERENCES payment_receipt (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, deal_id)      REFERENCES deal (organization_id, id),
  FOREIGN KEY (organization_id, allocated_by) REFERENCES app_user (organization_id, id)
);
CREATE INDEX ix_allocation_org_deal    ON payment_allocation (organization_id, deal_id);
CREATE INDEX ix_allocation_org_receipt ON payment_allocation (organization_id, receipt_id);
-- One allocation per (receipt, deal) pair (R-PAY-04).
CREATE UNIQUE INDEX uniq_allocation_receipt_deal
  ON payment_allocation (organization_id, receipt_id, deal_id);

SELECT apply_tenant_rls('payment_allocation');
GRANT SELECT, INSERT, DELETE ON payment_allocation TO tapcrm_app;

CREATE TABLE payment_webhook_event (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid,                                  -- null until the body resolves to a tenant
  provider           text NOT NULL,
  event_id           text NOT NULL,
  raw_payload        bytea NOT NULL,
  signature_valid    boolean NOT NULL,
  processed_at       timestamptz,
  outcome            text NOT NULL DEFAULT 'pending'
                       CHECK (outcome IN ('pending','applied','duplicate','invalid_signature','rejected')),
  outcome_reason     text,
  created_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (provider, event_id)
);
CREATE INDEX ix_webhook_event_org_outcome ON payment_webhook_event (organization_id, outcome, created_at DESC);

-- Payment webhooks arrive without a tenant context. The journal is
-- platform-scoped and written via platformDb; the app role has no
-- write access.
REVOKE INSERT, UPDATE, DELETE ON payment_webhook_event FROM tapcrm_app;
GRANT SELECT ON payment_webhook_event TO tapcrm_app;

CREATE TABLE payment_reversal (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL REFERENCES organization(id),
  receipt_id         uuid NOT NULL,
  amount_minor       bigint NOT NULL CHECK (amount_minor > 0),
  reason             text NOT NULL,
  provider_event_id  text,
  recorded_by        uuid NOT NULL,
  recorded_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, receipt_id)  REFERENCES payment_receipt (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, recorded_by) REFERENCES app_user (organization_id, id)
);
CREATE INDEX ix_reversal_org_receipt ON payment_reversal (organization_id, receipt_id);

SELECT apply_tenant_rls('payment_reversal');
GRANT SELECT, INSERT ON payment_reversal TO tapcrm_app;

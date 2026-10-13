-- Sales v1.1 R2 — Contracts (R2 plan step 2.4).
--
-- A contract references the exact commercials version it approves
-- (R-CON-02). Signed contracts are read-only; material revisions after
-- signing require an amendment (new row) that supersedes the original.
-- Draft and signed artifact file ids point into the platform file store
-- without a hard FK (file lifecycle is independent of the contract row).

CREATE TABLE contract (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL REFERENCES organization(id),
  deal_id            uuid NOT NULL,
  commercials_id     uuid NOT NULL,
  state              text NOT NULL DEFAULT 'draft'
                       CHECK (state IN ('draft','sent','signed','voided','amended','replaced')),
  draft_file_id      uuid,
  signed_file_id     uuid,
  checksum           text,
  signer_name        text,
  signer_email       text,
  signer_evidence    jsonb,
  sent_at            timestamptz,
  signed_at          timestamptz,
  voided_at          timestamptz,
  void_reason        text,
  supersedes_id      uuid,
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, deal_id)        REFERENCES deal (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, commercials_id) REFERENCES commercials (organization_id, id),
  FOREIGN KEY (organization_id, supersedes_id)  REFERENCES contract (organization_id, id),
  FOREIGN KEY (organization_id, created_by)     REFERENCES app_user (organization_id, id),
  CHECK (signed_at IS NULL OR state IN ('signed','amended','replaced')),
  CHECK (voided_at IS NULL OR state = 'voided'),
  CHECK (sent_at IS NULL OR state IN ('sent','signed','voided','amended','replaced'))
);

CREATE INDEX ix_contract_org_deal_state ON contract (organization_id, deal_id, state);
CREATE INDEX ix_contract_org_state      ON contract (organization_id, state);

SELECT apply_tenant_rls('contract');
CREATE TRIGGER trg_contract_updated BEFORE UPDATE ON contract FOR EACH ROW EXECUTE FUNCTION set_updated_at();
GRANT SELECT, INSERT, UPDATE ON contract TO tapcrm_app;

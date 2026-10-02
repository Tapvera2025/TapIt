-- =====================================================================
-- 0062 — Corrections, auto-close and reconciliation (design §12)
-- =====================================================================

-- The registry split keeps approval-bearing attendance:correct for decisions.
-- Existing correctors retain proposal access at their current scope; an
-- explicitly configured raise policy wins over this backfill.
INSERT INTO position_policy
  (organization_id, position_id, action, allowed, scope, fields, constraints)
SELECT organization_id, position_id, 'attendance:raise-correction',
       allowed, scope, fields, constraints
FROM position_policy
WHERE action = 'attendance:correct'
ON CONFLICT (organization_id, position_id, action) DO NOTHING;

CREATE TABLE attendance_correction (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  user_id         uuid NOT NULL,
  work_date       date NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('add-event', 'replace-event', 'void-event',
                                                'confirm-as-is')),
  payload         jsonb NOT NULL,
  reason          text NOT NULL CHECK (char_length(reason) >= 20),
  batch_id        uuid,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by    uuid NOT NULL,
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, id),
  -- Same-org FKs (D34): every participant must belong to this organization.
  FOREIGN KEY (organization_id, user_id)       REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, requested_by)  REFERENCES app_user (organization_id, id),
  CHECK (decided_by IS NULL OR decided_by <> requested_by),   -- A1
  CHECK (decided_by IS NULL OR decided_by <> user_id)         -- nobody corrects their own day (G4)
);
-- decided_by FK added separately: the column is nullable so the FK holds only when non-null.
-- Postgres enforces nullable FKs correctly (NULL values never violate FK constraints).
ALTER TABLE attendance_correction
  ADD CONSTRAINT fk_attendance_correction_decided_by
  FOREIGN KEY (organization_id, decided_by) REFERENCES app_user (organization_id, id);

SELECT apply_tenant_rls('attendance_correction');
GRANT SELECT, INSERT, UPDATE ON attendance_correction TO tapcrm_app;
REVOKE DELETE ON attendance_correction FROM tapcrm_app;

-- FK that attendance_event.correction_id has waited for since step 3 (§8.1, §12.1).
ALTER TABLE attendance_event
  ADD CONSTRAINT fk_attendance_event_correction
  FOREIGN KEY (organization_id, user_id, correction_id)
  REFERENCES attendance_correction (organization_id, user_id, id);

-- Review queue (§12.2).
--
-- resolution_source distinguishes human approvals (resolved_by IS NOT NULL) from
-- automatic system resolutions (resolved_by IS NULL, resolution_source = 'system').
-- The CHECK enforces that a resolved row must carry a source, and a human-resolved
-- row must carry a resolver.
CREATE TABLE attendance_review_item (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  work_date        date NOT NULL,
  kind             text NOT NULL CHECK (kind IN (
    'assumed-departure', 'auto-close-failed', 'reconciled-from-auto-close',
    'overtime-on-assumed', 'same-instant-conflict', 'departure-without-arrival',
    'previous-session-unconfirmed', 'worked-remotely-without-approval', 'punched-on-leave',
    'holiday-worked', 'activity-after-finish', 'late-synced-punch',
    'outside-shift-window', 'overlapping-shift-windows', 'not-evaluated',
    'retime-changes-subject'
  )),
  event_id         uuid,
  detail           jsonb NOT NULL DEFAULT '{}',
  opened_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolved_by      uuid,               -- NULL for system resolutions
  resolution_source text CHECK (resolution_source IN ('human', 'system')),
  resolution_note  text,
  correction_id    uuid,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  -- resolved_by and correction_id are same-org, nullable (D34).
  FOREIGN KEY (organization_id, resolved_by)   REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, user_id, correction_id)
    REFERENCES attendance_correction (organization_id, user_id, id),
  FOREIGN KEY (organization_id, user_id, event_id)
    REFERENCES attendance_event (organization_id, user_id, id),
  CHECK (resolved_at IS NULL OR resolution_source IS NOT NULL),
  CHECK (
    (resolved_at IS NULL AND resolution_source IS NULL AND resolved_by IS NULL AND correction_id IS NULL)
    OR (resolved_at IS NOT NULL AND resolution_source = 'system' AND resolved_by IS NULL)
    OR (resolved_at IS NOT NULL AND resolution_source = 'human' AND resolved_by IS NOT NULL)
  )
);

-- One row per (day, kind, event_id) total for event-keyed items — prevents reopening
-- a closed item for the same evidence (§12.2). Non-partial: covers both open and closed.
CREATE UNIQUE INDEX ux_attendance_review_with_event
  ON attendance_review_item (organization_id, user_id, work_date, kind, event_id)
  WHERE event_id IS NOT NULL;

-- One OPEN row per (day, kind) for day-level items (event_id IS NULL).
-- Closed day-level items allow a new open item after a new attempt (e.g. auto-close-failed
-- on a new input version after fresh evidence).
CREATE UNIQUE INDEX ux_attendance_review_open_no_event
  ON attendance_review_item (organization_id, user_id, work_date, kind)
  WHERE resolved_at IS NULL AND event_id IS NULL;

SELECT apply_tenant_rls('attendance_review_item');
GRANT SELECT, INSERT, UPDATE ON attendance_review_item TO tapcrm_app;
REVOKE DELETE ON attendance_review_item FROM tapcrm_app;

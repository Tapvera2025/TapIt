-- =====================================================================
-- 0163 — Mail Center: a permanent record of every email the platform sends
--
-- Until now an email lived only in the BullMQ queue: a finished one was
-- deleted and a failed one was dropped after 24 hours, so nobody could say
-- whether an invitation, a reset link or a payslip notice actually went out,
-- or why not. This table keeps one row per message and is updated on every
-- delivery attempt.
--
-- Control-plane table: read and written through platformDb only (the Master
-- Admin's Mail Center), never through tenant db, so no row-level security.
--
-- Bodies of SENSITIVE messages (one-time codes, set-password and reset links)
-- are never stored. Such a message can be inspected (who, when, why it
-- failed) but not re-sent from here; the link would have expired anyway and
-- the person should be sent a fresh one from where it was created.
-- =====================================================================
CREATE TABLE email_log (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  to_address       citext NOT NULL,
  from_address     text,
  subject          text NOT NULL,
  status           text NOT NULL DEFAULT 'QUEUED'
                     CHECK (status IN ('QUEUED', 'RETRYING', 'SENT', 'FAILED')),
  -- 'console' = printed to the server log instead of delivered (EMAIL_TRANSPORT=console).
  transport        text NOT NULL DEFAULT 'smtp' CHECK (transport IN ('smtp', 'console')),
  attempts         integer NOT NULL DEFAULT 0,
  manual_retries   integer NOT NULL DEFAULT 0,
  sensitive        boolean NOT NULL DEFAULT false,
  body_text        text,
  body_html        text,
  error_code       text,
  error_message    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_attempt_at  timestamptz,
  sent_at          timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_email_log_created ON email_log (created_at DESC);
CREATE INDEX ix_email_log_status ON email_log (status, created_at DESC);
CREATE INDEX ix_email_log_to ON email_log (to_address, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON email_log TO tapcrm_app;

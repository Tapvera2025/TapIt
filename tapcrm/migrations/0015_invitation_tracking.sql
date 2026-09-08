-- =====================================================================
-- 0015 — Track company admin invitation delivery attempts
-- =====================================================================
ALTER TABLE admin_invitation
  ADD COLUMN resend_count integer NOT NULL DEFAULT 0 CHECK (resend_count >= 0),
  ADD COLUMN last_sent_at timestamptz NOT NULL DEFAULT now();

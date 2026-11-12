-- Capture-time enquiry details that the Add-Lead drawer collects but had
-- nowhere to persist. Previously requirement / location / language /
-- notes were sent by the UI and silently dropped by validators. These
-- columns are nullable; existing rows see NULL on backfill.

ALTER TABLE lead
  ADD COLUMN requirement        text,
  ADD COLUMN location           text,
  ADD COLUMN language_preference text,
  ADD COLUMN intake_notes       text;

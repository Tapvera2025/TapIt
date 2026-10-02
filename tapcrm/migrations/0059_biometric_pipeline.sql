-- =====================================================================
-- 0059 - Biometric ingestion: clock skew samples (§10.6, step 5b)
--
-- Skew is judged from realtime pushes only: the time a punch was received
-- minus its corrected instant, as the median of the device's last 20 such
-- samples. A backlog's age is not skew, so the pipeline records a sample only
-- for a push that carried one new punch as it happened.
-- =====================================================================

ALTER TABLE biometric_device
  ADD COLUMN skew_samples integer[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(skew_samples) <= 20);

-- No new grants (the column is biometric's, on a table it already owns).

ALTER TABLE attendance_export_request
  ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'csv';

ALTER TABLE attendance_export_request
  DROP CONSTRAINT IF EXISTS attendance_export_request_format_check;

ALTER TABLE attendance_export_request
  ADD CONSTRAINT attendance_export_request_format_check CHECK (format IN ('csv', 'xlsx'));

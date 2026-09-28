-- 0038: Add resume storage metadata to candidate table
ALTER TABLE candidate
  ADD COLUMN IF NOT EXISTS resume_object_key text,
  ADD COLUMN IF NOT EXISTS resume_file_name text,
  ADD COLUMN IF NOT EXISTS resume_mime_type text,
  ADD COLUMN IF NOT EXISTS resume_size integer,
  ADD COLUMN IF NOT EXISTS resume_uploaded_at timestamptz;

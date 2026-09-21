-- Record whether tenant-owned organization metadata came from the standard
-- starter template. Custom records remain usable and are never filtered out.
ALTER TABLE department ADD COLUMN is_seeded boolean NOT NULL DEFAULT false;
ALTER TABLE team ADD COLUMN is_seeded boolean NOT NULL DEFAULT false;
ALTER TABLE designation ADD COLUMN is_seeded boolean NOT NULL DEFAULT false;

-- Prevent concurrent or direct writes from creating overlapping periods.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE accounting_period
  ADD CONSTRAINT accounting_period_no_overlap
  EXCLUDE USING gist (
    organization_id WITH =,
    daterange(period_start, period_end, '[]') WITH &&
  );

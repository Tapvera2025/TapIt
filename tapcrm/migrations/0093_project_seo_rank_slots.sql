-- Replace the immutable-looking initial rank slot with the rolling past rank.
-- The complete observation history remains in project_seo_rank_history.

ALTER TABLE project_seo_keyword
  ADD COLUMN past_rank integer CHECK (past_rank IS NULL OR past_rank BETWEEN 1 AND 100000);

-- Legacy rows already have their first observation in rank history. Recover a
-- past value only when three meaningful observations exist; otherwise leave it
-- NULL rather than presenting the old initial value as a misleading past rank.
WITH ranked_observations AS (
  SELECT keyword_id,
         observed_rank,
         row_number() OVER (
           PARTITION BY keyword_id
           ORDER BY observed_at DESC, id DESC
         ) AS position
  FROM project_seo_rank_history
  WHERE source = 'manual' OR status = 'available'
), past_values AS (
  SELECT keyword_id, observed_rank
  FROM ranked_observations
  WHERE position = 3
)
UPDATE project_seo_keyword k
SET past_rank = p.observed_rank
FROM past_values p
WHERE p.keyword_id = k.id;

ALTER TABLE project_seo_keyword
  DROP COLUMN initial_rank;

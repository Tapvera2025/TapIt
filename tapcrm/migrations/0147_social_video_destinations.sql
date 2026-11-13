-- Video destinations.
--
-- A Facebook Page publishes a Reel through Meta's Reels API rather than as a
-- feed video, and an Instagram destination can now name its Reel explicitly,
-- so a destination's post type gains 'reel'.
--
-- A YouTube upload was always private: nothing recorded the visibility the
-- person publishing meant. Each destination now records public, unlisted or
-- private; NULL keeps the earlier behaviour (private).
--
-- Additive and forward-only (tools/migrate.ts).

ALTER TABLE social_post_destination DROP CONSTRAINT social_post_destination_post_type_check;
ALTER TABLE social_post_destination
  ADD CONSTRAINT social_post_destination_post_type_check
    CHECK (post_type IN ('feed', 'story', 'reel'));

ALTER TABLE social_post_destination
  ADD COLUMN privacy_status text
    CONSTRAINT social_post_destination_privacy_status_check
    CHECK (privacy_status IS NULL OR privacy_status IN ('public', 'unlisted', 'private'));

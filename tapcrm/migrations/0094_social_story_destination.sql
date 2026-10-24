-- Per-destination post type lets Instagram destinations opt into a Story
-- container instead of the default feed/Reel. Other platforms stay on 'feed'
-- until their APIs expose a comparable story primitive; see
-- team-docs/setup/social-media.md.

ALTER TABLE social_post_destination
  ADD COLUMN post_type text NOT NULL DEFAULT 'feed'
  CHECK (post_type IN ('feed', 'story'));

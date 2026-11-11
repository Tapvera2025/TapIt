-- =====================================================================
-- 0136 — Chat: link previews (Open Graph / URL unfurling)
--
-- `message_link` records which URLs a message contains (in order), written
-- in the same transaction as the message, so the "links" search filter is
-- exact from the moment a message is sent.
--
-- `chat_link_preview` is the per-organization cache of what a URL unfurled
-- to. It is filled after the message commits (the fetch is an outbound HTTP
-- call, which never runs inside a transaction — TX-2), and a message renders
-- the previews of its links that are `ready`. The preview image is copied
-- into our own storage (never hot-linked), so viewers' browsers never call
-- the third-party site.
-- =====================================================================

CREATE TABLE message_link (
  message_id       uuid NOT NULL,
  organization_id  uuid NOT NULL REFERENCES organization(id),
  url              text NOT NULL CHECK (char_length(url) BETWEEN 8 AND 2048),
  position         smallint NOT NULL CHECK (position >= 0),
  PRIMARY KEY (message_id, url),
  FOREIGN KEY (organization_id, message_id) REFERENCES message (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX ix_message_link_url ON message_link (organization_id, url);

CREATE TABLE chat_link_preview (
  organization_id  uuid NOT NULL REFERENCES organization(id),
  url              text NOT NULL CHECK (char_length(url) BETWEEN 8 AND 2048),
  -- 'failed' is cached too (briefly) so a dead link is not refetched per message.
  status           text NOT NULL CHECK (status IN ('ready', 'failed')),
  -- Where the fetch finally landed after redirects.
  final_url        text,
  title            text,
  description      text,
  site_name        text,
  -- A recognised product (figma, github, loom, google-docs, …) for its icon.
  provider         text,
  image_driver     text CHECK (image_driver IS NULL OR image_driver IN ('s3', 'local')),
  image_key        text,
  image_width      integer,
  image_height     integer,
  fetched_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, url),
  CHECK ((image_key IS NULL) = (image_driver IS NULL))
);

SELECT apply_tenant_rls('message_link');
SELECT apply_tenant_rls('chat_link_preview');

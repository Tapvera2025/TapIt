-- =====================================================================
-- 0133 — Chat: file attachments & media sharing
--
-- Contracts, mockups, screenshots and invoice PDFs shared inside a
-- conversation. The bytes live in object storage (S3 / Cloudflare R2 /
-- MinIO through platform/storage, or a local directory in development);
-- this table holds what the thread needs to render them.
--
-- Two-step send: the file is uploaded first (message_id IS NULL, a
-- "pending" upload that only its uploader can attach), then the message
-- that carries it is sent with its id. Pending uploads nobody sent are
-- removed by the `chat.attachment-cleanup` job after a day.
--
-- A forwarded message gets its own rows pointing at the SAME objects, so
-- the original being unsent never breaks the copy. Objects are therefore
-- deleted only for uploads that were never sent.
-- =====================================================================

CREATE TABLE message_attachment (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  conversation_id  uuid NOT NULL,
  -- NULL while the upload is pending (not yet part of a sent message).
  message_id       uuid,
  uploaded_by      uuid NOT NULL,
  -- What the UI renders: an inline image with a lightbox, or a file card.
  kind             text NOT NULL
                     CHECK (kind IN ('image', 'pdf', 'document', 'spreadsheet', 'presentation', 'text', 'archive')),
  file_name        text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  -- The type established from the file's own bytes, never the browser's label.
  mime_type        text NOT NULL,
  size_bytes       bigint NOT NULL CHECK (size_bytes > 0),
  checksum_sha256  text NOT NULL,
  -- Where the bytes are: 's3' (S3 / R2 / MinIO) or 'local' (development disk).
  storage_driver   text NOT NULL CHECK (storage_driver IN ('s3', 'local')),
  object_key       text NOT NULL,
  -- A small WebP rendition for images; NULL for everything else.
  thumbnail_key    text,
  width            integer CHECK (width IS NULL OR width > 0),
  height           integer CHECK (height IS NULL OR height > 0),
  page_count       integer CHECK (page_count IS NULL OR page_count > 0),
  -- Order within its message (0-based).
  position         smallint NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, conversation_id) REFERENCES conversation (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, message_id) REFERENCES message (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, uploaded_by) REFERENCES app_user (organization_id, id)
);

-- Rendering a page of messages: every attachment of these messages.
CREATE INDEX ix_message_attachment_message
  ON message_attachment (organization_id, message_id, position)
  WHERE message_id IS NOT NULL;

-- The cleanup sweep: pending uploads, oldest first.
CREATE INDEX ix_message_attachment_pending
  ON message_attachment (organization_id, created_at)
  WHERE message_id IS NULL;

-- Search "files of this kind in this conversation".
CREATE INDEX ix_message_attachment_conversation_kind
  ON message_attachment (organization_id, conversation_id, kind)
  WHERE message_id IS NOT NULL;

SELECT apply_tenant_rls('message_attachment');
-- Default privileges from 0001 already grant the runtime role SELECT/INSERT/
-- UPDATE/DELETE on tables created here.

-- =====================================================================
-- 0134 — Chat: full-text message search
--
-- Long-running projects bury their conversations; this makes every message
-- a member can read findable again.
--
-- The vector is GENERATED from the body, so it can never drift from what
-- the thread shows: an edit rewrites it, an unsend (body := NULL) empties it.
-- Two dictionaries, weighted:
--   'english' (A)  stemmed — "invoices" finds "invoice", "approved" finds "approve"
--   'simple'  (B)  verbatim — names, codes, Hinglish and other non-English words,
--                  and the prefix matching behind search-as-you-type
-- Attachment file names are searchable the same way, with separators split
-- so "Q3-invoice_final.pdf" matches "invoice".
-- =====================================================================

ALTER TABLE message
  ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('english'::regconfig, coalesce(body, '')), 'A') ||
      setweight(to_tsvector('simple'::regconfig, coalesce(body, '')), 'B')
    ) STORED;

CREATE INDEX ix_message_search ON message USING GIN (search_vector);

ALTER TABLE message_attachment
  ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (
      to_tsvector('simple'::regconfig, regexp_replace(file_name, '[._\-]+', ' ', 'g'))
    ) STORED;

CREATE INDEX ix_message_attachment_search ON message_attachment USING GIN (search_vector);

-- "Messages from this person" across the conversations a member can read.
CREATE INDEX ix_message_sender_created
  ON message (organization_id, sender_id, created_at DESC, id DESC);

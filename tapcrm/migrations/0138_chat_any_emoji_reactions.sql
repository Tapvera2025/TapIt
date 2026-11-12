-- =====================================================================
-- 0138 — Chat: any Unicode emoji as a reaction
--
-- 0052 fixed the reaction set to six emoji and noted that a full picker
-- would need only this constraint changed. Which strings count as "one
-- emoji" (RGI emoji, including skin tones, ZWJ sequences, keycaps and flags)
-- is validated by the chat service; the table keeps a length bound so a
-- non-emoji string can never be stored at scale. A person may leave several
-- different reactions on one message — the primary key already allowed it.
-- =====================================================================

ALTER TABLE message_reaction DROP CONSTRAINT IF EXISTS message_reaction_emoji_check;

ALTER TABLE message_reaction
  ADD CONSTRAINT message_reaction_emoji_check CHECK (char_length(emoji) BETWEEN 1 AND 32);

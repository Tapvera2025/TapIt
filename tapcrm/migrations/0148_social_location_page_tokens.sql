-- Company Facebook logins keep each Page's own token.
--
-- 0146 stored only the signed-in user's token for a company Meta login and read
-- each Page's token from it when publishing. Meta expires that user token after
-- about 60 days and cannot renew it without the person signing in again, so
-- every Page and Instagram account on the login stopped publishing on the same
-- day. A Page token read with a long-lived user token does not expire, so each
-- Facebook Page and Instagram location now keeps its own, encrypted for that
-- location. The user token is still kept: it is what lists the login's Pages.
--
-- Rows are filled by the next refresh of each login (daily, or Refresh in
-- Company connections); until then publishing reads the token as before.
--
-- Additive and forward-only (tools/migrate.ts).

ALTER TABLE social_connection_location ADD COLUMN credentials_encrypted text;
ALTER TABLE social_connection_location
  ADD CONSTRAINT social_connection_location_credentials_platform
    CHECK (credentials_encrypted IS NULL OR platform IN ('facebook', 'instagram'));

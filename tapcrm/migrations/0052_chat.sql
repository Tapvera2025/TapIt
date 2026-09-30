-- =====================================================================
-- 0052 — Chat (X1 / module `chat`)
--
-- PRD X1: "Internal messaging, group and channel conversations, presence."
-- CH-1: "Chat is not scoped by hierarchy. Anyone may message anyone."
--
-- Phase 2 of the messaging build: Direct Messages. `kind` already includes
-- 'group' and 'project' so later phases (Internal Groups, super-admin-
-- managed; Project Groups, created from the project's second step) need no
-- further migration — only new routes/policy scopes.
--
-- Deliberately separate from the `project-communication` module (PJ-6/PJ-8:
-- team thread and client thread as two authorization-separated resources).
-- This project's product decision is ONE combined thread per project
-- (assigned employees + client together), which does not fit that shape, so
-- it is built here instead of bending project-communication's already-
-- reviewed split-thread design. See team-docs for the write-up.
-- =====================================================================

CREATE TABLE conversation (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  kind             text NOT NULL CHECK (kind IN ('direct', 'group', 'project')),
  -- Required for group/project (shown as the tab/list title); direct
  -- conversations have no name of their own — the client renders the other
  -- member's name.
  name             text,
  -- Direct-conversation de-duplication: the two member ids, lexically
  -- sorted and joined by ':'. Reopening a DM with the same person must reuse
  -- the existing conversation, never create a second one.
  direct_pair_key  text,
  -- Set only for kind = 'project' (Phase 4): the project this thread belongs
  -- to. No FK yet — the projects module/table does not exist in this phase.
  project_id       uuid,
  created_by       uuid NOT NULL,
  archived_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  CHECK (kind <> 'direct' OR name IS NULL),
  CHECK (kind = 'direct' OR name IS NOT NULL),
  CHECK (kind = 'direct' OR direct_pair_key IS NULL),
  CHECK (kind = 'project' OR project_id IS NULL)
);

CREATE UNIQUE INDEX ix_conversation_direct_pair
  ON conversation (organization_id, direct_pair_key)
  WHERE kind = 'direct';

-- ---------------------------------------------------------------------
-- Membership. `last_read_at` is a per-member read CURSOR, not a row per
-- message per reader: "seen by X" is computed by comparing a member's
-- last_read_at against the message's created_at. Far cheaper than a
-- message_read table, and it is what most real chat products actually do.
-- `left_at` supports removing someone from a group without deleting the
-- history they were part of (e.g. reassigning a project's team).
-- ---------------------------------------------------------------------
CREATE TABLE conversation_member (
  conversation_id  uuid NOT NULL,
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  joined_at        timestamptz NOT NULL DEFAULT now(),
  left_at          timestamptz,
  last_read_at     timestamptz,
  PRIMARY KEY (conversation_id, user_id),
  FOREIGN KEY (organization_id, conversation_id) REFERENCES conversation (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);

-- "My conversation list" — the access pattern every session opens with.
CREATE INDEX ix_conversation_member_user
  ON conversation_member (organization_id, user_id)
  WHERE left_at IS NULL;

-- ---------------------------------------------------------------------
-- Messages. `body IS NULL` once unsent — the row survives as a tombstone
-- (product decision: "This message was unsent" placeholder, not a hard
-- delete) so the thread stays legible and there is something to point at if
-- content is ever reported.
-- ---------------------------------------------------------------------
CREATE TABLE message (
  id                        uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id           uuid NOT NULL REFERENCES organization(id),
  conversation_id           uuid NOT NULL,
  sender_id                 uuid NOT NULL,
  body                      text,
  reply_to_message_id       uuid,
  forwarded                 boolean NOT NULL DEFAULT false,
  -- Attribution only (label "Forwarded from X"), not a live reference: the
  -- original message may itself later be unsent without affecting this copy.
  forwarded_from_sender_id  uuid,
  deleted_at                timestamptz,
  deleted_by                uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, conversation_id) REFERENCES conversation (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, sender_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, reply_to_message_id) REFERENCES message (organization_id, id),
  FOREIGN KEY (organization_id, forwarded_from_sender_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, deleted_by) REFERENCES app_user (organization_id, id),
  CHECK (deleted_at IS NULL OR body IS NULL)
);

-- Thread pagination, newest first; (created_at, id) breaks ties for the
-- keyset cursor, same pattern as the notification and audit read paths.
CREATE INDEX ix_message_conversation
  ON message (organization_id, conversation_id, created_at DESC, id DESC);

-- ---------------------------------------------------------------------
-- Reactions. A fixed emoji set for v1 (thumbs up, heart, laugh, wow, sad,
-- pray) — a full custom-emoji picker is a later enhancement, not a schema
-- change, since the CHECK constraint is the only place the set is named.
-- ---------------------------------------------------------------------
CREATE TABLE message_reaction (
  message_id       uuid NOT NULL,
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  emoji            text NOT NULL CHECK (emoji IN ('👍', '❤️', '😂', '😮', '😢', '🙏')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji),
  FOREIGN KEY (organization_id, message_id) REFERENCES message (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);

SELECT apply_tenant_rls('conversation');
SELECT apply_tenant_rls('conversation_member');
SELECT apply_tenant_rls('message');
SELECT apply_tenant_rls('message_reaction');
-- Default privileges from 0001 already grant the runtime role SELECT/INSERT/
-- UPDATE/DELETE on tables created here.

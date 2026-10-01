-- =====================================================================
-- 0062 — Group/project conversations can carry a short description
-- =====================================================================
-- Direct conversations have no use for this (the client never renders it);
-- group and project conversations show it under the title.
ALTER TABLE conversation ADD COLUMN description text;

# team-docs — shared working documents

A place for **any developer** to drop notes, guides, how-tos and drafts that the
team should be able to find. It is deliberately informal and **temporary**.

## How this folder differs from `docs/`

| | `docs/` | `team-docs/` (this folder) |
|---|---|---|
| Purpose | The official spec: PRD, TECH, AUTHORIZATION | Working notes, onboarding guides, drafts |
| Authority | **Source of truth.** Some files generate code (`AUTHORIZATION.md` → the registry) | **Not authoritative.** If it disagrees with `docs/` or the code, the code and `docs/` win |
| Who edits | Deliberately, with review | Anyone, any time |
| Lifetime | Permanent | Temporary — expect to clean up |

**Never put a file here that a build depends on.** Nothing in this folder is read
by code, CI or the registry generator.

## House rules

1. **One topic per file**, named in lowercase-with-dashes: `notification-engine-guide.md`,
   `local-setup-windows.md`. If several people might write about the same thing,
   add a date: `2026-10-02-migration-renumbering.md`.
2. **Start every document with a small header** so readers can judge it quickly:
   ```
   > Owner: <your name> · Written: <date> · Status: draft | current | outdated
   > Audience: <who this is for>
   ```
3. **No secrets, ever.** No passwords, tokens, `.env` contents, connection strings
   with credentials, customer data or personal data. Use placeholders.
4. **Keep files small and text-based.** Markdown preferred. No large binaries,
   screenshots dumps or exports; link to them instead.
5. **Update or delete what you own.** If you notice a document is wrong, fix it or
   set `Status: outdated`. If it is no longer useful, delete it — git history
   keeps it.
6. **Add yourself to the index below** when you add a file (one line).
7. **Something turned out to be permanent?** Move it into `docs/` through a normal
   pull request so it gets reviewed, and remove it from here.

## Index

| Document | Owner | Status | What it is |
|---|---|---|---|
| [notification-engine-guide.md](notification-engine-guide.md) | Anish | current | How the notification engine is built and how to send a notification from your feature |

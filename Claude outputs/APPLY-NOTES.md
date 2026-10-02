# TapCRM fixes: what was applied and what to run

`tapcrm-fixes.patch` changes 159 files (124 modified, 35 new, +11,550 / −1,896).
**It is already applied to your TapIt folder, uncommitted.** Review it with
`git diff` (and `git status` for the new files), then commit when you're happy.

It was rebased on your latest edits: your Org Chart work, the `hierarchy` icon
and the sidebar active-state fix are kept as they were.

## Run these

From `TapIt/tapcrm`:

```bash
npm run build               # rebuild the shared packages (contracts, authz) the app imports
npm run migrate             # applies 0065–0068 to your database
npm run db:app-password     # migrate resets the runtime role's password
npm run verify              # registry, typecheck, lint, CI gates, unit tests
```

Then restart the API and the web dev server.

Migrations (all of them fix existing companies too):

| File | What it does |
|---|---|
| 0065_hr_only_people_approvals.sql | Removes manager/admin powers the old setup gave every employee; HR-only approvals; adds `status:punch` and `users:change-placement` |
| 0066_biometric_device_directory.sql | A device serial belongs to one company platform-wide (needed for `/iclock`) |
| 0067_salary_structure_correction.sql | Lets an unused salary be corrected (voided and replaced) |
| 0068_leave_balances.sql | Balance adjustments, and backfills what approved leave already used |

**One check will fail until you change one word in your own Org Chart code:**
`OrgChartPage.tsx` line 146, `changeZoom(amount: number)`. The money gate
(CI-21) reads a parameter called `amount` as money. Rename it to `step` and
`npm run ci` passes. I left your file as it is.

## New in this round: policies anyone can read

- **Positions → Policies** now shows every power by a plain name with one line
  explaining it ("Approve or reject leave: Approve, reject or cancel leave and
  work-from-home requests."). The technical key is still shown underneath in
  small grey text.
- "Applies to" uses everyday words: *Just their own*, *Their own team only*,
  *Their team and teams below*, *Their department*, *Everyone in the company*.
  A line under the choice explains what it means.
- The list only shows the parts of TapCRM your company uses. It is grouped,
  searchable, and has a "Show only what's allowed" filter. Each group shows
  "3 of 6 allowed", and changed rows are marked.
- **Save stays at the bottom of the window**, with a count of unsaved changes.
  Preview shows the result in plain words before you save.
- **Every window in the app** now closes when you click outside it, press
  Escape or press ×. If you've changed something, it first asks "Close without
  saving?", with **Keep editing** or **Discard changes**.
- The Access Explorer uses the same plain names. It now has the tabs *By person*,
  *By power* and *Given directly*, and shows where each power comes from, e.g.
  "From their position".

## Settings

- `PASSWORD_BREACH_CHECK` = `best-effort` (default) | `strict` | `off`.
- `tools/api-test-suite.ts` now reads `PLATFORM_ADMIN_PASSWORD` and
  `TEST_TENANT_ADMIN_PASSWORD` from `.env`. The hardcoded values are gone.
  **Change the Master Admin password.** The old one was in source control.

## Worth knowing

- Only the Super Admin can run payroll. Payroll powers are protected in the
  registry, so they can't be given to a position (for example HR).
- A new position starts with the ordinary employee basics: each person can
  handle their own leave, attendance and payslips. Give it more in its Policies.
- Moving someone to another position signs them out. They sign in again.
- `tapcrm/tmp/` (ignored by git) holds two files I left there: `tapcrm-fixes.patch`
  (the patch that was applied) and `claude-audit-snapshot.tgz` (a 3 MB copy of
  your code from the start of the audit). You can delete both.

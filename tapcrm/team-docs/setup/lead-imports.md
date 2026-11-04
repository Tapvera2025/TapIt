# Lead Imports

Sales → Leads → **Imported leads** brings lead lists into the CRM from a CSV/TSV file, an Excel workbook, a Google Sheets link or rows pasted from a spreadsheet. Imported leads are ordinary CRM leads (entry method `import`): they get My Work, callbacks, handovers and deals like any other lead. Whoever imports them hands them to people in the Sales department, from the sheet's "Assigned to" column or from the Imported leads view, and Sales → Calls → **Assigned leads** shows whether those people are calling them (with JustCall or Aircall connected, see [Call Analytics](call-analytics.md)).

Code: `packages/server/src/modules/sales/imports/` (server), `packages/client/src/company/sales/leads/imports/` and `packages/client/src/company/sales/calls/AssignedLeadCallsPage.tsx` (client). Migration: `0132_sales_lead_imports.sql`.

## Enable

1. `npm run migrate`. `0132_sales_lead_imports.sql`:
   - registers the **Lead Imports** module (key `lead-imports`, Sales group in Master Admin) and its two actions;
   - adds two tenant tables with forced RLS, `lead_import` and `lead_import_row` (the app role cannot delete from either);
   - indexes `telephony_call` on the last ten digits of the contact number, for call matching;
   - enables Lead Imports for every company that already has Leads enabled.
2. Restart the server so the job scheduler registers the import jobs. No environment variables are needed.
3. New companies get Lead Imports when the Sales group is enabled in Master Admin.

The upload body is JSON (the file travels base64-encoded), so the old global `text/csv` raw body parser for the pilot endpoint is gone.

## Permissions

| Permission | What it allows | Default |
| --- | --- | --- |
| `lead-imports:view` | The Imported leads view, import reports and the Assigned leads call tracking | Super Admin |
| `lead-imports:manage` | Upload, review, import and assign leads. **Sensitive.** | Super Admin |

Both are tenant-wide (no scope) and position-grantable: a Super Admin can give them to a position, for example the Sales Head, under Organization → Positions. Opening a matched call's details still needs `telephony:view` for that call.

## Importing

1. **Choose the list.** Upload a `.csv`, `.tsv`, `.txt` or `.xlsx`/`.xlsm` file (up to 10 MB and 10,000 rows), paste a Google Sheets link, or paste cells copied from a spreadsheet.
   - CSV: comma, semicolon, tab or pipe separated (detected, or Excel's `sep=` line); UTF-8, UTF-16 and Windows-1252 text.
   - Excel: the first visible sheet, or any sheet picked in the next step. A title line above the header row is skipped. Old binary `.xls`, `.ods` and Numbers files are refused with a message saying how to save them.
   - Google Sheets: the sheet must be shared as **Anyone with the link can view**. The server rebuilds the CSV export address from the spreadsheet id (the pasted URL is never fetched as given) and follows redirects only to Google hosts; a private sheet gets a clear message. The tab in the link (`gid`) is the one imported.
2. **Match columns.** Columns are matched by header and by what their values look like: client name, first/last name, business name, business owner, phone, email, requirement, city/location, notes, language and **Assigned to**. Headers such as "Client Name", "Business Name", "Owner's Name", "Number", "Mobile No.", "Allotted To" are recognized. Columns not imported are added to the lead's notes as `Header: value` (switchable). Also chosen here: the import name, the lead source (an outbound "Expo lists" source can be created inline), an optional campaign and the country code added to numbers written without one (defaults to the last import's, else the company timezone's: `+91` for India).
3. **Review (dry run).** Nothing is written. The review counts new leads, contacts already in the CRM with an open lead (they keep that lead and owner), rows repeating a phone or email from earlier in the file, and rows without a usable phone or email. It lists every distinct "Assigned to" value with the employee it matched (exact email, email name, full name, a unique first name or initials such as "Rahul V"). Any value can be pointed at someone else or left unassigned.
4. **Import.** A background job (`sales.lead-import.process`) sends each row through the intake pipeline (`ingest()`), so dedupe, contact and company records and the routing record are the CRM's own. Each row's submission key is `<import>:<row>`, so a retried row is processed once. Progress is shown live; closing the window does not stop the import. Rows named in "Assigned to" are handed out when the rows are done. A run that stops (deploy, crash) is resumed by `sales.lead-import.resume-sweep` every 5 minutes; an import that failed can be resumed from its report.

Each import's **Report** lists every row with its result and the reason a row was not imported.

## Assigning

From the Imported leads view, tick leads (or **Select all N matching** the filters) and choose **Assign…**:

- one person gets them all; several people split them evenly, dealt out in turn in the order they were picked;
- only people in the Sales department (department `sales`, or a Sales position) who are active can be picked; being on leave or not punched in is shown but does not block;
- leads that already have an owner stay with them unless **Also move leads that already have an owner** is ticked.

An assignment sets owner and holder, moves the lead to the owner's pool and Sales Team (so their Supervisor, Team Lead and Sales Head see it), clears a stalled flag, moves pending callbacks, and writes a routing record (`direct`, or `reassignment` when it had an owner), a lead activity and an audit entry for every lead. Each person gets **one** notification per batch, linking to My Work; a previous owner is told their leads moved. Unassigned imported leads are not flagged as stalled.

## Call tracking

Sales → Calls → **Assigned leads** (also linked from the Imported leads view) matches every assigned imported lead's phone number against JustCall/Aircall calls on the **last ten digits**, so a missing or different country prefix still matches. Only calls **after** the lead was assigned count. Per lead:

| Status | Meaning |
| --- | --- |
| Connected | The owner had at least one answered call with the lead |
| Tried, no answer | The owner called, nobody answered |
| Not called yet | No call by the owner (red when over a day old) |
| Called by someone else | Calls with the lead, none by the owner |
| No phone number | The lead has only an email |

The page totals these, shows each salesperson's called share, connected count, waiting leads and average time to first call, and lists the leads (filter by status, import, salesperson, "assigned by me", assignment date; sort by waiting longest). Opening a lead lists its matched calls; opening a call shows the usual call details and recording (with `telephony:view` / `telephony:listen`).

## API

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/lead-imports` | `lead-imports:view` |
| POST | `/api/lead-imports` (`{kind: 'file', fileName, fileBase64, sheet?}` \| `{kind: 'google_sheet', url}` \| `{kind: 'paste', text}`) | `lead-imports:manage` |
| GET | `/api/lead-imports/leads?importId&assignment&ownerId&callStatus&search&page&pageSize` | `lead-imports:view` |
| POST | `/api/lead-imports/assign` (`{leadIds \| filter, employeeIds, includeAssigned}`) | `lead-imports:manage` |
| GET | `/api/lead-imports/assignees` | `lead-imports:manage` |
| GET | `/api/lead-imports/call-tracking?importId&ownerId&assignedBy&from&to&status&search&sort&page&pageSize` | `lead-imports:view` |
| GET | `/api/lead-imports/call-tracking/leads/:id` | `lead-imports:view` |
| GET | `/api/lead-imports/:id` | `lead-imports:view` |
| POST | `/api/lead-imports/:id/preview` (column matches and settings; saves them, writes no lead) | `lead-imports:manage` |
| POST | `/api/lead-imports/:id/start`, `/resume`, `/discard` | `lead-imports:manage` |
| GET | `/api/lead-imports/:id/rows?status&page&pageSize` | `lead-imports:view` |

## Local testing

Outside production `LEAD_IMPORT_SHEETS_BASE` points Google Sheets exports at a mock server. Unit tests cover the CSV/Excel/Google Sheets readers, column matching, phone numbers, assignee matching, the dry run and the round-robin split; `imports.integration.test.ts` runs upload → preview → import → sheet assignment → manual split → reassignment → call tracking against PostgreSQL:

```sh
TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run imports.integration
```

## Not included yet

- Private Google Sheets through a Google login (today: shared links).
- Re-syncing a Google Sheet to pick up rows added later (import it again: existing contacts are recognized).
- Saved column templates per file layout (the last import's source and country code are remembered).
- Undoing an import.

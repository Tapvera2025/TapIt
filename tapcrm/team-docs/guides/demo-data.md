# Removable demo data

The demo fixture is for a **local, non-production organization** that already has the standard departments and positions. It does not alter the organization's existing hierarchy. It creates 14 clearly named `demo.*@example.test` employee accounts across HR, Sales, Projects, and Development, including manager relationships, team placement, joining dates, designations where available, and a shared day shift.

The activity covers eight recent weekdays in the organization's timezone: clock-in and clock-out events, some breaks, late arrivals, half days and absences, plus calculated attendance summaries. It also creates a demo annual-leave type, opening balances, approved and pending requests, salary structures in INR, and a few bonus inputs for the current payroll month. These are sample amounts. If the organization has no non-demo employees and no accepted payroll configuration, it also adds clearly labeled demo settings and a **draft** payroll run with frozen inputs for all demo employees. It does not publish payslips. Use the payroll UI to calculate and review the run; the sample settings are not statutory approval.

Set `DEMO_EMPLOYEE_PASSWORD` in your untracked `.env` to a local testing password of at least 12 characters. Then, from the `tapcrm` directory:

```sh
npm run seed:demo -- --organization=tapvera
```

Use the code of the target organization, preserving its case. For example, `demo.developer@example.test` is one of the created logins. Rerunning the command on the same day adds no duplicate activity. On later days it adds newly recent weekdays while keeping previously seeded rows. The command refuses production mode and aborts on conflicting non-demo attendance, shift assignments, or salary structures for those accounts.

To verify that removal can succeed without deleting anything:

```sh
npm run cleanup:demo -- --organization=tapvera --confirm-demo --dry-run
```

To remove the fixture when testing is finished:

```sh
npm run cleanup:demo -- --organization=tapvera --confirm-demo
```

Cleanup selects the exact fixture emails and tagged activity in one transaction. It removes draft runs and any unpublished demo payslips, but refuses a run with published payslips or posted ledger entries. It also refuses non-demo reporting or team relationships and rolls back if other product data references fixture records, so inspect and resolve any such references before retrying. It leaves the organization, its standard hierarchy, and its existing real employee records in place.

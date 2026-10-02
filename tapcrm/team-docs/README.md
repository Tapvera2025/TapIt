# Team documentation

This folder is the home for TapCRM's maintained product, engineering, security,
design, and delivery documents. Use the section names below to find a document;
the project overview remains in the repository [README](../README.md).

## Document map

| Folder | What belongs here | Key documents |
|---|---|---|
| [`product/`](product/) | Product purpose, scope, and requirements | [PRD](product/PRD.md) |
| [`architecture/`](architecture/) | Technical rules and platform architecture | [TECH](architecture/TECH.md), [PLATFORM](architecture/PLATFORM.md) |
| [`setup/`](setup/) | Environment and platform setup instructions | [Platform setup](setup/PLATFORM_SETUP.md) |
| [`security/`](security/) | Authorization source of truth and its source artifact | [Authorization registry source](security/AUTHORIZATION.md), [delivered PDF](security/source/TapCRM_AUTHORIZATION_v1.8.pdf) |
| [`design/`](design/) | Shared UI and visual system guidance | [UI design system](design/ui-design-system.md) |
| [`specs/`](specs/) | Approved or proposed feature designs, grouped by area | [People design](specs/people/2026-09-22-attendance-shifts-payroll-design.md), [access design](specs/security/2026-09-21-access-management-design.md) |
| [`plans/people/`](plans/people/) | Dated implementation plans grouped by People feature | Attendance, shifts, holidays, biometric, leave, corrections, breaks, payroll, and frontend completion |
| [`guides/`](guides/) | Practical engineering and operational guides | [Notification engine](guides/notifications/notification-engine-guide.md) |
| [`evidence/`](evidence/) | Dated verification records and release evidence | [People evidence folder](evidence/people/README.md) |

## Source-of-truth notes

- `security/AUTHORIZATION.md` is read by `tools/extract-registry.ts` to generate
  the authorization registry. Update the document and generated outputs through
  the documented registry workflow; do not edit generated files by hand.
- The delivered authorization PDF is retained under `security/source/` as the
  source artifact for the Markdown registry document.
- Technical and product documents describe intended rules. When an
  implementation differs, record and resolve that gap instead of silently
  changing the source document's meaning.
- Keep cross-document links relative to this folder so files remain navigable
  when opened from an editor or repository browser.

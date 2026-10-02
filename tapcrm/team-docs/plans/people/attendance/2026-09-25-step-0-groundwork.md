# Step 0 — Groundwork: implementation plan

**Goal.** Build the small platform pieces every People step needs: date and
time helpers, a general job runner, a drainer for the domain outbox, realtime
sockets, and the CI rules that keep modules apart. Nothing here is People-specific.

**Design.** `team-docs/specs/people/2026-09-22-attendance-shifts-payroll-design.md`
§5 (Step 0), and the problems in §2 marked "fixed in step 0".
**Roadmap.** `team-docs/plans/people/attendance/2026-09-25-attendance-roadmap.md`, which
covers all ten steps.

**Done when** (design §5.6):

| Check | Proved by |
|---|---|
| CI catches a sibling-module service import | `tools/ci/boundary.test.ts`, and `npm run ci` printing `bound  module boundaries respected (facades only)` |
| A scheduled job leaves a `job_run` row | `platform/jobs/runner.integration.test.ts` › "done when: a scheduled job leaves a job_run row" |
| An outbox row reaches a connected socket in under a second | `platform/realtime/realtime.integration.test.ts` › "done when: an outbox row reaches the connected socket in under a second" |

**How to use this plan.** Do the tasks in order. Each one writes its test first,
watches it fail, adds the code, then watches it pass. Nothing is committed: each
task ends with its changes left in the working tree for review. All code
below has already been run against this repository: typecheck, lint,
`npm run ci`, and every unit and database test passed.

---

## Before you start: a database for the integration tests

The database tests only run when `TAPCRM_INTEGRATION_DB=1`, and they refuse any
database whose name does not contain `test`. This is the same setup CI uses:

```bash
docker compose up -d postgres redis
psql "postgres://tapcrm_migrator:$POSTGRES_MIGRATOR_PASSWORD@localhost:5432/tapcrm" -c "CREATE DATABASE tapcrm_test;"

export TAPCRM_INTEGRATION_DB=1
export MIGRATION_DATABASE_URL="postgres://tapcrm_migrator:$POSTGRES_MIGRATOR_PASSWORD@localhost:5432/tapcrm_test"
export DATABASE_URL="postgres://tapcrm_app:app_test_password@localhost:5432/tapcrm_test"
export REDIS_URL="redis://localhost:6379"

npm run migrate
# Migration 0008 resets the app role's password, so set it again after migrating.
psql "$MIGRATION_DATABASE_URL" -c "ALTER ROLE tapcrm_app LOGIN PASSWORD 'app_test_password';"
```

Keep these variables set in the terminal you run the tests from. Task 7 adds a
migration; run `npm run migrate` (and the password line) again after it.

One test fails today, before any of this work:
`modules/access-management/overrides.integration.test.ts` (2 tests, "No
ResourcePolicy registered for resource type user" — the test does not register
the policies it needs). It is not touched here. Task 13 leaves it out of CI
until its owner fixes it.

## Files

| File | What changes |
|---|---|
| `vitest.config.ts` | Also runs `tools/**/*.test.ts` |
| `tools/ci/boundary.ts` (+ test) | New: finds imports that reach into another module |
| `tools/ci/time-rules.ts` (+ test) | New: T-2 date shortcuts in People modules, T-4 one date library |
| `tools/ci/index.ts` | Uses the two files above |
| `modules/organization/facade.ts`, `modules/identity/facade.ts` | New: what other modules may import |
| `modules/employee/{routes,service}.ts`, `modules/access-management/{routes,service}.ts` | Import through the façades |
| `packages/contracts/src/people.ts`, `index.ts` | New: `DateOnly`, `LocalTime` |
| `platform/time.ts` (+ test), `platform/organization-time.ts` | New: the one wrapper around Luxon, the `Clock` |
| `modules/identity/geofence/service.ts` (+ integration test) | WFH checked against the organization's date |
| `migrations/0046_people_groundwork.sql` (+ integration test) | `btree_gist`, PRD §5.8 dependencies, outbox and job-run columns |
| `platform/jobs/generation.ts`, `run-record.ts`, `runner.ts` (+ tests) | New: the job runner |
| `platform/dal/context.ts`, `db.ts` | `systemPrincipal`; two named platform operations |
| `modules/{identity,access-management,audit}/jobs.ts`, `modules/index.ts` | The four existing jobs, moved onto the runner |
| `platform/dal/pool.ts` | `listen()`, a LISTEN connection |
| `platform/outbox/registry.ts`, `drainer.ts` | New: the domain outbox drainer |
| `platform/realtime/rooms.ts` (+ test), `server.ts` (+ integration test) | New: Socket.IO with the Redis adapter |
| `modules/identity/authentication/{crypto,authenticate}.ts`, `identity/service.ts`, `identity/routes.ts` | One token check for HTTP and sockets |
| `packages/server/src/index.ts`; delete `platform/jobs.ts` | Start and stop the new pieces |
| `.github/workflows/ci.yml` | Runs every database test, not just the audit drainer's |

(`platform/…` and `modules/…` are under `packages/server/src/`.)

---

## Task 1 — Let the test runner see the CI tools' tests

The CI rules below get unit tests under `tools/ci/`, which Vitest does not look
at today.

- [ ] Change `vitest.config.ts`:

```diff
--- a/vitest.config.ts
+++ b/vitest.config.ts
@@ -4,7 +4,7 @@ import { resolve } from 'node:path';
 export default defineConfig({
   test: {
     environment: 'node',
-    include: ['packages/**/src/**/*.test.ts'],
+    include: ['packages/**/src/**/*.test.ts', 'tools/**/*.test.ts'],
     // TS-I3: results must be comparable across runs.
     sequence: { shuffle: false },
   },
```

Checkpoint: leave the change in the working tree for review.

---

## Task 2 — The module-boundary check catches sibling imports (§5.6 item 1, §2 problem 1)

Today's rule only matches paths containing `modules/`, so
`from '../identity/password/service.js'` passes. The new rule resolves every
relative import against the file that makes it, and allows a cross-module
import only when it lands on that module's `facade.ts`.

- [ ] **Write the test** — `tools/ci/boundary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findBoundaryViolations, locateInModule } from './boundary.js';

const ROOT = '/repo';
const MODULES = '/repo/packages/server/src/modules';
const file = (path: string, text: string) => ({ path: `${MODULES}/${path}`, text });

describe('module boundary (TECH.md §3, MB-1)', () => {
  it('catches a sibling import of another module service', () => {
    const violations = findBoundaryViolations(
      [file('employee/service.ts', "import { hashIdentityPassword } from '../identity/password/service.js';")],
      ROOT,
    );
    expect(violations).toEqual([
      {
        file: 'packages/server/src/modules/employee/service.ts',
        line: 1,
        from: 'employee',
        to: 'identity',
        specifier: '../identity/password/service.js',
      },
    ]);
  });

  it('catches the long form through modules/', () => {
    const violations = findBoundaryViolations(
      [file('employee/routes.ts', "import { x } from '../../modules/organization/chart/service.js';")],
      ROOT,
    );
    expect(violations.map((v) => v.to)).toEqual(['organization']);
  });

  it('catches type-only imports, re-exports and error classes too', () => {
    const violations = findBoundaryViolations(
      [
        file(
          'employee/service.ts',
          [
            "import type { IdentityUser } from '../identity/authentication/principal.js';",
            "import { IdentityValidationError } from '../identity/errors.js';",
            "export { findTeam } from '../organization/teams/repository.js';",
          ].join('\n'),
        ),
      ],
      ROOT,
    );
    expect(violations.map((v) => v.line)).toEqual([1, 2, 3]);
  });

  it('reports the line of a multi-line import', () => {
    const violations = findBoundaryViolations(
      [file('access-management/service.ts', "import {\n  a,\n  b,\n} from '../organization/reporting/service.js';")],
      ROOT,
    );
    expect(violations.map((v) => v.line)).toEqual([4]);
  });

  it("allows another module's facade", () => {
    expect(
      findBoundaryViolations(
        [file('employee/service.ts', "import { hashIdentityPassword } from '../identity/facade.js';")],
        ROOT,
      ),
    ).toEqual([]);
  });

  it('allows any import inside the same module', () => {
    expect(
      findBoundaryViolations(
        [file('organization/chart/service.ts', "import { findTeam } from '../teams/repository.js';")],
        ROOT,
      ),
    ).toEqual([]);
  });

  it('exempts the composition root in modules/index.ts', () => {
    expect(
      findBoundaryViolations(
        [file('index.ts', "import { registerEmployeeRoutes } from './employee/routes.js';")],
        ROOT,
      ),
    ).toEqual([]);
  });

  it('ignores package imports and platform imports', () => {
    expect(
      findBoundaryViolations(
        [
          file(
            'employee/service.ts',
            "import { z } from 'zod';\nimport { db } from '../../platform/dal/db.js';",
          ),
        ],
        ROOT,
      ),
    ).toEqual([]);
  });

  it('does not treat a nested folder called facade as the facade', () => {
    const violations = findBoundaryViolations(
      [file('employee/service.ts', "import { x } from '../identity/facade/service.js';")],
      ROOT,
    );
    expect(violations).toHaveLength(1);
  });

  it('locates module files and nothing else', () => {
    expect(locateInModule(ROOT, `${MODULES}/identity/password/service.ts`)).toEqual({
      module: 'identity',
      inside: ['password', 'service'],
    });
    expect(locateInModule(ROOT, `${MODULES}/index.ts`)).toBeNull();
    expect(locateInModule(ROOT, '/repo/packages/server/src/platform/dal/db.ts')).toBeNull();
  });
});
```

- [ ] **Run it and watch it fail:**

```bash
npx vitest run tools/ci/boundary.test.ts
```

Expected: the file fails to load — `Error: Failed to load url ./boundary.js … Does the file exist?`

- [ ] **Add the rule** — `tools/ci/boundary.ts`:

```ts
import { dirname, relative, resolve, sep } from 'node:path';

/**
 * Module boundary — TECH.md §3 and MB-1/MB-5.
 *
 * A module may import `contracts`, `authz`, `platform` and its own files. From
 * another module it may import that module's `facade.ts` and nothing else.
 * `modules/index.ts` — the composition root that registers every module's
 * routes, policies and jobs — sits outside any module and is exempt.
 *
 * The check resolves each relative import against the importing file, so
 * `../identity/password/service.js` is caught as surely as
 * `../../modules/identity/password/service.js`. The earlier check matched only
 * paths that spelled out `modules/`, and missed the first form.
 */

export interface SourceFile {
  /** Absolute path of the file. */
  readonly path: string;
  readonly text: string;
}

export interface BoundaryViolation {
  /** Repository-relative path of the importing file. */
  readonly file: string;
  readonly line: number;
  /** The importing module. */
  readonly from: string;
  /** The module the import reaches into. */
  readonly to: string;
  readonly specifier: string;
}

const SPECIFIER_PATTERNS: readonly RegExp[] = [
  /\bfrom\s*['"]([^'"]+)['"]/g, // import … from '…', export … from '…'
  /\bimport\s*['"]([^'"]+)['"]/g, // import '…'
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, // import('…')
];

/**
 * Where a path sits under `server/src/modules`: the module folder and the path
 * inside it. Null for anything else, including files directly in `modules/`.
 */
export function locateInModule(
  root: string,
  absolutePath: string,
): { module: string; inside: string[] } | null {
  const parts = relative(root, absolutePath.replace(/\.(js|ts)$/, '')).split(sep);
  for (let i = 0; i + 3 < parts.length; i += 1) {
    if (parts[i] === 'server' && parts[i + 1] === 'src' && parts[i + 2] === 'modules') {
      const inside = parts.slice(i + 4);
      const module = parts[i + 3];
      return module !== undefined && inside.length > 0 ? { module, inside } : null;
    }
  }
  return null;
}

export function findBoundaryViolations(
  files: readonly SourceFile[],
  root: string,
): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  for (const file of files) {
    const own = locateInModule(root, file.path);
    if (own === null) continue; // the composition root and non-module code
    for (const pattern of SPECIFIER_PATTERNS) {
      for (const match of file.text.matchAll(pattern)) {
        const specifier = match[1] ?? '';
        if (!specifier.startsWith('.')) continue;
        const target = locateInModule(root, resolve(dirname(file.path), specifier));
        if (target === null || target.module === own.module) continue;
        const isFacade = target.inside.length === 1 && target.inside[0] === 'facade';
        if (isFacade) continue;
        violations.push({
          file: relative(root, file.path),
          line: file.text.slice(0, match.index).split('\n').length,
          from: own.module,
          to: target.module,
          specifier,
        });
      }
    }
  }
  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
```

- [ ] **Run the test again.** Expected: `Tests  10 passed (10)`.

- [ ] **Use it in `npm run ci`.** In `tools/ci/index.ts`, add the import beside the others at the top:

```ts
import { findBoundaryViolations } from './boundary.js';
```

and replace the whole `Module boundary — TECH.md §3` block (the `{ … }` that
builds `importMatch`) with:

```ts
/* ================================================================== *
 * Module boundary — TECH.md §3, MB-1, MB-5
 *
 * Another module is reached only through its facade.ts. Relative imports are
 * resolved against the importing file (tools/ci/boundary.ts), so a sibling
 * path such as `../identity/password/service.js` cannot slip through.
 * ================================================================== */
{
  const violations = findBoundaryViolations(
    moduleFiles.map((file) => ({ path: file, text: read(file) })),
    ROOT,
  );
  for (const v of violations) {
    blocking(
      'boundary',
      '§3',
      `${v.file}:${v.line} reaches into module "${v.to}" (${v.specifier}). ` +
        `Import ${v.to}/facade.ts instead; a module may not import another module's internals (MB-1).`,
    );
  }
  if (violations.length === 0) ok('bound  module boundaries respected (facades only)');
}

```

- [ ] **Run the CI script:**

```bash
npm run ci
```

Expected: it now **fails** with 10 `boundary` findings — six in `employee/`, four
in `access-management/` — each giving the file, the line and the module it
reaches into. That is the check doing its job. Task 3 fixes them.

Checkpoint: leave the changes in the working tree for review.

---

## Task 3 — Façades for `organization` and `identity`

Each module gets one file that says what other modules may use. The callers
switch to it; nothing else moves.

- [ ] **Create** `packages/server/src/modules/organization/facade.ts`:

```ts
/**
 * Organization's public surface for other modules — MB-1, MB-5.
 *
 * Another module imports this file and nothing else from `organization`;
 * `npm run ci` refuses any other cross-module import. Keep the list narrow and
 * the callers known:
 *
 *   employee           getOrganizationChart, listReportingManagerOptions,
 *                      validateManagerAssignment
 *   access-management  validateManagerAssignment, findTeam
 */
export { getOrganizationChart } from './chart/service.js';
export { listReportingManagerOptions, validateManagerAssignment } from './reporting/service.js';
export { findTeam } from './teams/repository.js';
```

- [ ] **Create** `packages/server/src/modules/identity/facade.ts`:

```ts
/**
 * Identity's public surface for other modules — MB-1, MB-5.
 *
 * Another module imports this file and nothing else from `identity`;
 * `npm run ci` refuses any other cross-module import. Callers:
 *
 *   employee           IdentityConflictError, IdentityValidationError,
 *                      hashIdentityPassword, sendEmployeeCredentials
 *   access-management  userResource
 */
export { IdentityConflictError, IdentityValidationError } from './errors.js';
export { hashIdentityPassword } from './password/service.js';
export { sendEmployeeCredentials } from './notifications/invitation-email.js';
export { userResource } from './security/unlock.js';
```

- [ ] **Point the callers at the façades:**

```diff
--- a/packages/server/src/modules/employee/routes.ts
+++ b/packages/server/src/modules/employee/routes.ts
@@ -1,8 +1,7 @@
 import { route } from '../../platform/http/route.js';
 import { provisionEmployee } from './service.js';
 import { createEmployeeSchema } from './validators.js';
-import { getOrganizationChart } from '../organization/chart/service.js';
-import { listReportingManagerOptions } from '../organization/reporting/service.js';
+import { getOrganizationChart, listReportingManagerOptions } from '../organization/facade.js';
 import { z } from 'zod';
 
 export function registerEmployeeRoutes(): void {
```

```diff
--- a/packages/server/src/modules/employee/service.ts
+++ b/packages/server/src/modules/employee/service.ts
@@ -1,9 +1,12 @@
 import type { RequestContext } from '../../platform/dal/context.js';
 import { db } from '../../platform/dal/db.js';
-import { IdentityConflictError, IdentityValidationError } from '../identity/errors.js';
-import { hashIdentityPassword } from '../identity/password/service.js';
-import { sendEmployeeCredentials } from '../identity/notifications/invitation-email.js';
-import { validateManagerAssignment } from '../organization/reporting/service.js';
+import {
+  IdentityConflictError,
+  IdentityValidationError,
+  hashIdentityPassword,
+  sendEmployeeCredentials,
+} from '../identity/facade.js';
+import { validateManagerAssignment } from '../organization/facade.js';
 import {
   allocateEmployeeId,
   createEmployee,
```

```diff
--- a/packages/server/src/modules/access-management/routes.ts
+++ b/packages/server/src/modules/access-management/routes.ts
@@ -1,5 +1,5 @@
 import { route } from '../../platform/http/route.js';
-import { userResource } from '../identity/security/unlock.js';
+import { userResource } from '../identity/facade.js';
 import { z } from 'zod';
 import { loadOverrideResource, loadRoleChangeResource } from './repository.js';
 import {
```

```diff
--- a/packages/server/src/modules/access-management/service.ts
+++ b/packages/server/src/modules/access-management/service.ts
@@ -18,9 +18,8 @@ import type { RequestContext } from '../../platform/dal/context.js';
 import { scopeResolver } from '../../platform/authz-adapter.js';
 import { db } from '../../platform/dal/db.js';
 import { sql } from '../../platform/dal/sql.js';
-import { userResource } from '../identity/security/unlock.js';
-import { validateManagerAssignment } from '../organization/reporting/service.js';
-import { findTeam } from '../organization/teams/repository.js';
+import { userResource } from '../identity/facade.js';
+import { findTeam, validateManagerAssignment } from '../organization/facade.js';
 import { assertDelegationAllowed } from './delegation.js';
 import { ACCESS_ERROR_CODES, AccessNotFoundError, AccessValidationError } from './errors.js';
 import {
```

- [ ] **Check:**

```bash
npm run typecheck && npm run ci
```

Expected: typecheck passes, and the CI script prints
`✓ bound  module boundaries respected (facades only)`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 4 — T-2 and T-4: dates in People modules, one date library (§5.1, §5.6 item 2)

T-2 stops a People module from taking "today" from the database or from a UTC
string — the old system's `toISOString().slice(0, 10)` read yesterday before
05:30 IST (TapCRM L19). T-4 keeps Luxon inside `platform/time.ts`. Neither
fires today; they guard the People modules as they arrive.

- [ ] **Write the test** — `tools/ci/time-rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findDateShortcuts, findTimeLibraryImports } from './time-rules.js';

const ROOT = '/repo';
const MODULES = '/repo/packages/server/src/modules';

describe('T-2 — People modules never take a day from the database or a UTC string', () => {
  it('flags each shortcut in a People module, with its line', () => {
    const text = [
      'const a = sql`SELECT * FROM x WHERE work_date = CURRENT_DATE`;',
      'const b = sql`SELECT now()::date`;',
      'const c = new Date().toISOString().slice(0, 10);',
      "const d = new Date().toISOString().split('T')[0];",
    ].join('\n');
    const violations = findDateShortcuts([{ path: `${MODULES}/attendance/service.ts`, text }], ROOT);
    expect(violations.map((v) => [v.line, v.what])).toEqual([
      [1, 'CURRENT_DATE'],
      [2, 'now()::date'],
      [3, 'toISOString().slice(0, 10)'],
      [4, "toISOString().split('T')"],
    ]);
  });

  it('covers every People module and nothing else', () => {
    const text = 'WHERE d = current_date';
    const inPeople = ['shifts', 'holidays', 'attendance', 'live-status', 'biometric', 'leave', 'break-management', 'payroll'];
    for (const module of inPeople) {
      expect(findDateShortcuts([{ path: `${MODULES}/${module}/repository.ts`, text }], ROOT)).toHaveLength(1);
    }
    expect(findDateShortcuts([{ path: `${MODULES}/audit/integrity.ts`, text }], ROOT)).toEqual([]);
    expect(findDateShortcuts([{ path: '/repo/packages/server/src/platform/time.ts', text }], ROOT)).toEqual([]);
  });
});

describe('T-4 — one date library, wrapped once', () => {
  it('allows luxon only in platform/time.ts', () => {
    const text = "import { DateTime } from 'luxon';";
    expect(findTimeLibraryImports([{ path: '/repo/packages/server/src/platform/time.ts', text }], ROOT)).toEqual([]);
    expect(
      findTimeLibraryImports([{ path: `${MODULES}/shifts/resolver.ts`, text }], ROOT).map((v) => v.file),
    ).toEqual(['packages/server/src/modules/shifts/resolver.ts']);
  });

  it('also catches a dynamic import', () => {
    const text = "const { DateTime } = await import('luxon');";
    expect(findTimeLibraryImports([{ path: `${MODULES}/payroll/service.ts`, text }], ROOT)).toHaveLength(1);
  });
});
```

- [ ] **Run it and watch it fail:** `npx vitest run tools/ci/time-rules.test.ts`
  — expected: `Error: Failed to load url ./time-rules.js … Does the file exist?`.

- [ ] **Add the rules** — `tools/ci/time-rules.ts`:

```ts
import { relative, sep } from 'node:path';
import { locateInModule, type SourceFile } from './boundary.js';

/**
 * Time rules — attendance design §5.1.
 *
 * T-2  People modules take a day from the shifts façade or from
 *      platform/time.ts in the organization's timezone — never from the
 *      database's date or from a UTC string. `toISOString().slice(0, 10)` read
 *      the previous day before 05:30 IST in the old system (L19).
 * T-4  One date library, wrapped once in platform/time.ts, so replacing it is
 *      a one-file change.
 */

export const PEOPLE_MODULES: readonly string[] = [
  'shifts',
  'holidays',
  'attendance',
  'live-status',
  'biometric',
  'leave',
  'break-management',
  'payroll',
];

export interface TimeRuleViolation {
  readonly file: string;
  readonly line: number;
  readonly what: string;
}

const DATE_SHORTCUTS: readonly { pattern: RegExp; what: string }[] = [
  { pattern: /\bCURRENT_DATE\b/gi, what: 'CURRENT_DATE' },
  { pattern: /\bnow\(\)\s*::\s*date\b/gi, what: 'now()::date' },
  { pattern: /\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/g, what: 'toISOString().slice(0, 10)' },
  { pattern: /\.toISOString\(\)\s*\.split\(\s*['"]T['"]\s*\)/g, what: "toISOString().split('T')" },
];

const LUXON_IMPORT = /\bfrom\s*['"]luxon['"]|\bimport\(\s*['"]luxon['"]\s*\)|\brequire\(\s*['"]luxon['"]\s*\)/g;

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

export function findDateShortcuts(files: readonly SourceFile[], root: string): TimeRuleViolation[] {
  const violations: TimeRuleViolation[] = [];
  for (const file of files) {
    const location = locateInModule(root, file.path);
    if (location === null || !PEOPLE_MODULES.includes(location.module)) continue;
    for (const { pattern, what } of DATE_SHORTCUTS) {
      for (const match of file.text.matchAll(pattern)) {
        violations.push({ file: relative(root, file.path), line: lineOf(file.text, match.index), what });
      }
    }
  }
  return violations;
}

export function findTimeLibraryImports(files: readonly SourceFile[], root: string): TimeRuleViolation[] {
  const allowed = ['packages', 'server', 'src', 'platform', 'time.ts'].join(sep);
  const violations: TimeRuleViolation[] = [];
  for (const file of files) {
    const path = relative(root, file.path);
    if (path === allowed) continue;
    for (const match of file.text.matchAll(LUXON_IMPORT)) {
      violations.push({ file: path, line: lineOf(file.text, match.index), what: 'luxon' });
    }
  }
  return violations;
}
```

- [ ] **Run the test again.** Expected: `Tests  4 passed (4)`.

- [ ] **Use them in `npm run ci`.** Add the import at the top of `tools/ci/index.ts`:

```ts
import { findDateShortcuts, findTimeLibraryImports } from './time-rules.js';
```

and add this block straight after the module-boundary block:

```ts
/* ================================================================== *
 * T-2 / T-4 — dates in People modules (attendance design §5.1)
 *
 * T-2: a People module takes a day from the shifts façade or platform/time.ts
 *      in the organization's timezone, never CURRENT_DATE, now()::date or the
 *      date part of a UTC string.
 * T-4: luxon is imported by platform/time.ts and nothing else.
 * ================================================================== */
{
  const everything = serverFiles.map((file) => ({ path: file, text: read(file) }));
  const shortcuts = findDateShortcuts(everything, ROOT);
  for (const v of shortcuts) {
    blocking(
      'T-2',
      'T-2',
      `${v.file}:${v.line} uses ${v.what}. Take the day from the shifts façade or ` +
        "platform/time.ts in the organization's timezone.",
    );
  }
  if (shortcuts.length === 0) ok('T-2    People modules take dates in the organization timezone');

  const libraries = findTimeLibraryImports(everything, ROOT);
  for (const v of libraries) {
    blocking('T-4', 'T-4', `${v.file}:${v.line} imports luxon. Use platform/time.ts.`);
  }
  if (libraries.length === 0) ok('T-4    one date library, imported only by platform/time.ts');
}

```

- [ ] **Run** `npm run ci`. Expected: `✓ T-2    People modules take dates in the organization timezone`
  and `✓ T-4    one date library, imported only by platform/time.ts`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 5 — Time helpers and the clock (§5.1, §5.3)

Luxon is only in the lockfile today, through `cron-parser`. It becomes a direct
dependency of the server, wrapped once. `DateOnly` and `LocalTime` are the first
two shared types from §5.3; the rest arrive with the steps that first use them
(see the roadmap).

- [ ] **Add the dependency:**

```bash
npm install luxon@^3.7.2 --workspace @tapcrm/server
npm install --save-dev @types/luxon@^3.7.5 --workspace @tapcrm/server
```

- [ ] **Create** `packages/contracts/src/people.ts`:

```ts
/**
 * People — shared types for shifts, holidays, attendance, live status,
 * biometric, leave, breaks and payroll (attendance design §5.3).
 *
 * Types only. Later build steps add the shift, event and presence types here;
 * step 0 needs the two that every date in those modules is written in.
 */

/** A calendar day in the organization's timezone, 'YYYY-MM-DD' (T-1). */
export type DateOnly = string & { readonly __brand: 'DateOnly' };

/** A wall-clock time of day, 'HH:mm' (T-3). */
export type LocalTime = string & { readonly __brand: 'LocalTime' };
```

and export it from `packages/contracts/src/index.ts`:

```diff
--- a/packages/contracts/src/index.ts
+++ b/packages/contracts/src/index.ts
@@ -21,3 +21,4 @@ export * from './registry.generated.js';
 export * from './actionMetadata.js';
 export * from './principal.js';
 export * from './platform.js';
+export * from './people.js';
```

- [ ] **Write the test** — `packages/server/src/platform/time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addDays,
  fixedClock,
  instantAt,
  isTimeZone,
  localDateOf,
  systemClock,
  toDateOnly,
  toLocalTime,
  wholeSeconds,
} from './time.js';

const IST = 'Asia/Kolkata';

describe('T-1 — a day is a date in the organization timezone', () => {
  it('00:10 IST is already the next day, though UTC still says the day before (L19)', () => {
    // 18:40 UTC on the 24th is 00:10 IST on the 25th.
    expect(localDateOf(new Date('2026-09-24T18:40:00Z'), IST)).toBe('2026-09-25');
  });

  it('23:59:59 IST is still the same day', () => {
    expect(localDateOf(new Date('2026-09-24T18:29:59Z'), IST)).toBe('2026-09-24');
  });
});

describe('T-3 — a shift time becomes an instant with that date\'s zone rules', () => {
  it('20:00 on 26 September in IST is 14:30 UTC', () => {
    expect(instantAt(toDateOnly('2026-09-26'), toLocalTime('20:00'), IST).toISOString()).toBe(
      '2026-09-26T14:30:00.000Z',
    );
  });

  it('the same 09:00 moves with a daylight-saving change, so no boundary shifts', () => {
    const zone = 'America/New_York'; // clocks went forward on 8 March 2026
    expect(instantAt(toDateOnly('2026-03-06'), toLocalTime('09:00'), zone).toISOString()).toBe(
      '2026-03-06T14:00:00.000Z',
    );
    expect(instantAt(toDateOnly('2026-03-09'), toLocalTime('09:00'), zone).toISOString()).toBe(
      '2026-03-09T13:00:00.000Z',
    );
  });
});

describe('T-5 — time is injected, never read from the wall clock in a calculator', () => {
  it('a fixed clock always answers the same instant', () => {
    const clock = fixedClock('2026-09-25T04:00:00Z');
    expect(clock.now().toISOString()).toBe('2026-09-25T04:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-09-25T04:00:00.000Z');
  });

  it('the system clock answers now', () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
  });
});

describe('T-6 — instants are whole seconds', () => {
  it('drops the milliseconds', () => {
    expect(wholeSeconds(new Date('2026-09-25T10:00:00.999Z')).toISOString()).toBe(
      '2026-09-25T10:00:00.000Z',
    );
  });
});

describe('date and time values', () => {
  it('adds days across a month end', () => {
    expect(addDays(toDateOnly('2026-03-31'), 1)).toBe('2026-04-01');
    expect(addDays(toDateOnly('2026-03-01'), -1)).toBe('2026-02-28');
  });

  it('refuses a date that is not on the calendar, and a malformed time', () => {
    expect(() => toDateOnly('2026-02-30')).toThrow(/not a calendar date/);
    expect(() => toDateOnly('25-09-2026')).toThrow(/not a calendar date/);
    expect(() => toLocalTime('24:00')).toThrow(/not a time of day/);
    expect(() => toLocalTime('9:00')).toThrow(/not a time of day/);
  });

  it('knows a real timezone from a typo', () => {
    expect(isTimeZone(IST)).toBe(true);
    expect(isTimeZone('Asia/Kolkatta')).toBe(false);
  });
});
```

- [ ] **Run it and watch it fail:** `npx vitest run packages/server/src/platform/time.test.ts`
  — expected: `Error: Failed to load url ./time.js … Does the file exist?`.

- [ ] **Create** `packages/server/src/platform/time.ts`:

```ts
import { DateTime, IANAZone } from 'luxon';
import type { DateOnly, LocalTime } from '@tapcrm/contracts';

/**
 * Dates and times — attendance design §5.1.
 *
 *   T-1  Instants are UTC; a day is a date in the organization's timezone.
 *   T-3  A shift time becomes an instant with THAT date's zone rules, so a
 *        daylight-saving change cannot move a boundary.
 *   T-4  This is the only file that imports luxon (`npm run ci` enforces it),
 *        so moving to the built-in Temporal later is a one-file change.
 *   T-5  Services and jobs take a Clock; tests pass a fixed one.
 *   T-6  Event instants are whole seconds.
 */

/** T-5 — the one way to ask the time. Calculators never ask at all. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(at: Date | string): Clock {
  const instant = new Date(at).getTime();
  if (Number.isNaN(instant)) throw new RangeError(`"${String(at)}" is not an instant`);
  return { now: () => new Date(instant) };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function toDateOnly(value: string): DateOnly {
  if (DATE_ONLY.test(value) && DateTime.fromISO(value, { zone: 'UTC' }).isValid) {
    return value as DateOnly;
  }
  throw new RangeError(`"${value}" is not a calendar date (YYYY-MM-DD)`);
}

export function toLocalTime(value: string): LocalTime {
  if (LOCAL_TIME.test(value)) return value as LocalTime;
  throw new RangeError(`"${value}" is not a time of day (HH:mm)`);
}

export function isTimeZone(zone: string): boolean {
  return IANAZone.isValidZone(zone);
}

function zoneOrThrow(zone: string): string {
  if (!IANAZone.isValidZone(zone)) throw new RangeError(`"${zone}" is not an IANA timezone`);
  return zone;
}

/** T-6 — drops the milliseconds. */
export function wholeSeconds(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / 1000) * 1000);
}

/** T-1 — the calendar date an instant falls on in `zone`. */
export function localDateOf(instant: Date, zone: string): DateOnly {
  const date = DateTime.fromJSDate(instant, { zone: zoneOrThrow(zone) }).toISODate();
  if (date === null) throw new RangeError(`${String(instant)} is not a valid instant`);
  return date as DateOnly;
}

/** T-3 — the instant a wall-clock time on `date` happens in `zone`. */
export function instantAt(date: DateOnly, time: LocalTime, zone: string): Date {
  const local = DateTime.fromISO(`${date}T${time}`, { zone: zoneOrThrow(zone) });
  if (!local.isValid) throw new RangeError(`${date} ${time} does not exist in ${zone}`);
  return local.toJSDate();
}

export function addDays(date: DateOnly, days: number): DateOnly {
  const next = DateTime.fromISO(date, { zone: 'UTC' }).plus({ days }).toISODate();
  if (next === null) throw new RangeError(`cannot add ${days} days to ${date}`);
  return next as DateOnly;
}
```

- [ ] **Create** `packages/server/src/platform/organization-time.ts`:

```ts
import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from './dal/db.js';
import { sql } from './dal/sql.js';
import { localDateOf, systemClock, type Clock } from './time.js';

/**
 * The organization's own calendar — NF-15, attendance design T-1.
 *
 * Both functions read the organization of the transaction they are given, so
 * they cannot be pointed at another tenant's timezone.
 */
export async function organizationTimezone(tx: Tx): Promise<string> {
  const row = await tx.one<{ timezone: string }>(sql`
    SELECT timezone FROM organization WHERE id = current_organization_id()
  `);
  return row.timezone;
}

/** Today's date for the transaction's organization, from an injectable clock (T-5). */
export async function organizationToday(tx: Tx, clock: Clock = systemClock): Promise<DateOnly> {
  return localDateOf(clock.now(), await organizationTimezone(tx));
}
```

- [ ] **Run the test again.** Expected: `Tests  10 passed (10)`. Then
  `npm run typecheck && npm run ci` — T-4 still passes, because only `time.ts` imports Luxon.

Checkpoint: leave the changes in the working tree for review.

---

## Task 6 — Approved WFH uses the organization's date (§5.6 item 3, §2 problem 2)

`enforceGeofencedLogin` compares `work_date = CURRENT_DATE`. The database runs in
UTC, so between 00:00 and 05:30 IST it checks yesterday's approval. It now
asks `organizationToday`, and takes a `Clock` so a test can fix the time.

- [ ] **Write the test** —
  `packages/server/src/modules/identity/geofence/wfh-date.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { sql } from '../../../platform/dal/sql.js';
import { fixedClock } from '../../../platform/time.js';
import type { IdentityUser } from '../authentication/principal.js';
import { enforceGeofencedLogin } from './service.js';

/**
 * WFH-2 / ID-18b — approved work from home is checked against the
 * organization's date (attendance design §2, problem 2; T-1).
 *
 * Opt-in, like the other database tests:
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const migrationUrl = process.env['MIGRATION_DATABASE_URL'] ?? '';

const ORG = randomUUID();
const DEPT = randomUUID();
const POS = randomUUID();
const EMPLOYEE = randomUUID();
const APPROVER = randomUUID();

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);

const employee: IdentityUser = {
  id: EMPLOYEE,
  organizationId: ORG,
  accountType: 'employee',
  email: `wfh-${EMPLOYEE}@t.io`,
  fullName: 'Remote Worker',
  passwordHash: null,
  status: 'active',
  organizationStatus: 'active',
  mustChangePassword: false,
  lockedUntil: null,
  sessionVersion: 1,
  positionId: POS,
  departmentId: DEPT,
  teamId: null,
  reportsTo: null,
  clientId: null,
  organizationalLevel: 20,
  geofenceRequired: true,
};

const login = { organizationId: ORG, userId: EMPLOYEE, accountType: 'employee' as const, user: employee };

describe.skipIf(!enabled)('approved WFH uses the organization date (PostgreSQL)', () => {
  beforeAll(async () => {
    if (!new URL(migrationUrl).pathname.includes('test')) throw new Error('refusing non-test database');
    await asOwner('create test organization', sql`
      INSERT INTO organization (id, code, name, timezone)
      VALUES (${ORG}, ${`WF${ORG.slice(0, 6)}`}, 'WFH Date Test', 'Asia/Kolkata')`);
    await asOwner('create test department', sql`
      INSERT INTO department (id, organization_id, code, name, kind)
      VALUES (${DEPT}, ${ORG}, 'OPS', 'Operations', 'operations')`);
    await asOwner('create test position', sql`
      INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
      VALUES (${POS}, ${ORG}, ${DEPT}, 'OPS-1', 'Operator', 20)`);
    await asOwner('create employee and approver', sql`
      INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id, geofence_required)
      VALUES (${EMPLOYEE}, ${ORG}, 'employee', 'EMP-WFH01', ${employee.email}, 'Remote Worker', ${POS}, ${DEPT}, true),
             (${APPROVER}, ${ORG}, 'employee', 'EMP-WFH02', ${`approver-${APPROVER}@t.io`}, 'Approver', ${POS}, ${DEPT}, false)`);
    await asOwner('approve WFH for 25 September', sql`
      INSERT INTO work_from_home_day (organization_id, user_id, work_date, reason, approved_by)
      VALUES (${ORG}, ${EMPLOYEE}, '2026-09-25', 'Internet installation at home', ${APPROVER})`);
  });

  afterAll(async () => {
    await asOwner('remove WFH rows', sql`DELETE FROM work_from_home_day WHERE organization_id = ${ORG}`);
    await asOwner('remove directory rows', sql`DELETE FROM identity_email_directory WHERE organization_id = ${ORG}`);
    await asOwner('remove users', sql`DELETE FROM app_user WHERE organization_id = ${ORG}`);
    await asOwner('remove position', sql`DELETE FROM position WHERE organization_id = ${ORG}`);
    await asOwner('remove department', sql`DELETE FROM department WHERE organization_id = ${ORG}`);
    await asOwner('remove organization', sql`DELETE FROM organization WHERE id = ${ORG}`);
    await closePools();
  });

  it('at 00:30 IST on the 25th the WFH approval for the 25th applies, though UTC still says the 24th', async () => {
    await expect(
      enforceGeofencedLogin(login, fixedClock('2026-09-24T19:00:00Z')),
    ).resolves.toBeUndefined();
  });

  it('at 23:30 IST on the 24th there is no approval, so a location is required', async () => {
    await expect(
      enforceGeofencedLogin(login, fixedClock('2026-09-24T18:00:00Z')),
    ).rejects.toMatchObject({ code: 'IDENTITY_LOCATION_REQUIRED' });
  });
});
```

- [ ] **Run it against the old code** (integration variables set):

```bash
npx vitest run packages/server/src/modules/identity/geofence/wfh-date.integration.test.ts
```

Expected: at least one of the two tests fails. The old code ignores the clock
and uses the database's date, so it can never pass both — which one fails
depends on today's date.

- [ ] **Fix the service** — `packages/server/src/modules/identity/geofence/service.ts`:

```diff
--- a/packages/server/src/modules/identity/geofence/service.ts
+++ b/packages/server/src/modules/identity/geofence/service.ts
@@ -7,14 +7,19 @@ import { getUserGeofenceNotice } from './privacy.js';
 import { sql } from '../../../platform/dal/sql.js';
 import { createIdentityContext, type IdentityUser } from '../authentication/principal.js';
 import { findUserById } from '../repository.js';
+import { organizationToday } from '../../../platform/organization-time.js';
+import { systemClock, type Clock } from '../../../platform/time.js';
 
-export async function enforceGeofencedLogin(input: { organizationId: string; userId: string; accountType: AccountType; user: IdentityUser; latitude?: number; longitude?: number; accuracyMetres?: number | null; ip?: string | null }) {
+export async function enforceGeofencedLogin(input: { organizationId: string; userId: string; accountType: AccountType; user: IdentityUser; latitude?: number; longitude?: number; accuracyMetres?: number | null; ip?: string | null }, clock: Clock = systemClock) {
   // ID-17 — the root principal is never geofenced.
   if (globalAccess(input)) return;
   const exception = await db.transaction(createIdentityContext(input.user, `identity:geofence-exception:${input.userId}`), async (tx) => {
+    // WFH-2 / ID-18b — approved WFH is for the organization's date, not the
+    // database's: before 05:30 IST, CURRENT_DATE was still yesterday (UTC).
+    const today = await organizationToday(tx, clock);
     const wfh = await tx.maybeOne<{ id: string }>(sql`
       SELECT id FROM work_from_home_day
-      WHERE organization_id = ${input.organizationId} AND user_id = ${input.userId} AND work_date = CURRENT_DATE
+      WHERE organization_id = ${input.organizationId} AND user_id = ${input.userId} AND work_date = ${today}
     `);
     const bypass = await tx.maybeOne<{ id: string }>(sql`
       SELECT a.location_id AS id FROM geofence_assignment a
```

- [ ] **Run the test again.** Expected: `Tests  2 passed (2)`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 7 — Migration 0046 (§5.6 item 4, §2 problem 4, and the columns tasks 9–11 need)

One migration for the whole step:

- `btree_gist`, for the "no two periods overlap" constraints from step 1 on;
- the PRD §5.8 dependency rows, so enabling `payroll` also enables `attendance`,
  `leave`, `break-management` and `shifts`;
- `domain_outbox.claimed_until` and a NOTIFY trigger, for the drainer (task 11);
- `job_run.attempts` and `job_run.dead_lettered_at`, for the runner (task 9).

- [ ] **Write the test** —
  `packages/server/src/platform/modules/dependencies.integration.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { platformDb } from '../dal/db.js';
import { closePools } from '../dal/pool.js';
import { sql } from '../dal/sql.js';

/**
 * Migration 0046 — PRD §5.8 dependencies for the People modules, and the
 * btree_gist extension later steps' overlap constraints need.
 *
 * Opt-in: TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';

async function closureOf(key: string): Promise<string[]> {
  const rows = await platformDb.query<{ key: string }>(
    'migration',
    `dependency closure of ${key}`,
    sql`
      WITH RECURSIVE closure(id) AS (
        SELECT id FROM module WHERE key = ${key}
        UNION
        SELECT md.depends_on_module_id FROM module_dependency md JOIN closure c ON md.module_id = c.id
      )
      SELECT m.key FROM closure c JOIN module m ON m.id = c.id WHERE m.key <> ${key} ORDER BY m.key
    `,
  );
  return rows.map((row) => row.key);
}

describe.skipIf(!enabled)('People module dependencies (PostgreSQL)', () => {
  afterAll(async () => {
    await closePools();
  });

  it('enabling payroll brings attendance, leave, break-management and shifts with it', async () => {
    expect(await closureOf('payroll')).toEqual(
      expect.arrayContaining(['attendance', 'break-management', 'leave', 'shifts']),
    );
  });

  it('follows PRD §5.8 for the rest of the People modules', async () => {
    expect(await closureOf('live-status')).toEqual(expect.arrayContaining(['attendance', 'shifts']));
    expect(await closureOf('biometric')).toEqual(expect.arrayContaining(['attendance', 'shifts']));
    expect(await closureOf('holidays')).toEqual(expect.arrayContaining(['shifts']));
    expect(await closureOf('shifts')).not.toContain('attendance');
  });

  it('has btree_gist installed', async () => {
    const rows = await platformDb.query<{ extname: string }>(
      'migration',
      'check btree_gist',
      sql`SELECT extname FROM pg_extension WHERE extname = 'btree_gist'`,
    );
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Run it and watch it fail:**
  `npx vitest run packages/server/src/platform/modules/dependencies.integration.test.ts`
  — expected: the closure tests fail (payroll's closure is empty of People
  modules) and the `btree_gist` test fails.

- [ ] **Create** `migrations/0046_people_groundwork.sql`:

```sql
-- =====================================================================
-- 0046 - People groundwork (attendance design, step 0)
-- =====================================================================

-- ---------------------------------------------------------------------
-- btree_gist, for the "no two periods overlap" constraints that shift
-- assignments, PIN mappings and salary structures use from step 1 on
-- (EXCLUDE USING gist with plain equality columns beside a daterange).
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------
-- PRD §5.8 dependency column for the People modules. Enabling a module
-- enables its whole closure (platform/modules/service.ts), so enabling
-- payroll also enables attendance, leave, break-management and shifts.
-- ---------------------------------------------------------------------
INSERT INTO module_dependency (module_id, depends_on_module_id)
SELECT m.id, d.id
FROM (VALUES
  ('live-status',      'attendance'),
  ('attendance',       'shifts'),
  ('break-management', 'attendance'),
  ('biometric',        'attendance'),
  ('leave',            'attendance'),
  ('holidays',         'shifts'),
  ('payroll',          'attendance'),
  ('payroll',          'leave'),
  ('payroll',          'break-management')
) AS dep(module_key, depends_on_key)
JOIN module m ON m.key = dep.module_key
JOIN module d ON d.key = dep.depends_on_key
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- Domain outbox drainer (design §5.5, TX-2, D22).
--
-- claimed_until: a drainer claims a batch for a short lease, publishes it
-- outside any transaction, then marks it processed. A crashed drainer's
-- claim simply lapses, so delivery is at least once and never lost.
-- ---------------------------------------------------------------------
ALTER TABLE domain_outbox ADD COLUMN claimed_until timestamptz;

-- NOTIFY is delivered when the inserting transaction commits, so a drainer
-- waiting on LISTEN wakes as soon as an event is safe to publish.
CREATE OR REPLACE FUNCTION notify_domain_outbox() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  PERFORM pg_notify('domain_outbox', NEW.organization_id::text);
  RETURN NULL;
END
$$;

CREATE TRIGGER domain_outbox_notify
  AFTER INSERT ON domain_outbox
  FOR EACH ROW EXECUTE FUNCTION notify_domain_outbox();

-- ---------------------------------------------------------------------
-- Job runs (design §5.4, JB-1 to JB-4). One row per job, organization and
-- idempotency key; a retry of the same key updates the same row.
-- ---------------------------------------------------------------------
ALTER TABLE job_run
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN dead_lettered_at timestamptz;
```

- [ ] **Migrate and run the test again:**

```bash
npm run migrate
psql "$MIGRATION_DATABASE_URL" -c "ALTER ROLE tapcrm_app LOGIN PASSWORD 'app_test_password';"
npx vitest run packages/server/src/platform/modules/dependencies.integration.test.ts
```

Expected: `Tests  3 passed (3)`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 8 — Generations: failed work comes back a day later, at most three times (§5.4)

A key that used up its retries is spent. A sweeper that still finds the work
undone may offer it again as `…:g2`, then `…:g3`, a day after each failure;
after the third, a person has to look. This is a pure function, so it is
tested on its own.

A key that is still queued, running or waiting to retry is offered again as
itself. The queue already holds it and ignores the second add, so this is
harmless — and if Redis ever lost the job, it brings it back.

- [ ] **Write the test** — `packages/server/src/platform/jobs/generation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decideGeneration, generationKey, generationKeys, type GenerationRow } from './generation.js';

const BASE = 'auto-close:rec-1:v3';
const NOW = new Date('2026-09-25T10:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const deadLetter = (key: string, hours: number): GenerationRow => ({
  key,
  outcome: 'failure',
  deadLetteredAt: hoursAgo(hours),
});

describe('JB-4 — dead-lettered work comes back by generation (design §5.4)', () => {
  it('names generations base, :g2, :g3', () => {
    expect(generationKey(BASE, 1)).toBe(BASE);
    expect(generationKeys(BASE)).toEqual([BASE, `${BASE}:g2`, `${BASE}:g3`]);
  });

  it('runs generation one when nothing has run', () => {
    expect(decideGeneration(BASE, [], NOW)).toEqual({ kind: 'run', key: BASE, generation: 1 });
  });

  it('offers the same key again while it is queued, running or retrying', () => {
    const started = [{ key: BASE, outcome: null, deadLetteredAt: null }];
    const retrying = [{ key: BASE, outcome: 'failure', deadLetteredAt: null }];
    expect(decideGeneration(BASE, started, NOW)).toEqual({ kind: 'run', key: BASE, generation: 1 });
    expect(decideGeneration(BASE, retrying, NOW)).toEqual({ kind: 'run', key: BASE, generation: 1 });
  });

  it('does nothing once the key has finished', () => {
    const rows = [{ key: BASE, outcome: 'success', deadLetteredAt: null }];
    expect(decideGeneration(BASE, rows, NOW)).toEqual({ kind: 'done' });
  });

  it('waits a day after a dead letter before the next generation', () => {
    expect(decideGeneration(BASE, [deadLetter(BASE, 23)], NOW)).toEqual({ kind: 'wait' });
  });

  it('offers generation two a day after generation one dead-lettered', () => {
    expect(decideGeneration(BASE, [deadLetter(BASE, 25)], NOW)).toEqual({
      kind: 'run',
      key: `${BASE}:g2`,
      generation: 2,
    });
  });

  it('judges by the latest generation, not the first', () => {
    const rows = [deadLetter(BASE, 72), deadLetter(`${BASE}:g2`, 2)];
    expect(decideGeneration(BASE, rows, NOW)).toEqual({ kind: 'wait' });
  });

  it('stops after the third generation and hands the work to a person', () => {
    const rows = [deadLetter(BASE, 72), deadLetter(`${BASE}:g2`, 48), deadLetter(`${BASE}:g3`, 25)];
    expect(decideGeneration(BASE, rows, NOW)).toEqual({ kind: 'exhausted' });
  });

  it('ignores rows for other keys', () => {
    const rows = [deadLetter('auto-close:rec-1:v4', 99)];
    expect(decideGeneration(BASE, rows, NOW)).toEqual({ kind: 'run', key: BASE, generation: 1 });
  });
});
```

- [ ] **Run it and watch it fail:** `npx vitest run packages/server/src/platform/jobs/generation.test.ts`
  — expected: `Error: Failed to load url ./generation.js … Does the file exist?`.

- [ ] **Create** `packages/server/src/platform/jobs/generation.ts`:

```ts
/**
 * Generations — attendance design §5.4.
 *
 * A key that has used up its retries dead-letters, and the queue will not take
 * that key again. A sweeper that later finds the same work still undone may
 * offer it under the key's next generation (`…:g2`, `…:g3`), no sooner than a
 * day after the last failure and at most three generations in all; after that
 * the work is flagged for a person. Work whose inputs changed has a new key and
 * starts again at generation one. This is how "never retry every hour" (L5) and
 * "never forget an open day" (L6, D21) hold at the same time.
 */

export const MAX_GENERATIONS = 3;
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

/** What `job_run` says about one key: its outcome, and when it dead-lettered. */
export interface GenerationRow {
  readonly key: string;
  readonly outcome: string | null;
  readonly deadLetteredAt: Date | null;
}

export type GenerationDecision =
  /**
   * Enqueue the work under this key. When the key is already queued, running
   * or waiting to retry, the queue holds it already and ignores the second
   * add, so offering it again is harmless — and it brings back a job that
   * Redis lost.
   */
  | { readonly kind: 'run'; readonly key: string; readonly generation: number }
  /** The key finished. There is nothing to do. */
  | { readonly kind: 'done' }
  /** The latest generation dead-lettered less than a day ago. */
  | { readonly kind: 'wait' }
  /** Three generations dead-lettered: a person must look at it. */
  | { readonly kind: 'exhausted' };

export function generationKey(base: string, generation: number): string {
  return generation === 1 ? base : `${base}:g${generation}`;
}

export function generationKeys(base: string): string[] {
  return Array.from({ length: MAX_GENERATIONS }, (_, i) => generationKey(base, i + 1));
}

export function decideGeneration(
  base: string,
  rows: readonly GenerationRow[],
  now: Date,
): GenerationDecision {
  let latest = 0;
  let latestRow: GenerationRow | undefined;
  for (let generation = 1; generation <= MAX_GENERATIONS; generation += 1) {
    const row = rows.find((r) => r.key === generationKey(base, generation));
    if (row !== undefined) {
      latest = generation;
      latestRow = row;
    }
  }
  if (latestRow === undefined) return { kind: 'run', key: base, generation: 1 };
  if (latestRow.outcome !== null && latestRow.outcome !== 'failure') return { kind: 'done' };
  if (latestRow.deadLetteredAt === null) return { kind: 'run', key: latestRow.key, generation: latest };
  if (latest >= MAX_GENERATIONS) return { kind: 'exhausted' };
  if (now.getTime() - latestRow.deadLetteredAt.getTime() < RETRY_AFTER_MS) return { kind: 'wait' };
  return { kind: 'run', key: generationKey(base, latest + 1), generation: latest + 1 };
}
```

- [ ] **Run the test again.** Expected: `Tests  9 passed (9)`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 9 — The job runner (§5.4, JB-1 to JB-4)

`platform/jobs.ts` runs one queue whose worker switches on the job name. It
becomes `defineJob`:

- A scheduled job gets one BullMQ scheduler, named after the job.
  `upsertJobScheduler` is idempotent, so every process can declare it and it
  still exists once per deployment (TapCRM L25).
- A tick of a per-organization schedule becomes one job per organization, keyed
  by the tick's time; the module option limits it to organizations with that
  module enabled.
- Every run of a per-organization job writes `job_run` under its key (JB-1,
  JB-2). A key that finished or dead-lettered is never run again.
- Starts are counted in `job_run`, not only failures. A job that keeps killing
  its worker therefore still stops, instead of stalling for ever. For the same
  reason BullMQ's stall limit is raised from 1 to 10.
- The last failed attempt dead-letters the key and logs an alert line,
  `"alert":"job-dead-lettered"` (JB-4).
- `enqueue` is never called inside a transaction (TX-2). Business code writes
  an outbox row instead, and the row's handler enqueues after commit (task 11).

The four existing jobs move onto it with their logic unchanged. The geofence
purge and the override-expiry audit now run once per organization, so they
get `job_run` rows, which they never had. The two audit jobs already walk the
organizations and write their own rows, so they stay platform jobs.

- [ ] **Write the test** — `packages/server/src/platform/jobs/runner.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { createJobContext, systemPrincipal } from '../dal/context.js';
import { db, platformDb } from '../dal/db.js';
import { closePools } from '../dal/pool.js';
import { sql } from '../dal/sql.js';
import { defineJob, startJobs, stopJobs, type JobHandle } from './runner.js';

/**
 * The job runner against real Redis and PostgreSQL (design §5.4).
 *
 *   TAPCRM_INTEGRATION_DB=1 REDIS_URL=… MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const RUN = randomUUID().slice(0, 8);
const ORG = randomUUID();
const QUEUE = `tapcrm.jobs.test-${RUN}`;
const asOwner = (reason: string, fragment: ReturnType<typeof sql>) => platformDb.query('migration', reason, fragment);

interface JobRunRow {
  idempotencyKey: string;
  outcome: string | null;
  attempts: number;
  itemsProcessed: number;
  deadLetteredAt: Date | null;
}

const runsOf = (jobName: string) =>
  asOwner('read test job runs', sql`
    SELECT idempotency_key, outcome, attempts, items_processed, dead_lettered_at
    FROM job_run WHERE organization_id = ${ORG} AND job_name = ${jobName} ORDER BY started_at`) as Promise<JobRunRow[]>;

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

let calls = { counted: 0, failing: 0, scheduled: 0 };
let counted: JobHandle<{ n: number }>;
let failing: JobHandle<undefined>;
const names = {
  counted: `test.counted-${RUN}`,
  failing: `test.failing-${RUN}`,
  scheduled: `test.scheduled-${RUN}`,
};

describe.skipIf(!enabled)('job runner (Redis and PostgreSQL)', () => {
  beforeAll(async () => {
    await asOwner('create test organization', sql`
      INSERT INTO organization (id, code, name, timezone)
      VALUES (${ORG}, ${`JR${RUN}`}, 'Job Runner Test', 'Asia/Kolkata')`);
    counted = defineJob<{ n: number }>({
      name: names.counted,
      perOrganization: true,
      handler: async ({ payload }) => {
        calls.counted += 1;
        return { itemsProcessed: payload.n };
      },
    });
    failing = defineJob({
      name: names.failing,
      perOrganization: true,
      attempts: 2,
      backoffMs: 50,
      handler: async () => {
        calls.failing += 1;
        throw new Error('always fails');
      },
    });
    defineJob({
      name: names.scheduled,
      perOrganization: true,
      schedule: { every: 1_000 },
      handler: async () => {
        calls.scheduled += 1;
      },
    });
    await startJobs({ queueName: QUEUE });
  });

  afterAll(async () => {
    await stopJobs();
    const redis = new Redis(loadConfig().REDIS_URL, { maxRetriesPerRequest: null });
    const queue = new Queue(QUEUE, { connection: redis });
    await queue.obliterate({ force: true });
    await queue.close();
    await redis.quit();
    await asOwner('remove test job runs', sql`DELETE FROM job_run WHERE job_name LIKE ${`test.%-${RUN}`}`);
    await asOwner('remove test organization', sql`DELETE FROM organization WHERE id = ${ORG}`);
    await closePools();
  });

  it('JB-1/JB-2: a key runs once and leaves one job_run row', async () => {
    calls = { ...calls, counted: 0 };
    await counted.enqueue({ organizationId: ORG, key: 'day:2026-09-25', payload: { n: 7 } });
    await counted.enqueue({ organizationId: ORG, key: 'day:2026-09-25', payload: { n: 7 } });
    const rows = await until(() => runsOf(names.counted), (r) => r[0]?.outcome === 'success');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ idempotencyKey: 'day:2026-09-25', outcome: 'success', attempts: 1, itemsProcessed: 7 });

    // Delivered again after it finished: skipped, not run.
    await counted.enqueue({ organizationId: ORG, key: 'day:2026-09-25', payload: { n: 7 } });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(calls.counted).toBe(1);
  });

  it('JB-4: a failing key retries, then dead-letters, and never runs again', async () => {
    await failing.enqueue({ organizationId: ORG, key: 'k1', payload: undefined });
    const rows = await until(() => runsOf(names.failing), (r) => r[0]?.deadLetteredAt != null);
    expect(rows[0]).toMatchObject({ outcome: 'failure', attempts: 2 });
    expect(rows[0]!.deadLetteredAt).toBeInstanceOf(Date);
    expect(calls.failing).toBe(2);

    await failing.enqueue({ organizationId: ORG, key: 'k1', payload: undefined });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(calls.failing).toBe(2);
  });

  it('§5.4: the next generation waits a day after a dead letter', async () => {
    const ctx = createJobContext({ organizationId: ORG, principal: systemPrincipal(ORG), jobName: 'test', runId: RUN });
    const now = new Date();
    const today = await db.transaction(ctx, (tx) => failing.nextGeneration(tx, 'k1', now));
    const tomorrow = await db.transaction(ctx, (tx) =>
      failing.nextGeneration(tx, 'k1', new Date(now.getTime() + 25 * 3_600_000)),
    );
    expect(today).toEqual({ kind: 'wait' });
    expect(tomorrow).toEqual({ kind: 'run', key: 'k1:g2', generation: 2 });
  });

  it('done when: a scheduled job leaves a job_run row for the organization', async () => {
    const rows = await until(() => runsOf(names.scheduled), (r) => r.some((row) => row.outcome === 'success'));
    const row = rows.find((candidate) => candidate.outcome === 'success');
    expect(row).toBeDefined();
    expect(Number.isNaN(Date.parse(row!.idempotencyKey))).toBe(false);
  });
});
```

- [ ] **Run it and watch it fail:**
  `npx vitest run packages/server/src/platform/jobs/runner.integration.test.ts`
  — expected: `Error: Failed to load url ./runner.js … Does the file exist?`.

- [ ] **Add the system principal** that jobs and the outbox drainer run as —
  `packages/server/src/platform/dal/context.ts`:

```diff
--- a/packages/server/src/platform/dal/context.ts
+++ b/packages/server/src/platform/dal/context.ts
@@ -67,6 +67,24 @@ export function createRequestContext(input: {
   };
 }
 
+/**
+ * The principal background work runs as — the job runner and the outbox
+ * drainer (attendance design §5.4, §5.5). A service identity that holds no
+ * action, so it can never pass `authorize()`: jobs act as the system, and a
+ * job that needs a person's authority takes it from its input, not from here.
+ */
+export function systemPrincipal(organizationId: string): Principal {
+  return {
+    id: '00000000-0000-0000-0000-000000000000',
+    organizationId,
+    sessionVersion: 0,
+    accountType: 'service',
+    allowedActions: [],
+    allowedResources: [],
+    expiresAt: new Date(0),
+  };
+}
+
 /**
  * TN-9 / JB-3 — "Background jobs construct a context PER ORGANIZATION. A job
  * iterating organizations does so explicitly; it never runs with an absent
```

- [ ] **Name the two new cross-organization reads** —
  `packages/server/src/platform/dal/db.ts`:

```diff
--- a/packages/server/src/platform/dal/db.ts
+++ b/packages/server/src/platform/dal/db.ts
@@ -325,7 +325,9 @@ export type PlatformOperation =
   | 'audit-retention'
   | 'audit-archiving'
   | 'organization-provisioning'
-  | 'health-check';
+  | 'health-check'
+  | 'job-scheduling'
+  | 'outbox-drain';
 
 export const platformDb = {
   async one<T>(
```

- [ ] **Create** `packages/server/src/platform/jobs/run-record.ts`:

```ts
import type { Tx } from '../dal/db.js';
import { sql } from '../dal/sql.js';
import type { GenerationRow } from './generation.js';

/**
 * `job_run` — JB-1 and JB-2 (attendance design §5.4).
 *
 * One row per organization, job and key. A retry of the same key updates the
 * same row, so `attempts` counts every start — including a start that never
 * finished because the process died — and the runner can stop a job that
 * keeps killing its worker.
 */

export interface RunOutcome {
  readonly itemsProcessed?: number;
  readonly errorCount?: number;
  readonly details?: Record<string, unknown>;
}

export type BeginResult =
  | { readonly kind: 'run'; readonly attempt: number }
  | { readonly kind: 'skip'; readonly reason: 'finished' | 'dead-lettered' };

/** JB-1 — a key that finished or dead-lettered is never run again. */
export async function beginRun(
  tx: Tx,
  organizationId: string,
  jobName: string,
  key: string,
): Promise<BeginResult> {
  const started = await tx.maybeOne<{ attempts: number }>(sql`
    INSERT INTO job_run (organization_id, job_name, idempotency_key, started_at, attempts)
    VALUES (${organizationId}, ${jobName}, ${key}, now(), 1)
    ON CONFLICT (organization_id, job_name, idempotency_key) WHERE idempotency_key IS NOT NULL
    DO UPDATE SET attempts = job_run.attempts + 1, started_at = now(), finished_at = NULL, outcome = NULL
      WHERE job_run.dead_lettered_at IS NULL
        AND (job_run.outcome IS NULL OR job_run.outcome = 'failure')
    RETURNING attempts
  `);
  if (started !== null) return { kind: 'run', attempt: started.attempts };
  const existing = await tx.one<{ deadLetteredAt: Date | null }>(sql`
    SELECT dead_lettered_at FROM job_run
    WHERE organization_id = ${organizationId} AND job_name = ${jobName} AND idempotency_key = ${key}
  `);
  return { kind: 'skip', reason: existing.deadLetteredAt === null ? 'finished' : 'dead-lettered' };
}

export async function finishRun(
  tx: Tx,
  organizationId: string,
  jobName: string,
  key: string,
  outcome: RunOutcome,
): Promise<void> {
  const errorCount = outcome.errorCount ?? 0;
  await tx.query(sql`
    UPDATE job_run
    SET finished_at = now(),
        outcome = ${errorCount > 0 ? 'partial' : 'success'},
        items_processed = ${outcome.itemsProcessed ?? 0},
        error_count = ${errorCount},
        details = ${outcome.details === undefined ? null : JSON.stringify(outcome.details)}::jsonb
    WHERE organization_id = ${organizationId} AND job_name = ${jobName} AND idempotency_key = ${key}
  `);
}

/** JB-4 — `deadLetter` marks the key spent: no retry, no second run. */
export async function failRun(
  tx: Tx,
  organizationId: string,
  jobName: string,
  key: string,
  message: string,
  deadLetter: boolean,
): Promise<void> {
  await tx.query(sql`
    UPDATE job_run
    SET finished_at = now(),
        outcome = 'failure',
        error_count = error_count + 1,
        details = jsonb_build_object('error', ${message}::text),
        dead_lettered_at = CASE WHEN ${deadLetter} THEN now() END
    WHERE organization_id = ${organizationId} AND job_name = ${jobName} AND idempotency_key = ${key}
  `);
}

export async function generationRows(
  tx: Tx,
  jobName: string,
  keys: readonly string[],
): Promise<GenerationRow[]> {
  return tx.query<GenerationRow>(sql`
    SELECT idempotency_key AS key, outcome, dead_lettered_at
    FROM job_run
    WHERE job_name = ${jobName} AND idempotency_key = ANY(${[...keys]}::text[])
  `);
}
```

- [ ] **Create** `packages/server/src/platform/jobs/runner.ts`:

```ts
import { Queue, UnrecoverableError, Worker, type Job, type RepeatOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { loadConfig } from '../../config.js';
import { createJobContext, systemPrincipal, type RequestContext } from '../dal/context.js';
import { db, platformDb, type Tx } from '../dal/db.js';
import { sql } from '../dal/sql.js';
import { systemClock, type Clock } from '../time.js';
import { decideGeneration, generationKeys, type GenerationDecision } from './generation.js';
import { beginRun, failRun, finishRun, generationRows, type RunOutcome } from './run-record.js';

/**
 * The job runner — attendance design §5.4, TECH §11.
 *
 *   JB-1  Every job is keyed. A key that finished or dead-lettered never runs
 *         again, however often it is delivered.
 *   JB-2  Every run of a per-organization job writes `job_run`.
 *   JB-3  A per-organization job runs once per organization, each with its own
 *         context. Nothing runs with an absent tenant.
 *   JB-4  A failing job retries with backoff, then dead-letters with an alert.
 *
 * `defineJob` registers a handler. A scheduled job gets one BullMQ scheduler,
 * named after the job: `upsertJobScheduler` is idempotent, so every process
 * can declare it and the schedule still exists once per deployment (TapCRM L25).
 * Each tick of a per-organization schedule becomes one job per organization,
 * keyed by the tick's time.
 */

export const JOB_QUEUE = 'tapcrm.jobs';

/** The most attempts any job may have. Also BullMQ's stall limit, see below. */
const MAX_ATTEMPTS = 10;
const DEFAULT_ATTEMPTS = 5;
const DEFAULT_BACKOFF_MS = 30_000;
const DAY_SECONDS = 24 * 60 * 60;

export type JobSchedule =
  | { readonly every: number }
  | { readonly pattern: string; readonly tz?: string };

export interface OrganizationJobRun<P> {
  readonly ctx: RequestContext;
  readonly key: string;
  readonly payload: P;
  /** 1 for the first start of this key, counted in `job_run`. */
  readonly attempt: number;
  readonly clock: Clock;
}

export interface PlatformJobRun<P> {
  readonly key: string;
  readonly payload: P;
  readonly attempt: number;
  readonly clock: Clock;
}

interface CommonDefinition {
  /** `module.verb`, e.g. `attendance.auto-close`. Also the scheduler's id. */
  readonly name: string;
  readonly schedule?: JobSchedule;
  /** At most 10. Default 5. */
  readonly attempts?: number;
  /** First retry delay; each later one doubles. Default 30 seconds. */
  readonly backoffMs?: number;
}

export interface OrganizationJobDefinition<P> extends CommonDefinition {
  readonly perOrganization: true;
  /** Scheduled ticks reach only organizations with this module enabled. */
  readonly module?: string;
  handler(run: OrganizationJobRun<P>): Promise<RunOutcome | void>;
}

/**
 * Platform jobs run once, outside any organization. `job_run` needs an
 * organization, so the runner records nothing for them: a platform job writes
 * its own per-organization rows, as the audit jobs do.
 */
export interface PlatformJobDefinition<P> extends CommonDefinition {
  readonly perOrganization: false;
  handler(run: PlatformJobRun<P>): Promise<void>;
}

export type JobDefinition<P> = OrganizationJobDefinition<P> | PlatformJobDefinition<P>;

export interface JobHandle<P> {
  readonly name: string;
  /**
   * Queue the work under `key`. Idempotent: a key the queue already holds is
   * ignored, and a key that finished or dead-lettered is skipped when it runs.
   * Never call it inside a transaction (TX-2) — write an outbox row instead,
   * and let its handler enqueue after commit.
   */
  enqueue(input: { organizationId?: string; key: string; payload: P }): Promise<void>;
  /** §5.4 — which key, if any, a sweeper should offer for `baseKey` now. */
  nextGeneration(tx: Tx, baseKey: string, now: Date): Promise<GenerationDecision>;
}

interface JobData {
  readonly organizationId?: string;
  readonly key?: string;
  readonly payload?: unknown;
  /** Set on scheduler ticks. */
  readonly tick?: true;
}

const definitions = new Map<string, JobDefinition<unknown>>();
let connection: Redis | null = null;
let queue: Queue<JobData> | null = null;
let worker: Worker<JobData> | null = null;
let clock: Clock = systemClock;

export function defineJob<P = undefined>(definition: JobDefinition<P>): JobHandle<P> {
  if (definitions.has(definition.name)) throw new Error(`Job "${definition.name}" is defined twice`);
  const attempts = definition.attempts ?? DEFAULT_ATTEMPTS;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_ATTEMPTS) {
    throw new Error(`Job "${definition.name}": attempts must be 1 to ${MAX_ATTEMPTS}`);
  }
  definitions.set(definition.name, definition);
  return {
    name: definition.name,
    async enqueue(input) {
      if (definition.perOrganization && input.organizationId === undefined) {
        throw new Error(`Job "${definition.name}" runs per organization; give an organizationId`);
      }
      await enqueue(definition, {
        ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
        key: input.key,
        payload: input.payload,
      });
    },
    async nextGeneration(tx, baseKey, now) {
      const rows = await generationRows(tx, definition.name, generationKeys(baseKey));
      return decideGeneration(baseKey, rows, now);
    },
  };
}

/** BullMQ refuses ':' in a custom id, and keys contain it. */
export function jobIdFor(name: string, organizationId: string | undefined, key: string): string {
  return [name, organizationId ?? 'platform', key].map(encodeURIComponent).join('|');
}

function jobOptions(definition: JobDefinition<unknown>) {
  return {
    attempts: definition.attempts ?? DEFAULT_ATTEMPTS,
    backoff: { type: 'exponential', delay: definition.backoffMs ?? DEFAULT_BACKOFF_MS },
    removeOnComplete: { age: DAY_SECONDS, count: 1_000 },
    removeOnFail: { age: 7 * DAY_SECONDS },
  };
}

async function enqueue(definition: JobDefinition<unknown>, data: JobData): Promise<void> {
  if (queue === null) throw new Error('Jobs are not started');
  await queue.add(definition.name, data, {
    ...jobOptions(definition),
    jobId: jobIdFor(definition.name, data.organizationId, data.key ?? ''),
  });
}

function repeatOptions(schedule: JobSchedule): Omit<RepeatOptions, 'key'> {
  return 'every' in schedule
    ? { every: schedule.every }
    : { pattern: schedule.pattern, ...(schedule.tz === undefined ? {} : { tz: schedule.tz }) };
}

/** The instant a scheduler tick was due, which keys that tick's runs. */
function slotOf(job: Job<JobData>): string {
  return new Date(job.opts.prevMillis ?? job.timestamp).toISOString();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** JB-4 — the alert: an error line the log monitor pages on. */
function alertDeadLetter(name: string, organizationId: string | null, key: string, attempts: number, error: string): void {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'job dead-lettered',
      alert: 'job-dead-lettered',
      job: name,
      organizationId,
      key,
      attempts,
      error,
    }),
  );
}

async function organizationsFor(definition: OrganizationJobDefinition<unknown>): Promise<string[]> {
  const module = definition.module ?? null;
  const rows = await platformDb.query<{ id: string }>(
    'job-scheduling',
    `list organizations for ${definition.name}`,
    sql`
      SELECT o.id FROM organization o
      WHERE o.status <> 'deleted'
        AND (${module}::text IS NULL OR EXISTS (
          SELECT 1 FROM organization_module om JOIN module m ON m.id = om.module_id
          WHERE om.organization_id = o.id AND m.key = ${module} AND om.status = 'enabled'))
      ORDER BY o.id
    `,
  );
  return rows.map((row) => row.id);
}

async function runForOrganization(
  definition: OrganizationJobDefinition<unknown>,
  organizationId: string,
  key: string,
  payload: unknown,
): Promise<void> {
  const ctx = createJobContext({
    organizationId,
    principal: systemPrincipal(organizationId),
    jobName: definition.name,
    runId: key,
  });
  const attempts = definition.attempts ?? DEFAULT_ATTEMPTS;
  const begun = await db.transaction(ctx, (tx) => beginRun(tx, organizationId, definition.name, key));
  if (begun.kind === 'skip') return;

  // A worker that dies mid-job is "stalled": BullMQ runs the job again without
  // counting a failure. Starts are counted here instead, so a job that keeps
  // killing its worker still stops.
  if (begun.attempt > attempts) {
    const message = 'the job stopped without finishing on every attempt';
    await db.transaction(ctx, (tx) => failRun(tx, organizationId, definition.name, key, message, true));
    alertDeadLetter(definition.name, organizationId, key, begun.attempt - 1, message);
    return;
  }

  try {
    const outcome = (await definition.handler({ ctx, key, payload, attempt: begun.attempt, clock })) ?? {};
    await db.transaction(ctx, (tx) => finishRun(tx, organizationId, definition.name, key, outcome));
  } catch (error) {
    const last = begun.attempt >= attempts;
    await db.transaction(ctx, (tx) =>
      failRun(tx, organizationId, definition.name, key, messageOf(error), last),
    );
    if (!last) throw error;
    alertDeadLetter(definition.name, organizationId, key, begun.attempt, messageOf(error));
    throw new UnrecoverableError(messageOf(error));
  }
}

async function runPlatform(definition: PlatformJobDefinition<unknown>, job: Job<JobData>, key: string): Promise<void> {
  const attempts = definition.attempts ?? DEFAULT_ATTEMPTS;
  const attempt = job.attemptsMade + 1;
  try {
    await definition.handler({ key, payload: job.data.payload, attempt, clock });
  } catch (error) {
    if (attempt < attempts) throw error;
    alertDeadLetter(definition.name, null, key, attempt, messageOf(error));
    throw new UnrecoverableError(messageOf(error));
  }
}

async function processJob(job: Job<JobData>): Promise<void> {
  const definition = definitions.get(job.name);
  if (definition === undefined) throw new UnrecoverableError(`No job is defined as "${job.name}"`);

  if (job.data.tick === true) {
    const slot = slotOf(job);
    if (!definition.perOrganization) return runPlatform(definition, job, slot);
    for (const organizationId of await organizationsFor(definition)) {
      await enqueue(definition, { organizationId, key: slot });
    }
    return;
  }

  const key = job.data.key ?? '';
  if (!definition.perOrganization) return runPlatform(definition, job, key);
  if (job.data.organizationId === undefined) {
    throw new UnrecoverableError(`Job "${job.name}" arrived without an organization`);
  }
  return runForOrganization(definition, job.data.organizationId, key, job.data.payload);
}

/** Removes the schedulers of the old single-switch worker (`platform/jobs.ts`). */
async function retireLegacyQueue(redis: Redis): Promise<void> {
  const legacy = new Queue('tapcrm.identity.retention', { connection: redis });
  try {
    for (const id of [
      'geofence-coordinate-retention',
      'access-override-expiry-audit',
      'audit-chain-verification',
      'audit-retention',
    ]) {
      await legacy.removeJobScheduler(id);
    }
  } finally {
    await legacy.close();
  }
}

export interface StartJobsOptions {
  readonly queueName?: string;
  readonly redisUrl?: string;
  readonly clock?: Clock;
  readonly concurrency?: number;
}

export async function startJobs(options: StartJobsOptions = {}): Promise<void> {
  if (queue !== null) return;
  const queueName = options.queueName ?? JOB_QUEUE;
  clock = options.clock ?? systemClock;
  const redis = new Redis(options.redisUrl ?? loadConfig().REDIS_URL, { maxRetriesPerRequest: null });
  connection = redis;
  queue = new Queue<JobData>(queueName, { connection: redis });
  worker = new Worker<JobData>(queueName, processJob, {
    connection: redis,
    concurrency: options.concurrency ?? 4,
    // Let the start count above decide when a stalling job stops. With
    // BullMQ's default of 1, a job that stalled twice would fail without
    // reaching the runner, and its `job_run` row would say "started" for ever.
    maxStalledCount: MAX_ATTEMPTS,
  });
  worker.on('failed', (job, error) => {
    console.error(
      JSON.stringify({ level: 'error', msg: 'job attempt failed', job: job?.name, jobId: job?.id, error: messageOf(error) }),
    );
  });

  const scheduled = [...definitions.values()].filter((definition) => definition.schedule !== undefined);
  for (const definition of scheduled) {
    await queue.upsertJobScheduler(definition.name, repeatOptions(definition.schedule!), {
      name: definition.name,
      data: { tick: true },
      opts: jobOptions(definition),
    });
  }
  // A job that was renamed or removed must not keep its schedule.
  const wanted = new Set(scheduled.map((definition) => definition.name));
  for (const existing of await queue.getJobSchedulers()) {
    if (!wanted.has(existing.key)) await queue.removeJobScheduler(existing.key);
  }
  if (queueName === JOB_QUEUE) await retireLegacyQueue(redis);
}

export async function stopJobs(): Promise<void> {
  await worker?.close();
  await queue?.close();
  await connection?.quit();
  worker = null;
  queue = null;
  connection = null;
}

/** Tests only. */
export function __resetJobDefinitions(): void {
  definitions.clear();
}
```

- [ ] **Run the test again.** Expected: `Tests  4 passed (4)`.

- [ ] **Move the four jobs.** Create `packages/server/src/modules/identity/jobs.ts`:

```ts
import { db } from '../../platform/dal/db.js';
import { defineJob } from '../../platform/jobs/runner.js';
import { purgeExpiredCoordinates } from './geofence/privacy.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Moved from platform/jobs.ts unchanged, now one run per organization (JB-2, JB-3). */
export function registerIdentityJobs(): void {
  defineJob({
    name: 'identity.purge-geofence-coordinates',
    perOrganization: true,
    schedule: { every: DAY_MS },
    handler: async ({ ctx }) => {
      await db.transaction(ctx, purgeExpiredCoordinates);
    },
  });
}
```

`packages/server/src/modules/access-management/jobs.ts` (its body is
`auditExpiredAccessOverrides` from `platform/jobs.ts`, run for one organization):

```ts
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { defineJob } from '../../platform/jobs/runner.js';
import { markExpiredOverrides } from './repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Maintenance only. `authz-adapter` excludes expired rows at read time; this
 * job merely records an idempotent expiry event for review/audit purposes.
 * Moved from platform/jobs.ts unchanged, now one run per organization.
 */
export function registerAccessManagementJobs(): void {
  defineJob({
    name: 'access.audit-expired-overrides',
    perOrganization: true,
    schedule: { every: DAY_MS },
    handler: async ({ ctx }) => {
      const expired = await db.transaction(ctx, async (tx) => {
        const rows = await markExpiredOverrides(tx);
        for (const override of rows) {
          await tx.query(sql`
            INSERT INTO audit_outbox (organization_id, stream, payload)
            VALUES (${ctx.organizationId}, 'activity', ${JSON.stringify({
              action: 'access.override_expired',
              actorId: null,
              actorType: 'service',
              targetType: 'user',
              targetId: override.userId,
              before: {
                overrideId: override.id,
                action: override.action,
                allowed: override.allowed,
                scope: override.scope,
                expiresAt: override.expiresAt.toISOString(),
              },
              after: null,
              reason: override.reason,
            })}::jsonb)
          `);
        }
        return rows;
      });
      return { itemsProcessed: expired.length };
    },
  });
}
```

`packages/server/src/modules/audit/jobs.ts`:

```ts
import { defineJob } from '../../platform/jobs/runner.js';
import { runAuditRetention } from './archive.js';
import { runDailyAuditIntegrityVerification } from './integrity.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Moved from platform/jobs.ts unchanged. Both walk every organization
 * themselves and write their own `job_run` rows, so they stay platform jobs.
 */
export function registerAuditJobs(): void {
  defineJob({
    name: 'audit.chain-verification',
    perOrganization: false,
    schedule: { every: DAY_MS },
    handler: () => runDailyAuditIntegrityVerification(),
  });
  defineJob({
    name: 'audit.retention',
    perOrganization: false,
    schedule: { every: DAY_MS },
    attempts: 3,
    backoffMs: 60_000,
    handler: () => runAuditRetention(),
  });
}
```

and register them in `packages/server/src/modules/index.ts`:

```diff
--- a/packages/server/src/modules/index.ts
+++ b/packages/server/src/modules/index.ts
@@ -8,6 +8,9 @@ import { registerIdentityRoutes } from './identity/routes.js';
 import { registerAccessManagementRoutes } from './access-management/routes.js';
 import { registerAuditPolicies } from './audit/policy.js';
 import { registerAuditRoutes } from './audit/routes.js';
+import { registerIdentityJobs } from './identity/jobs.js';
+import { registerAccessManagementJobs } from './access-management/jobs.js';
+import { registerAuditJobs } from './audit/jobs.js';
 
 /**
  * The module registry.
@@ -35,3 +38,14 @@ export function registerAllRoutes(): void {
   registerGeofenceRoutes();
   registerAuditRoutes();
 }
+
+let jobsRegistered = false;
+
+/** Background jobs (attendance design §5.4). Called once, before `startJobs`. */
+export function registerAllJobs(): void {
+  if (jobsRegistered) return;
+  jobsRegistered = true;
+  registerIdentityJobs();
+  registerAccessManagementJobs();
+  registerAuditJobs();
+}
```

- [ ] **Check:** `npm run typecheck && npm run lint && npm run ci`. (The server
  still starts the old `platform/jobs.ts`; task 12 switches it over.)

Checkpoint: leave the changes in the working tree for review.

---

## Task 10 — Room rules for sockets (RT-2, §5.5)

Each viewer only receives changes for the people their scope covers. Room names
say who an event is about; a socket joins the rooms its scope reaches. The
rules match `userPolicy` in `modules/employee/policy.ts`: all-people,
department, team (the viewer's team and the teams below it), pool, own.

- [ ] **Write the test** — `packages/server/src/platform/realtime/rooms.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { subjectRooms, viewerRooms, type PeopleChannel, type ViewerReach } from './rooms.js';

const ORG = 'org-1';
const status: PeopleChannel = { name: 'status', action: 'attendance:view-live' };
const viewer = (reach: Partial<ViewerReach>): ViewerReach => ({
  organizationId: ORG,
  userId: 'lead',
  everyone: false,
  scope: null,
  departmentId: 'ops',
  teamIds: ['night', 'night-a'],
  poolIds: ['night'],
  ...reach,
});
const alice = { userId: 'alice', teamId: 'night-a', departmentId: 'ops' };
const bob = { userId: 'bob', teamId: 'day', departmentId: 'sales' };

/** Does a viewer hear about a subject? The same test Socket.IO applies. */
const hears = (reach: ViewerReach, subject: typeof alice) =>
  viewerRooms(status, reach).some((room) => subjectRooms(ORG, status, subject).includes(room));

describe('RT-2 — a viewer hears only about the people their scope covers', () => {
  it('team scope reaches the viewer’s teams and the teams below, not others', () => {
    const lead = viewer({ scope: 'team' });
    expect(hears(lead, alice)).toBe(true);
    expect(hears(lead, bob)).toBe(false);
  });

  it('department scope reaches the viewer’s department only', () => {
    const head = viewer({ scope: 'department' });
    expect(hears(head, alice)).toBe(true);
    expect(hears(head, bob)).toBe(false);
  });

  it('own scope reaches the viewer alone', () => {
    const self = viewer({ scope: 'own', userId: 'alice' });
    expect(hears(self, alice)).toBe(true);
    expect(hears(self, bob)).toBe(false);
  });

  it('all-people and Super Admin reach everyone in the organization', () => {
    expect(hears(viewer({ scope: 'all-people' }), bob)).toBe(true);
    expect(hears(viewer({ everyone: true }), bob)).toBe(true);
  });

  it('no policy, or participant scope, joins no channel room', () => {
    expect(viewerRooms(status, viewer({ scope: null }))).toEqual([]);
    expect(viewerRooms(status, viewer({ scope: 'participant' }))).toEqual([]);
  });

  it('every room names the organization, so nothing crosses tenants', () => {
    for (const room of [...viewerRooms(status, viewer({ scope: 'team' })), ...subjectRooms(ORG, status, alice)]) {
      expect(room.startsWith(`o:${ORG}:`)).toBe(true);
    }
  });
});
```

- [ ] **Run it and watch it fail:** `npx vitest run packages/server/src/platform/realtime/rooms.test.ts`
  — expected: `Error: Failed to load url ./rooms.js … Does the file exist?`.

- [ ] **Create** `packages/server/src/platform/realtime/rooms.ts`:

```ts
import type { Action, Scope } from '@tapcrm/contracts';

/**
 * Socket rooms — RT-2, attendance design §5.5.
 *
 * Every room name starts with the organization, so no emit can cross tenants.
 * A socket joins its person's room, plus — for each people channel — the rooms
 * its scope for the channel's action covers. The people scope rules are the
 * ones `userPolicy` applies to people records (modules/employee/policy.ts):
 *
 *   all-people   the whole organization
 *   department   the viewer's department
 *   team, pool   those teams (team: the viewer's team and every team below it)
 *   own          the viewer alone
 *
 * An event about a person goes to that person's room, their team's, their
 * department's and the organization's; Socket.IO sends it once to each socket
 * in any of them. A viewer therefore receives exactly the people their scope
 * covers, and a principal never joins a room it cannot read.
 */

export interface PeopleChannel {
  /** Short and stable: `status` gives rooms like `o:<org>:status:t:<team>`. */
  readonly name: string;
  /** The action whose scope decides who hears about whom. */
  readonly action: Action;
}

export interface Subject {
  readonly userId: string;
  readonly teamId: string | null;
  readonly departmentId: string | null;
}

export const personalRoom = (organizationId: string, userId: string): string =>
  `o:${organizationId}:u:${userId}`;

const channelRoom = (organizationId: string, channel: string, part: string): string =>
  `o:${organizationId}:${channel}:${part}`;

/** What a viewer's scope reaches, already resolved. */
export interface ViewerReach {
  readonly organizationId: string;
  readonly userId: string;
  /** Super Admin (globalAccess) — the whole organization. */
  readonly everyone: boolean;
  /** Null when no policy grants the channel's action. */
  readonly scope: Scope | null;
  readonly departmentId: string | null;
  readonly teamIds: readonly string[];
  readonly poolIds: readonly string[];
}

export function viewerRooms(channel: PeopleChannel, viewer: ViewerReach): string[] {
  const room = (part: string) => channelRoom(viewer.organizationId, channel.name, part);
  if (viewer.everyone) return [room('all')];
  switch (viewer.scope) {
    case 'all-people':
      return [room('all')];
    case 'department':
      return viewer.departmentId === null ? [] : [room(`d:${viewer.departmentId}`)];
    case 'team':
      return viewer.teamIds.map((id) => room(`t:${id}`));
    case 'pool':
      return viewer.poolIds.map((id) => room(`t:${id}`));
    case 'own':
      return [room(`u:${viewer.userId}`)];
    default:
      // No policy, or `participant`, which names parties to a record and has
      // no meaning for a person: no rooms.
      return [];
  }
}

export function subjectRooms(organizationId: string, channel: PeopleChannel, subject: Subject): string[] {
  const room = (part: string) => channelRoom(organizationId, channel.name, part);
  return [
    room('all'),
    room(`u:${subject.userId}`),
    ...(subject.teamId === null ? [] : [room(`t:${subject.teamId}`)]),
    ...(subject.departmentId === null ? [] : [room(`d:${subject.departmentId}`)]),
  ];
}
```

- [ ] **Run the test again.** Expected: `Tests  6 passed (6)`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 11 — The outbox drainer and the socket server (§5.5, D22, RT-1, RT-3, RT-4)

The positions module already writes `permissions:changed` to `domain_outbox`,
and nothing reads it. After this task, the drainer delivers it within a second:

1. The insert's trigger sends a NOTIFY when the transaction commits.
2. The drainer claims the row under a 30-second lease.
3. The realtime handler tells the holders' sockets, then closes them.
4. Reconnecting runs the handshake again, which works out the rooms afresh
   (RT-3).

Delivery is at least once. The row's id travels with the event as `eventId`,
and every handler must cope with seeing an event twice.

Sockets authenticate with the same token check as HTTP (RT-1), through a
resolver Identity installs. A socket is closed when its token expires, so a
revoked session cannot keep listening. The socket path is
`/api/socket.io`, under the prefix the web app already proxies.

- [ ] **Add the test client:**

```bash
npm install --save-dev socket.io-client@^4.8.1 --workspace @tapcrm/server
```

- [ ] **Write the test** — `packages/server/src/platform/realtime/realtime.integration.test.ts`:

```ts
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { platformDb } from '../dal/db.js';
import { closePools } from '../dal/pool.js';
import { sql } from '../dal/sql.js';
import { AUTHORIZATION_EVENTS } from '../events.js';
import { startOutboxDrainer, stopOutboxDrainer } from '../outbox/drainer.js';
import { installSocketPrincipalResolver, startRealtime, stopRealtime } from './server.js';

/**
 * Design §5.5, done when: an outbox row reaches a connected socket in under a
 * second. Real PostgreSQL (the NOTIFY trigger and the drainer) and real Redis
 * (the Socket.IO adapter).
 *
 *   TAPCRM_INTEGRATION_DB=1 REDIS_URL=… MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const ORG = randomUUID();
const USER = randomUUID();
const GOOD_TOKEN = `token-${USER}`;
const asOwner = (reason: string, fragment: ReturnType<typeof sql>) => platformDb.query('migration', reason, fragment);

let http: HttpServer;
let url = '';
const sockets: Socket[] = [];

function open(token: string): Socket {
  const socket = connect(url, {
    path: `${loadConfig().API_BASE_PATH}/socket.io`,
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
  });
  sockets.push(socket);
  return socket;
}

describe.skipIf(!enabled)('realtime and the domain outbox (PostgreSQL and Redis)', () => {
  beforeAll(async () => {
    await asOwner('create test organization', sql`
      INSERT INTO organization (id, code, name, timezone)
      VALUES (${ORG}, ${`RT${ORG.slice(0, 6)}`}, 'Realtime Test', 'Asia/Kolkata')`);
    // Stands in for Identity's token check, which has its own tests.
    installSocketPrincipalResolver(async (token) =>
      token === GOOD_TOKEN
        ? {
            organizationId: ORG,
            expiresAt: new Date(Date.now() + 60_000),
            principal: { id: USER, organizationId: ORG, sessionVersion: 1, accountType: 'super-admin' },
          }
        : null,
    );
    http = createServer();
    await new Promise<void>((resolve) => http.listen(0, resolve));
    url = `http://localhost:${(http.address() as AddressInfo).port}`;
    await startRealtime(http);
    await startOutboxDrainer();
  });

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    await stopOutboxDrainer();
    await stopRealtime();
    await new Promise((resolve) => http.close(resolve));
    await asOwner('remove outbox rows', sql`DELETE FROM domain_outbox WHERE organization_id = ${ORG}`);
    await asOwner('remove test organization', sql`DELETE FROM organization WHERE id = ${ORG}`);
    await closePools();
  });

  it('RT-1: a socket without a valid token is refused', async () => {
    const error = await new Promise<Error>((resolve) => open('forged').on('connect_error', resolve));
    expect(error.message).toBe('UNAUTHENTICATED');
  });

  it('done when: an outbox row reaches the connected socket in under a second, then RT-3 closes it', async () => {
    const socket = open(GOOD_TOKEN);
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', reject);
    });

    const received = new Promise<{ at: number; payload: { eventId: string; positionId: string | null } }>((resolve) =>
      socket.on(AUTHORIZATION_EVENTS.PERMISSIONS_CHANGED, (payload) => resolve({ at: Date.now(), payload })),
    );
    const closed = new Promise<string>((resolve) => socket.on('disconnect', resolve));

    const sentAt = Date.now();
    const [row] = (await asOwner('write an outbox row', sql`
      INSERT INTO domain_outbox (organization_id, event_name, payload)
      VALUES (${ORG}, ${AUTHORIZATION_EVENTS.PERMISSIONS_CHANGED},
              ${JSON.stringify({ positionId: null, holderIds: [USER], reason: 'test' })}::jsonb)
      RETURNING id`)) as { id: string }[];

    const { at, payload } = await received;
    expect(at - sentAt).toBeLessThan(1_000);
    expect(payload.eventId).toBe(row!.id);
    expect(await closed).toBe('io server disconnect');

    // Marked processed once every handler has run (D22: at least once).
    let processedAt: Date | null = null;
    for (let i = 0; i < 40 && processedAt === null; i += 1) {
      const [state] = (await asOwner('read the outbox row', sql`
        SELECT processed_at FROM domain_outbox WHERE id = ${row!.id}`)) as { processedAt: Date | null }[];
      processedAt = state?.processedAt ?? null;
      if (processedAt === null) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(processedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Run it and watch it fail:**
  `npx vitest run packages/server/src/platform/realtime/realtime.integration.test.ts`
  — expected: `Error: Failed to load url ../outbox/drainer.js … Does the file exist?`.

- [ ] **Add `listen()`** — LISTEN needs a connection of its own, and `pool.ts` is
  the only file allowed to open one (CI-15). In
  `packages/server/src/platform/dal/pool.ts`:

```diff
--- a/packages/server/src/platform/dal/pool.ts
+++ b/packages/server/src/platform/dal/pool.ts
@@ -93,6 +93,71 @@ export function getMigrationPool(): PgPool {
   return migrationPool;
 }
 
+/* ==================================================================== *
+ * LISTEN — attendance design §5.5
+ * ==================================================================== */
+
+export interface Listener {
+  close(): Promise<void>;
+}
+
+const CHANNEL = /^[a-z_][a-z0-9_]{0,62}$/;
+
+/**
+ * Calls `onNotify` with each payload sent to `channel` by `pg_notify`.
+ *
+ * LISTEN needs a connection of its own for as long as it listens, so it cannot
+ * borrow a pooled client; and this is the one file allowed to open a
+ * connection (CI-15). A dropped connection is reopened after a second. Nothing
+ * depends on it for correctness: the outbox drainer also polls every second,
+ * so a notification missed while reconnecting only costs that second.
+ */
+export async function listen(channel: string, onNotify: (payload: string) => void): Promise<Listener> {
+  if (!CHANNEL.test(channel)) throw new Error(`"${channel}" is not a valid LISTEN channel`);
+  let client: pg.Client | null = null;
+  let closed = false;
+  let retry: NodeJS.Timeout | null = null;
+
+  const connect = async (): Promise<void> => {
+    const next = new pg.Client({ connectionString: loadConfig().DATABASE_URL, application_name: 'tapcrm-listen' });
+    const reconnect = (): void => {
+      if (closed || client !== next) return;
+      client = null;
+      next.removeAllListeners();
+      void next.end().catch(() => undefined);
+      retry = setTimeout(() => void connect().catch(() => undefined), 1_000);
+      retry.unref();
+    };
+    client = next;
+    next.on('notification', (message) => {
+      if (message.channel === channel) onNotify(message.payload ?? '');
+    });
+    next.on('error', (error) => {
+      console.error(JSON.stringify({ level: 'error', msg: 'LISTEN connection failed', channel, err: error.message }));
+      reconnect();
+    });
+    next.on('end', reconnect);
+    try {
+      await next.connect();
+      await next.query(`LISTEN ${channel}`);
+    } catch (error) {
+      reconnect();
+      throw error;
+    }
+  };
+
+  await connect();
+  return {
+    async close() {
+      closed = true;
+      if (retry) clearTimeout(retry);
+      const current = client;
+      client = null;
+      await current?.end().catch(() => undefined);
+    },
+  };
+}
+
 export async function closePools(): Promise<void> {
   await Promise.all([appPool?.end(), migrationPool?.end()]);
   appPool = null;
```

- [ ] **Create** `packages/server/src/platform/outbox/registry.ts`:

```ts
/**
 * Outbox handlers — attendance design §5.5, MB-3, D22.
 *
 * A business transaction writes a `domain_outbox` row; after it commits, the
 * drainer hands the row to every handler registered for its name. Delivery is
 * AT LEAST ONCE: a handler can succeed and the "processed" write still fail,
 * so the same event can arrive again, carrying the same `id`. Every handler
 * must therefore be idempotent — an upsert, an insert behind a unique key, a
 * job enqueued under a key, or a socket event the client may see twice. Say
 * how, in a comment above each handler.
 */

export interface OutboxEvent {
  /** Stable across deliveries — the row's id. */
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly payload: unknown;
  readonly enqueuedAt: Date;
}

export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

const handlers = new Map<string, OutboxHandler[]>();

export function onOutboxEvent(name: string, handler: OutboxHandler): void {
  handlers.set(name, [...(handlers.get(name) ?? []), handler]);
}

export function handlersFor(name: string): readonly OutboxHandler[] {
  return handlers.get(name) ?? [];
}

/**
 * The drainer claims only these. A row nobody in this process handles stays
 * pending for a process that does — during a rolling deploy the new name may
 * be known to only half the fleet.
 */
export function handledEventNames(): string[] {
  return [...handlers.keys()].sort();
}

/** Tests only. */
export function __resetOutboxHandlers(): void {
  handlers.clear();
}
```

- [ ] **Create** `packages/server/src/platform/outbox/drainer.ts`:

```ts
import { createJobContext, systemPrincipal } from '../dal/context.js';
import { db, platformDb } from '../dal/db.js';
import { listen, type Listener } from '../dal/pool.js';
import { sql } from '../dal/sql.js';
import { handledEventNames, handlersFor, type OutboxEvent } from './registry.js';

/**
 * The domain outbox drainer — attendance design §5.5, TX-2, D22.
 *
 * 1. Claim a batch in a short transaction: each row gets a lease
 *    (`claimed_until`) and one more attempt. `SKIP LOCKED` keeps two drainers
 *    off the same rows.
 * 2. Publish outside any transaction (TX-2): each handler enqueues a job or
 *    emits a socket event.
 * 3. Mark the published rows processed. A failed row waits a backoff and is
 *    claimed again; after ten attempts it stops and raises an alert.
 *
 * A drainer that dies between 2 and 3 leaves its lease to lapse, and the rows
 * are published again: at least once, never lost.
 *
 * It wakes on the `domain_outbox` NOTIFY that an insert sends when its
 * transaction commits, and polls every second in case a notification was
 * missed — so a punch reaches the board well inside NF-2's three seconds.
 */

const POLL_MS = 1_000;
const ORGANIZATION_REFRESH_MS = 60_000;
const LEASE_SECONDS = 30;
const BATCH_SIZE = 100;
export const MAX_OUTBOX_ATTEMPTS = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ClaimedRow {
  id: string;
  eventName: string;
  payload: unknown;
  enqueuedAt: Date;
  attempts: number;
}

function contextFor(organizationId: string) {
  return createJobContext({
    organizationId,
    principal: systemPrincipal(organizationId),
    jobName: 'outbox-drain',
    runId: 'loop',
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Publishes one claimed row to every handler. Returns the error, if any. */
async function publish(organizationId: string, row: ClaimedRow): Promise<string | null> {
  const event: OutboxEvent = {
    id: row.id,
    organizationId,
    name: row.eventName,
    payload: row.payload,
    enqueuedAt: row.enqueuedAt,
  };
  for (const handler of handlersFor(row.eventName)) {
    try {
      await handler(event);
    } catch (error) {
      return messageOf(error);
    }
  }
  return null;
}

/** Drains everything this process can handle for one organization. */
export async function drainOrganization(organizationId: string): Promise<number> {
  const names = handledEventNames();
  if (names.length === 0) return 0;
  const ctx = contextFor(organizationId);
  let published = 0;

  for (;;) {
    const claimed = await db.transaction(ctx, (tx) =>
      tx.query<ClaimedRow>(sql`
        WITH picked AS (
          SELECT id FROM domain_outbox
          WHERE organization_id = ${organizationId}
            AND processed_at IS NULL
            AND event_name = ANY(${names}::text[])
            AND attempts < ${MAX_OUTBOX_ATTEMPTS}
            AND (claimed_until IS NULL OR claimed_until < now())
          ORDER BY enqueued_at, id
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE domain_outbox o
        SET claimed_until = now() + make_interval(secs => ${LEASE_SECONDS}),
            attempts = o.attempts + 1
        FROM picked
        WHERE o.organization_id = ${organizationId} AND o.id = picked.id
        RETURNING o.id, o.event_name, o.payload, o.enqueued_at, o.attempts
      `),
    );
    if (claimed.length === 0) return published;
    claimed.sort((a, b) => a.enqueuedAt.getTime() - b.enqueuedAt.getTime() || a.id.localeCompare(b.id));

    const done: string[] = [];
    const failed: { id: string; attempts: number; error: string }[] = [];
    for (const row of claimed) {
      const error = await publish(organizationId, row);
      if (error === null) done.push(row.id);
      else failed.push({ id: row.id, attempts: row.attempts, error });
    }

    await db.transaction(ctx, async (tx) => {
      if (done.length > 0) {
        await tx.query(sql`
          UPDATE domain_outbox SET processed_at = now(), claimed_until = NULL, last_error = NULL
          WHERE organization_id = ${organizationId} AND id = ANY(${done}::uuid[])
        `);
      }
      for (const row of failed) {
        // 2, 4, 8 … seconds, at most five minutes, before the next claim.
        const backoff = Math.min(2 ** row.attempts, 300);
        await tx.query(sql`
          UPDATE domain_outbox
          SET claimed_until = now() + make_interval(secs => ${backoff}), last_error = ${row.error}
          WHERE organization_id = ${organizationId} AND id = ${row.id}
        `);
      }
    });

    for (const row of failed) {
      const final = row.attempts >= MAX_OUTBOX_ATTEMPTS;
      console.error(
        JSON.stringify({
          level: 'error',
          msg: final ? 'outbox event gave up' : 'outbox event failed; will retry',
          ...(final ? { alert: 'outbox-event-dead-lettered' } : {}),
          organizationId,
          eventId: row.id,
          attempts: row.attempts,
          error: row.error,
        }),
      );
    }
    published += done.length;
    if (claimed.length < BATCH_SIZE) return published;
  }
}

/* ==================================================================== *
 * Loop
 * ==================================================================== */

let listener: Listener | null = null;
let timer: NodeJS.Timeout | null = null;
let running: Promise<void> | null = null;
let rerun = false;
let stopping = true;
let organizationIds: string[] = [];
let organizationsFetchedAt = 0;
const woken = new Set<string>();

async function listOrganizationIds(): Promise<string[]> {
  const rows = await platformDb.query<{ id: string }>(
    'outbox-drain',
    'list organizations whose domain outbox may need draining',
    sql`SELECT id FROM organization ORDER BY id`,
  );
  return rows.map((row) => row.id);
}

async function tick(everyOrganization: boolean): Promise<void> {
  if (everyOrganization && Date.now() - organizationsFetchedAt >= ORGANIZATION_REFRESH_MS) {
    organizationIds = await listOrganizationIds();
    organizationsFetchedAt = Date.now();
  }
  const targets = new Set(woken);
  woken.clear();
  if (everyOrganization) for (const id of organizationIds) targets.add(id);
  for (const organizationId of targets) {
    if (stopping) return;
    try {
      await drainOrganization(organizationId);
    } catch (error) {
      // One organization's failure must not stall the others; its rows stay
      // pending and are claimed again next tick.
      console.error(
        JSON.stringify({ level: 'error', msg: 'outbox drain failed', organizationId, error: messageOf(error) }),
      );
    }
  }
}

function run(everyOrganization: boolean): void {
  if (stopping) return;
  if (running !== null) {
    rerun = true;
    return;
  }
  running = tick(everyOrganization)
    .catch((error: unknown) => {
      organizationsFetchedAt = 0;
      console.error(JSON.stringify({ level: 'error', msg: 'outbox drainer tick failed', error: messageOf(error) }));
    })
    .finally(() => {
      running = null;
      if (rerun) {
        rerun = false;
        run(false);
      }
    });
}

export async function startOutboxDrainer(): Promise<void> {
  if (!stopping) return;
  stopping = false;
  timer = setInterval(() => run(true), POLL_MS);
  try {
    listener = await listen('domain_outbox', (organizationId) => {
      if (!UUID.test(organizationId)) return;
      woken.add(organizationId);
      run(false);
    });
  } catch (error) {
    // Polling alone still delivers, one second slower.
    console.error(JSON.stringify({ level: 'error', msg: 'outbox LISTEN unavailable; polling only', error: messageOf(error) }));
  }
  run(true);
}

export async function stopOutboxDrainer(): Promise<void> {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = null;
  await listener?.close();
  listener = null;
  await running;
  woken.clear();
  organizationIds = [];
  organizationsFetchedAt = 0;
}
```

- [ ] **Create** `packages/server/src/platform/realtime/server.ts`:

```ts
import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { effectivePolicy } from '@tapcrm/authz';
import { globalAccess, type Principal } from '@tapcrm/contracts';
import { Redis } from 'ioredis';
import { Server } from 'socket.io';
import { loadConfig } from '../../config.js';
import { scopeResolver } from '../authz-adapter.js';
import { createRequestContext } from '../dal/context.js';
import { AUTHORIZATION_EVENTS } from '../events.js';
import { onOutboxEvent } from '../outbox/registry.js';
import {
  personalRoom,
  subjectRooms,
  viewerRooms,
  type PeopleChannel,
  type Subject,
} from './rooms.js';

/**
 * Realtime — TECH §10, attendance design §5.5.
 *
 *   RT-1  The handshake checks the same token and session version as HTTP,
 *         through the resolver Identity installs. The socket is closed when
 *         the token expires; the client reconnects with a fresh one.
 *   RT-2  Rooms come from the permission set, joined at connect (rooms.ts).
 *   RT-3  On `permissions:changed` the holders' sockets are told, then closed.
 *         Reconnecting runs the handshake again, which works the rooms out
 *         afresh, so a narrowed permission leaves no room behind.
 *   RT-4  Payloads carry ids and a change type, never record bodies.
 *
 * The Redis adapter carries every emit to every API instance.
 */

export interface SocketIdentity {
  readonly principal: Principal;
  readonly organizationId: string;
  /** When the token stops being valid. */
  readonly expiresAt: Date;
}

export type SocketPrincipalResolver = (token: string) => Promise<SocketIdentity | null>;

export class RealtimeUnavailableError extends Error {
  constructor() {
    super('Realtime is not running in this process');
    this.name = 'RealtimeUnavailableError';
  }
}

/** What the handshake leaves on each socket. */
interface SocketData {
  identity: SocketIdentity;
  rooms: string[];
}
type RealtimeServer = Server<Record<string, never>, Record<string, (payload: Record<string, unknown>) => void>, Record<string, never>, SocketData>;

let resolveSocket: SocketPrincipalResolver = async () => null;
const channels = new Map<string, PeopleChannel>();
let io: RealtimeServer | null = null;
let publisher: Redis | null = null;
let subscriber: Redis | null = null;
let permissionsHandlerRegistered = false;

/** Identity installs its token check at boot, as it does for HTTP. */
export function installSocketPrincipalResolver(resolver: SocketPrincipalResolver): void {
  resolveSocket = resolver;
}

/** A module declares a people channel once, at boot (e.g. live-status: `status`). */
export function definePeopleChannel(channel: PeopleChannel): void {
  if (channels.has(channel.name)) throw new Error(`Channel "${channel.name}" is defined twice`);
  channels.set(channel.name, channel);
}

async function roomsFor(identity: SocketIdentity): Promise<string[]> {
  const { principal, organizationId } = identity;
  const rooms = [personalRoom(organizationId, principal.id)];
  if (channels.size === 0) return rooms;
  const ctx = createRequestContext({ organizationId, principal, requestId: `socket:${principal.id}` });
  const everyone = globalAccess(principal);
  const employee = principal.accountType === 'employee';
  for (const channel of channels.values()) {
    const policy = everyone ? null : await effectivePolicy(ctx, channel.action);
    const scope = policy?.allowed === true ? policy.scope : null;
    rooms.push(
      ...viewerRooms(channel, {
        organizationId,
        userId: principal.id,
        everyone,
        scope,
        departmentId: employee ? principal.departmentId : null,
        teamIds: scope === 'team' ? [...(await scopeResolver.teamIds(ctx))] : [],
        poolIds: scope === 'pool' ? [...(await scopeResolver.poolIds(ctx))] : [],
      }),
    );
  }
  return rooms;
}

function running(): RealtimeServer {
  if (io === null) throw new RealtimeUnavailableError();
  return io;
}

/** RT-4 — ids and a change type only. */
export function emitToUser(organizationId: string, userId: string, event: string, payload: Record<string, unknown>): void {
  running().to(personalRoom(organizationId, userId)).emit(event, payload);
}

/** Everyone whose scope on the channel covers `subject` hears it, once. */
export function emitAboutPerson(
  organizationId: string,
  channelName: string,
  subject: Subject,
  event: string,
  payload: Record<string, unknown>,
): void {
  const channel = channels.get(channelName);
  if (channel === undefined) throw new Error(`Channel "${channelName}" is not defined`);
  running().to(subjectRooms(organizationId, channel, subject)).emit(event, payload);
}

interface PermissionsChangedPayload {
  readonly positionId?: string;
  readonly holderIds?: readonly string[];
}

/**
 * RT-3. At least once (D22): a second delivery repeats a notice the client
 * already acted on and closes sockets that have already reconnected with the
 * new rooms — harmless.
 */
function handlePermissionsChanged(): void {
  if (permissionsHandlerRegistered) return;
  permissionsHandlerRegistered = true;
  onOutboxEvent(AUTHORIZATION_EVENTS.PERMISSIONS_CHANGED, async (event) => {
    const server = running();
    const payload = (event.payload ?? {}) as PermissionsChangedPayload;
    for (const userId of payload.holderIds ?? []) {
      const room = personalRoom(event.organizationId, userId);
      server.to(room).emit(AUTHORIZATION_EVENTS.PERMISSIONS_CHANGED, {
        eventId: event.id,
        positionId: payload.positionId ?? null,
      });
      server.in(room).disconnectSockets(true);
    }
  });
}

export async function startRealtime(httpServer: HttpServer, options: { redisUrl?: string } = {}): Promise<void> {
  if (io !== null) return;
  const config = loadConfig();
  const url = options.redisUrl ?? config.REDIS_URL;
  publisher = new Redis(url, { maxRetriesPerRequest: null });
  subscriber = publisher.duplicate();

  const server: RealtimeServer = new Server(httpServer, {
    path: `${config.API_BASE_PATH}/socket.io`,
    serveClient: false,
    adapter: createAdapter(publisher, subscriber),
  });

  server.use((socket, next) => {
    const token: unknown = socket.handshake.auth['token'];
    if (typeof token !== 'string' || token.length === 0) {
      next(new Error('UNAUTHENTICATED'));
      return;
    }
    resolveSocket(token)
      .then(async (identity) => {
        if (identity === null || identity.expiresAt.getTime() <= Date.now()) {
          next(new Error('UNAUTHENTICATED'));
          return;
        }
        socket.data.identity = identity;
        socket.data.rooms = await roomsFor(identity);
        next();
      })
      .catch(() => next(new Error('UNAUTHENTICATED')));
  });

  server.on('connection', (socket) => {
    const { identity, rooms } = socket.data;
    void socket.join(rooms);
    const expiry = setTimeout(() => socket.disconnect(true), identity.expiresAt.getTime() - Date.now());
    expiry.unref();
    socket.on('disconnect', () => clearTimeout(expiry));
  });

  io = server;
  handlePermissionsChanged();
}

/** Closes this instance's sockets. Leaves the HTTP server to its owner. */
export async function stopRealtime(): Promise<void> {
  const server = io;
  io = null;
  if (server !== null) {
    server.local.disconnectSockets(true);
    server.engine.close();
  }
  await Promise.allSettled([publisher?.quit(), subscriber?.quit()]);
  publisher = null;
  subscriber = null;
}

/** Tests only. */
export function __resetRealtime(): void {
  channels.clear();
  resolveSocket = async () => null;
}
```

- [ ] **Run the test again.** Expected: `Tests  2 passed (2)`. The first test
  refuses a forged token. The second receives the event in under a second and
  is then closed by the server with `io server disconnect`.

- [ ] **Give sockets Identity's token check.** The token check moves into
  `resolvePrincipalFromToken`, which HTTP and sockets share. The access token's
  expiry is returned with it:

```diff
--- a/packages/server/src/modules/identity/authentication/crypto.ts
+++ b/packages/server/src/modules/identity/authentication/crypto.ts
@@ -34,7 +34,8 @@ export async function verifyIdentityAccessToken(token: string) {
   try {
     const { payload } = await jwtVerify(token, accessSecret(), { algorithms: ['HS256'] });
     if (payload['typ'] !== 'identity-access' || typeof payload.sub !== 'string' || typeof payload['organizationId'] !== 'string' || typeof payload['sessionId'] !== 'string' || typeof payload['sessionVersion'] !== 'number' || typeof payload['accountType'] !== 'string') throw new Error('invalid claims');
-    return { userId: payload.sub, organizationId: payload['organizationId'], sessionId: payload['sessionId'], sessionVersion: payload['sessionVersion'], accountType: payload['accountType'] };
+    if (typeof payload.exp !== 'number') throw new Error('invalid claims');
+    return { userId: payload.sub, organizationId: payload['organizationId'], sessionId: payload['sessionId'], sessionVersion: payload['sessionVersion'], accountType: payload['accountType'], expiresAt: new Date(payload.exp * 1000) };
   } catch {
     throw new IdentityAuthenticationError('IDENTITY_ACCESS_TOKEN_INVALID');
   }
```

```diff
--- a/packages/server/src/modules/identity/authentication/authenticate.ts
+++ b/packages/server/src/modules/identity/authentication/authenticate.ts
@@ -8,7 +8,16 @@ import { createIdentityContext, toPrincipal, type IdentityUser } from './princip
 export async function resolvePrincipal(req: Request) {
   const header = req.header('authorization');
   if (!header?.startsWith('Bearer ')) return null;
-  const claims = await verifyIdentityAccessToken(header.slice(7).trim());
+  const { principal, organizationId } = await resolvePrincipalFromToken(header.slice(7).trim());
+  return { principal, organizationId };
+}
+
+/**
+ * The one token check, for HTTP and for the socket handshake alike (RT-1):
+ * signature, session, session version, account and organization state.
+ */
+export async function resolvePrincipalFromToken(token: string) {
+  const claims = await verifyIdentityAccessToken(token);
   const rows = await bootstrapDb.readAs<IdentityUser>(claims.organizationId, sql`
     SELECT u.id, u.organization_id, u.account_type, u.email, u.password_hash, u.status,
            o.status AS organization_status, u.session_version, u.must_change_password, u.locked_until, u.full_name,
@@ -31,5 +40,5 @@ export async function resolvePrincipal(req: Request) {
       WHERE organization_id = ${user.organizationId} AND id = ${claims.sessionId} AND revoked_at IS NULL
     `).then(() => undefined),
   );
-  return { principal: toPrincipal(user), organizationId: user.organizationId };
+  return { principal: toPrincipal(user), organizationId: user.organizationId, expiresAt: claims.expiresAt };
 }
```

```diff
--- a/packages/server/src/modules/identity/service.ts
+++ b/packages/server/src/modules/identity/service.ts
@@ -1,5 +1,5 @@
 export { login } from './authentication/login.js';
-export { resolvePrincipal } from './authentication/authenticate.js';
+export { resolvePrincipal, resolvePrincipalFromToken } from './authentication/authenticate.js';
 export { logout } from './authentication/logout.js';
 export { refreshIdentitySession as refresh } from './sessions/service.js';
 export {
```

```diff
--- a/packages/server/src/modules/identity/routes.ts
+++ b/packages/server/src/modules/identity/routes.ts
@@ -1,7 +1,8 @@
 import type { Router } from 'express';
 import { acceptAdminInvitation } from './invitations.js';
 import { installPrincipalResolver } from '../../platform/http/context.js';
-import { resolvePrincipal } from './service.js';
+import { installSocketPrincipalResolver } from '../../platform/realtime/server.js';
+import { resolvePrincipal, resolvePrincipalFromToken } from './service.js';
 import {
   loginController,
   refreshController,
@@ -35,6 +36,7 @@ export function registerIdentityRoutes(): void {
 
 export function registerIdentityPublicRoutes(router: Router): void {
   installPrincipalResolver(resolvePrincipal);
+  installSocketPrincipalResolver(async (token) => resolvePrincipalFromToken(token).catch(() => null));
   router.post('/identity/login', loginController);
   router.post('/identity/refresh', refreshController);
   router.post('/identity/logout', logoutController);
```

- [ ] **Check:** `npm run typecheck && npm run lint && npm run ci`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 12 — Start it all from the server, and remove the old runner

- [ ] **Change** `packages/server/src/index.ts`. Sockets start first, so the
  outbox handlers that emit are in place before the drainer starts claiming
  their events. On shutdown, open sockets close first, because they would keep
  `server.close()` waiting.

```diff
--- a/packages/server/src/index.ts
+++ b/packages/server/src/index.ts
@@ -30,8 +30,11 @@ import { buildApp } from './app.js';
 import { loadConfig } from './config.js';
 import { closePools } from './platform/dal/pool.js';
 import { purgeAllExpiredGeofenceCoordinates } from './modules/identity/geofence/privacy.js';
-import { startBackgroundJobs, stopBackgroundJobs } from './platform/jobs.js';
+import { registerAllJobs } from './modules/index.js';
 import { startAuditDrainer, stopAuditDrainer } from './modules/audit/drainer.js';
+import { startJobs, stopJobs } from './platform/jobs/runner.js';
+import { startOutboxDrainer, stopOutboxDrainer } from './platform/outbox/drainer.js';
+import { startRealtime, stopRealtime } from './platform/realtime/server.js';
 
 /**
  * Entry point.
@@ -61,8 +64,19 @@ const server = app.listen(config.API_PORT, () => {
 // PostgreSQL only, so unlike the job queue below it does not depend on Redis.
 startAuditDrainer();
 
+// Design §5.5 — sockets first, so the outbox handlers that emit are in place
+// before the drainer starts claiming their events.
+void startRealtime(server)
+  .catch((error: unknown) => {
+    console.error(JSON.stringify({ level: 'error', msg: 'realtime unavailable', error: String(error) }));
+  })
+  .finally(() => {
+    void startOutboxDrainer();
+  });
+
 let geofenceRetentionTimer: NodeJS.Timeout | null = null;
-void startBackgroundJobs().catch((error: unknown) => {
+registerAllJobs();
+void startJobs().catch((error: unknown) => {
   // Keep local development safe if Redis is temporarily unavailable. The
   // durable scheduler is used whenever the existing Redis service is healthy.
   console.error(JSON.stringify({ level: 'error', msg: 'background jobs unavailable; using local retention fallback', error: String(error) }));
@@ -95,12 +109,17 @@ function shutdown(code: number): void {
   }, 15_000);
   forced.unref();
 
-  server.close(() => {
-    // Let an in-flight audit batch commit before the pool is drained.
-    void stopAuditDrainer().then(closePools).finally(() => {
-      void stopBackgroundJobs();
-      clearTimeout(forced);
-      process.exit(code);
+  // Open sockets would keep server.close() waiting, so they go first.
+  void stopRealtime().finally(() => {
+    server.close(() => {
+      // Let in-flight audit and outbox batches commit before the pool is drained.
+      void Promise.allSettled([stopAuditDrainer(), stopOutboxDrainer()])
+        .then(() => stopJobs())
+        .then(closePools)
+        .finally(() => {
+          clearTimeout(forced);
+          process.exit(code);
+        });
     });
   });
 }
```

- [ ] **Delete** `packages/server/src/platform/jobs.ts`. Its four jobs now live in
  the modules' `jobs.ts` files. Its unused `SEND_ADMIN_INVITATION` name goes with
  it. On first start, `startJobs` removes the old queue's four schedulers from
  Redis.

- [ ] **Check:** `npm run typecheck && npm run lint && npm run ci`.

- [ ] **Smoke test (optional).** Start the API (`npm run dev:api`) with Redis
  running, then:

```bash
redis-cli ZRANGE bull:tapcrm.jobs:repeat 0 -1
```

Expected: `access.audit-expired-overrides`, `audit.chain-verification`,
`audit.retention`, `identity.purge-geofence-coordinates`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 13 — CI runs every database test

CI already runs one database test, the audit drainer's. Widen that step to
every `*.integration.test.ts`. Leave out `overrides.integration.test.ts` until
its owner fixes it (see "Before you start").

- [ ] In `.github/workflows/ci.yml`, replace the last step, `Audit drainer
  integration tests`, with:

```yaml
      # Every database test runs against REAL PostgreSQL through the runtime
      # role, and against Redis, so RLS, the append-only grants, the outbox
      # NOTIFY and the job queue are exercised. They use their own database
      # because each test refuses a name lacking "test", and the app-role
      # password is set again because migration 0008 resets it cluster-wide.
      # overrides.integration.test.ts fails today for a reason unrelated to
      # this step (it registers no ResourcePolicy); include it once fixed.
      - name: Database integration tests
        env:
          TAPCRM_INTEGRATION_DB: '1'
          MIGRATION_DATABASE_URL: postgres://tapcrm_migrator:postgres@localhost:5432/tapcrm_test
          DATABASE_URL: postgres://tapcrm_app:app_test_password@localhost:5432/tapcrm_test
        run: |
          psql "postgres://tapcrm_migrator:postgres@localhost:5432/tapcrm" -c "CREATE DATABASE tapcrm_test;"
          npm run migrate
          psql "$MIGRATION_DATABASE_URL" -c "ALTER ROLE tapcrm_app LOGIN PASSWORD 'app_test_password';"
          npx vitest run integration.test --exclude '**/overrides.integration.test.ts'
```

- [ ] **Run the same command locally** (integration variables set):

```bash
npx vitest run integration.test --exclude '**/overrides.integration.test.ts'
```

Expected: `Test Files  6 passed (6)`, `Tests  26 passed (26)` — the audit
drainer, employee id, job runner, realtime, WFH date and module dependency
tests.

Checkpoint: leave the changes in the working tree for review.

---

## Task 14 — Final check

```bash
npm run registry:extract -- --check
npm run typecheck
npm run lint
npm run ci
npx vitest run --exclude '**/overrides.integration.test.ts'
```

Expected: no registry drift; typecheck and lint clean; `npm run ci` ends with
`✓ 15 check(s) passed` and the same four phased gaps as before; every test
passes. The three "done when" tests are named at the top of this plan.

Then review the working tree (`git status`, `git diff`). Nothing has been
committed.

---

## Choices made here that the design does not spell out

| Choice | Why |
|---|---|
| Ten boundary fixes, not six | `access-management` also reached into `identity` and `organization` four times; §2 counted only `employee`'s six |
| The geofence purge and the override-expiry audit run per organization | Same SQL, same effect; they gain `job_run` rows (JB-2), which they never had |
| An in-flight key is offered again as itself | The queue ignores a key it holds; if Redis lost the job, it comes back instead of waiting for ever |
| Starts counted in `job_run`; BullMQ stall limit 10 | A job that crashes its worker stops after its attempts, and its row never says "started" for ever |
| The drainer claims only event names its process handles | During a rolling deploy, an old process must not mark a new event processed with nobody to handle it |
| RT-3 closes the holders' sockets after telling them | Reconnecting recomputes the rooms with the same code as the first connect; nothing can be left joined. The web client reconnects on that event — client work in step 4 |
| Sockets close when the access token expires | RT-1 checks only at the handshake; without this a revoked session could keep a socket open indefinitely |
| Socket path `/api/socket.io` | Under the prefix the Vite proxy and the reverse proxy already forward. Websockets through Vite need `ws: true` on that proxy entry — step 4 |
| §5.3's other shared types arrive later | `ResolvedShift` and the other People types come with step 1; `presence.ts` (`PRESENCE`, `readDay`, `compareEvents`) comes at the start of step 3. Nothing uses them earlier, and their tests belong with their first users. The roadmap lists this |

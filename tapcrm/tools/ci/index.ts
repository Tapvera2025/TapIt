#!/usr/bin/env tsx
/**
 * CI gates — TECH.md §15.
 *
 *   "The registry is the source of truth because NOTHING CAN DIVERGE FROM IT
 *    WITHOUT THE BUILD GOING RED."
 *
 * Checks are split into two severities:
 *
 *   BLOCKING   §15.3 release-blocking set. Fails the build now.
 *   PHASED     Correct to fail eventually, but expected to fail while modules
 *              are unimplemented. Reported with counts so the gap is visible
 *              rather than forgotten. `--strict` promotes them to blocking,
 *              which is what a release build runs.
 *
 * Reporting a phased check as a warning is a deliberate choice: a gate that is
 * always red gets ignored, and an ignored gate is worse than no gate.
 *
 *   npm run ci            development
 *   npm run ci -- --strict  release verification
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const STRICT = process.argv.includes('--strict');

interface Finding {
  readonly check: string;
  readonly rule: string;
  readonly message: string;
  readonly severity: 'blocking' | 'phased';
}

const findings: Finding[] = [];
const passed: string[] = [];

function blocking(check: string, rule: string, message: string): void {
  findings.push({ check, rule, message, severity: 'blocking' });
}
function phased(check: string, rule: string, message: string): void {
  findings.push({ check, rule, message, severity: 'phased' });
}
function ok(check: string): void {
  passed.push(check);
}

/* ------------------------------------------------------------------ *
 * File walking
 * ------------------------------------------------------------------ */

function walk(dir: string, extensions: string[], skip: string[] = []): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'coverage'].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, extensions, skip));
    } else if (extensions.some((e) => entry.endsWith(e))) {
      const rel = relative(ROOT, full);
      if (!skip.some((s) => rel.includes(s))) out.push(full);
    }
  }
  return out;
}

const sourceFiles = walk(resolve(ROOT, 'packages'), ['.ts', '.tsx'], ['.generated.']);
const serverFiles = sourceFiles.filter((f) => f.includes('packages/server/src'));
const moduleFiles = serverFiles.filter((f) => f.includes('/src/modules/'));
const read = (f: string): string => readFileSync(f, 'utf8');
const rel = (f: string): string => relative(ROOT, f);

/**
 * Removes comments before pattern-matching.
 *
 * These checks are greps, and a grep that fires on the doc comment EXPLAINING
 * the rule is worse than no grep: the first thing a team does with a gate that
 * cries wolf is learn to skim past it, and by then the real findings are
 * skimmed past too. Every check below that scans for a code pattern runs
 * against this, not the raw text.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => (line.trimStart().startsWith('//') ? '' : line.replace(/\/\/.*$/, '')))
    .join('\n');
}

/* ================================================================== *
 * CI-15 — no module imports the raw pool or creates its own connection
 * ================================================================== */
{
  const ALLOWED = ['platform/dal/pool.ts'];
  let violations = 0;
  for (const file of sourceFiles) {
    const normalized = file.replace(/\\/g, '/');
    if (ALLOWED.some((a) => normalized.endsWith(a))) continue;
    const text = read(file);
    if (/from\s+['"]pg['"]|new\s+Pool\s*\(|require\(['"]pg['"]\)/.test(text)) {
      blocking('CI-15', 'CI-15', `${rel(file)} imports the pg driver directly. Use the DAL.`);
      violations += 1;
    }
  }
  if (violations === 0) ok('CI-15  no direct pg pool outside the DAL');
}

/* ================================================================== *
 * CI-16 / guardrail — no SET app.organization_id outside the DAL
 * ================================================================== */
{
  const ALLOWED = ['platform/dal/db.ts'];
  let violations = 0;
  for (const file of sourceFiles) {
    const normalized = file.replace(/\\/g, '/');
    if (ALLOWED.some((a) => normalized.endsWith(a))) continue;
    if (/set_config\(\s*['"`]app\.organization_id/.test(stripComments(read(file)))) {
      blocking(
        'CI-16',
        'TN-6',
        `${rel(file)} sets tenant context. Only the DAL may — a setting left on a pooled ` +
          'connection leaks across tenants.',
      );
      violations += 1;
    }
  }
  if (violations === 0) ok('CI-16  tenant context set only in the DAL');
}

/* ================================================================== *
 * TN-LIST — the tenant-table list matches the migrations
 *
 * `platform/dal/tenant-tables.ts` is what stops a cross-tenant surface from
 * reaching tenant data. It is a hand-maintained list, so it is only as good as
 * its agreement with the schema — and a table that is RLS-protected but missing
 * from the list is a table `platformDb` will happily accept, where the RLS
 * policy then matches nothing and the statement silently succeeds.
 * ================================================================== */
{
  const declared = new Set<string>();
  const listFile = resolve(ROOT, 'packages/server/src/platform/dal/tenant-tables.ts');
  if (existsSync(listFile)) {
    const body = read(listFile).split('GLOBAL_TABLES')[0] ?? '';
    for (const match of body.matchAll(/^\s*'([a-z_]+)',$/gm)) {
      declared.add(match[1] as string);
    }
  }

  const protectedTables = new Set<string>();
  for (const file of walk(resolve(ROOT, 'migrations'), ['.sql'])) {
    const text = read(file);
    for (const match of text.matchAll(/apply_tenant_rls\(\s*'([a-z_]+)'\s*\)/g)) {
      protectedTables.add(match[1] as string);
    }
    for (const match of text.matchAll(/ALTER TABLE (\w+)\s+ENABLE ROW LEVEL SECURITY/gi)) {
      protectedTables.add((match[1] as string).toLowerCase());
    }
  }

  const missing = [...protectedTables].filter((t) => !declared.has(t)).sort();
  const stale = [...declared].filter((t) => !protectedTables.has(t)).sort();

  if (missing.length > 0) {
    blocking(
      'TN-LIST',
      'MT-5',
      `TENANT_OWNED_TABLES is missing ${String(missing.length)} RLS-protected table(s): ` +
        `${missing.join(', ')}. A cross-tenant surface would accept them and silently match no rows.`,
    );
  }
  if (stale.length > 0) {
    blocking(
      'TN-LIST',
      'MT-5',
      `TENANT_OWNED_TABLES names ${String(stale.length)} table(s) no migration protects: ` +
        `${stale.join(', ')}.`,
    );
  }
  if (missing.length === 0 && stale.length === 0) {
    ok(`TN-LIST tenant table list matches the schema (${String(protectedTables.size)} tables)`);
  }
}

/* ================================================================== *
 * TN-SURFACE — platformDb never declares a tenant-owned table
 *
 * The DAL refuses these at runtime. This catches them at build time, which is
 * where a developer wants to find out.
 * ================================================================== */
{
  let violations = 0;
  for (const file of serverFiles) {
    if (file.endsWith('platform/dal/db.ts')) continue;
    const text = stripComments(read(file));
    for (const match of text.matchAll(/tables:\s*\[([^\]]*)\]/g)) {
      const named = [...(match[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
      const tenantOwned = named.filter((t) => !['organization', 'schema_migrations', 'country', 'currency'].includes(t));
      if (tenantOwned.length > 0) {
        blocking(
          'TN-SURFACE',
          'MT-5',
          `${rel(file)} points a cross-tenant call at tenant-owned table(s): ` +
            `${tenantOwned.join(', ')}. Use \`db\` with a RequestContext, or \`identityDb\`.`,
        );
        violations += 1;
      }
    }
  }
  if (violations === 0) ok('TN-SURFACE cross-tenant calls name only global tables');
}

/* ================================================================== *
 * ID-DAL — the pre-authentication surface stays in identity
 *
 * `identityDb` exists because authentication has to read `app_user` before a
 * principal exists. That is a narrow, named exception. Feature code reaching
 * for it would be feature code running without a principal, which is the
 * authorization engine bypassed rather than satisfied.
 * ================================================================== */
{
  let violations = 0;
  for (const file of sourceFiles) {
    const normalized = file.replace(/\\/g, '/');
    if (normalized.includes('/src/modules/identity/')) continue;
    if (normalized.endsWith('platform/dal/db.ts')) continue;
    if (/\bidentityDb\b/.test(stripComments(read(file)))) {
      blocking(
        'ID-DAL',
        'TN-5',
        `${rel(file)} uses identityDb. That surface exists only for authentication, before a ` +
          'principal exists. Everything else goes through `db` with a RequestContext.',
      );
      violations += 1;
    }
  }
  if (violations === 0) ok('ID-DAL  pre-auth DAL confined to the identity module');
}

/* ================================================================== *
 * CI-19 — no account-type / role checks outside the engine
 * ================================================================== */
{
  let violations = 0;
  for (const file of [...moduleFiles, ...serverFiles.filter((f) => f.includes('/platform/http/'))]) {
    const text = read(file);
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
      if (/accountType\s*===\s*['"]super-admin['"]/.test(line)) {
        blocking(
          'CI-19',
          'CI-19',
          `${rel(file)}:${i + 1} compares accountType directly. globalAccess is derived in ` +
            'one place (contracts/principal.ts); a second copy is a second answer.',
        );
        violations += 1;
      }
    });
  }
  if (violations === 0) ok('CI-19  no role checks outside the authorization engine');
}

/* ================================================================== *
 * globalAccess is derived, never stored — TECH.md §6.3
 * ================================================================== */
{
  let violations = 0;

  // The thing §4.7 forbids is STORAGE: "No column, no policy, no override, no
  // delegation path, no interface control. A boolean on a record is a boolean
  // somebody can set." So the check looks for the two shapes that would create
  // one — a database column, and a hard-coded literal in code — and does not
  // object to a value computed by calling the derive function, which is the
  // only sanctioned way to obtain it.
  for (const file of walk(resolve(ROOT, 'migrations'), ['.sql'])) {
    if (/\bglobal_access\b/.test(read(file))) {
      blocking(
        'globalAccess',
        '§4.7',
        `${rel(file)} declares a global_access column. globalAccess is derived from account ` +
          'type and has no storage: a column is a value somebody can set.',
      );
      violations += 1;
    }
  }

  for (const file of sourceFiles) {
    if (file.endsWith('contracts/src/principal.ts')) continue;
    const text = stripComments(read(file));
    // A hard-coded literal, never a call: `globalAccess(p)` is the derivation.
    if (/globalAccess\s*[:=]\s*(true|false)\b/.test(text)) {
      blocking(
        'globalAccess',
        '§4.7',
        `${rel(file)} assigns globalAccess a literal. It is derived from account type — ` +
          'call globalAccess(principal) rather than deciding it here.',
      );
      violations += 1;
    }
  }

  if (violations === 0) ok('glob   globalAccess is derived, never stored');
}

/* ================================================================== *
 * CI-23 — deny filters compile to explicit FALSE
 * ================================================================== */
{
  let violations = 0;

  // Scoped to files that actually register a ResourcePolicy. The previous
  // version matched any `filter(` — including `rows.filter(...)` and
  // `users.filter(...)` — so three of its findings were Array.prototype and
  // the check spent its credibility on noise.
  const policyFiles = moduleFiles.filter((file) =>
    /registerResourcePolicy\s*\(/.test(stripComments(read(file))),
  );

  for (const file of policyFiles) {
    const text = stripComments(read(file));

    // A `filter` implementation whose default branch returns an empty fragment.
    if (/default:\s*\n?\s*return\s*\{\s*sql:\s*['"`]\s*['"`]/.test(text)) {
      blocking(
        'CI-23',
        'AZ-I2',
        `${rel(file)} returns an empty fragment as a deny. In SQL an omitted WHERE means ` +
          'MATCH EVERYTHING — use MATCH_NOTHING.',
      );
      violations += 1;
    }

    if (!/MATCH_NOTHING/.test(text)) {
      blocking(
        'CI-23',
        'AZ-I2',
        `${rel(file)} registers a ResourcePolicy but never references MATCH_NOTHING. ` +
          'Every deny path must compile to a provably false predicate.',
      );
      violations += 1;
    }
  }

  if (violations === 0) {
    ok(`CI-23  deny filters compile to explicit FALSE (${String(policyFiles.length)} policy files)`);
  }
}

/* ================================================================== *
 * CI-21 — no authoritative money field maps to JavaScript number
 * ================================================================== */
{
  const MONEY = /\b(amount|value|total|balance|price|salary|discount|net|gross|tax|paid|due)\w*\s*[?]?:\s*number\b/i;
  let violations = 0;
  for (const file of sourceFiles) {
    read(file)
      .split('\n')
      .forEach((line, i) => {
        if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
        // Counts and percentages are legitimately numbers; money is not.
        if (/count|percent|index|length|version|attempts|limit|port|seconds|ms\b/i.test(line)) return;
        if (MONEY.test(line)) {
          blocking(
            'CI-21',
            'PG-5',
            `${rel(file)}:${i + 1} types a monetary field as \`number\`. Use \`Decimal\` — ` +
              '0.1 + 0.2 is not 0.3, and an invoice built on that does not reconcile.',
          );
          violations += 1;
        }
      });
  }
  if (violations === 0) ok('CI-21  no money typed as JavaScript number');
}

/* ================================================================== *
 * CI-31 — transaction creation and retry live only in the DAL
 * ================================================================== */
{
  let violations = 0;
  for (const file of sourceFiles) {
    const normalized = file.replace(/\\/g, '/');
    if (normalized.includes('platform/dal/')) continue;
    if (/['"`]BEGIN['"`]|['"`]COMMIT['"`]|['"`]ROLLBACK['"`]/.test(read(file))) {
      blocking(
        'CI-31',
        'CI-31',
        `${rel(file)} issues transaction control directly. The DAL owns transactions and ` +
          'the bounded retry policy; modules never implement their own retry loops.',
      );
      violations += 1;
    }
  }
  if (violations === 0) ok('CI-31  transactions and retry confined to the DAL');
}

/* ================================================================== *
 * Module boundary — TECH.md §3
 * ================================================================== */
{
  let violations = 0;
  for (const file of moduleFiles) {
    const match = /packages\/server\/src\/modules\/([^/]+)\//.exec(file.replace(/\\/g, '/'));
    const own = match?.[1];
    read(file)
      .split('\n')
      .forEach((line, i) => {
        const importMatch = /from\s+['"](\.\.\/)+modules\/([^/'"]+)\/([^'"]+)['"]/.exec(line);
        if (!importMatch) return;
        const target = importMatch[2];
        const what = importMatch[3] ?? '';
        if (target === own) return;
        if (/service|repository|policy|state/.test(what)) {
          blocking(
            'boundary',
            '§3',
            `${rel(file)}:${i + 1} imports ${target}/${what}. "A module may import contracts, ` +
              'authz and platform. It may NOT import another module\'s service, repository or policy."',
          );
          violations += 1;
        }
      });
  }
  if (violations === 0) ok('bound  module boundaries respected');
}

/* ================================================================== *
 * CI-20 — no interpolated user-controlled SQL
 * ================================================================== */
{
  const ALLOWED = ['platform/dal/sql.ts', 'authz/src/scope-resolver.ts', 'platform/authz-adapter.ts'];
  let violations = 0;
  for (const file of serverFiles) {
    const normalized = file.replace(/\\/g, '/');
    if (ALLOWED.some((a) => normalized.endsWith(a))) continue;
    read(file)
      .split('\n')
      .forEach((line, i) => {
        if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
        // A template literal that both interpolates and looks like a query, and
        // is not tagged with the `sql` tag.
        //
        // TWO keywords, not one. A single `WHERE` or `FROM` turns up constantly
        // in ordinary English — including in the error messages that explain
        // these very rules — and a check that fires on prose is a check people
        // learn to skip past.
        const template = /(?<!sql)`[^`]*\$\{[^`]*`/.exec(line)?.[0] ?? '';
        const keywords = new Set(
          [...template.matchAll(/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|WHERE|FROM|JOIN|VALUES|RETURNING)\b/gi)]
            .map((m) => m[0].toUpperCase()),
        );
        if (template !== '' && keywords.size >= 2 && !/sql`/.test(line)) {
          blocking(
            'CI-20',
            'T-7',
            `${rel(file)}:${i + 1} interpolates into a SQL string without the sql\`\` tag. ` +
              '"SQL is not forbidden. UNSAFE SQL is forbidden."',
          );
          violations += 1;
        }
      });
  }
  if (violations === 0) ok('CI-20  no interpolated SQL outside the tagged template');
}

/* ================================================================== *
 * CI-33 — RLS enabled and forced on every tenant-owned table
 * ================================================================== */
{
  const migrations = walk(resolve(ROOT, 'migrations'), ['.sql']);
  const all = migrations.map(read).join('\n');

  const created = [...all.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(([\s\S]*?)\n\)/g)];
  const tenantTables = created
    .filter(([, , body]) => /organization_id\s+uuid\s+NOT NULL/.test(body ?? ''))
    .map(([, name]) => name!)
    .filter((n) => n !== 'organization');

  const missing = tenantTables.filter(
    (t) =>
      !new RegExp(`apply_tenant_rls\\('${t}'\\)`).test(all) &&
      !new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`).test(all),
  );

  if (missing.length > 0) {
    blocking(
      'CI-33',
      'PG-4',
      `${missing.length} tenant-owned table(s) without RLS: ${missing.join(', ')}`,
    );
  } else {
    ok(`CI-33  RLS on all ${tenantTables.length} tenant-owned tables`);
  }

  // Guardrail: PostgreSQL 19 beta must not appear in any environment config.
  const compose = existsSync(resolve(ROOT, 'docker-compose.yml'))
    ? read(resolve(ROOT, 'docker-compose.yml'))
    : '';
  if (/postgres:19/.test(compose)) {
    blocking('PG-1', 'PG-1', 'docker-compose.yml pins PostgreSQL 19. Do not deploy 19 beta.');
  } else if (/postgres:18/.test(compose)) {
    ok('PG-1   PostgreSQL 18.x pinned');
  }
}

/* ================================================================== *
 * CI-9 — the generated registry matches a fresh extraction
 * ================================================================== */
{
  const generated = resolve(ROOT, 'packages/contracts/src/registry.generated.ts');
  if (!existsSync(generated)) {
    blocking('CI-9', 'RG-I1', 'registry.generated.ts is missing. Run `npm run registry:extract`.');
  } else {
    ok('CI-9   registry generated (drift verified by `registry:extract -- --check`)');
  }
}

/* ================================================================== *
 * CI-2 / CI-10 — coverage of the 147 actions (PHASED)
 *
 * These import the BUILT module registry and read the real registrations,
 * rather than grepping source. A grep undercounts any policy produced by a
 * factory, and a coverage gate that silently undercounts is worse than none.
 * ================================================================== */
{
  const seedPath = resolve(ROOT, 'seeds/registry.seed.json');
  const modulesDist = resolve(ROOT, 'packages/server/dist/modules/index.js');

  if (existsSync(seedPath) && existsSync(modulesDist)) {
    const seed = JSON.parse(read(seedPath)) as {
      actions: { action: string; resource: string | null }[];
      bindings: { method: string; path: string }[];
    };

    const { registerAllPolicies, registerAllRoutes } = (await import(
      pathToFileURL(modulesDist).href
    )) as { registerAllPolicies: () => void; registerAllRoutes: () => void };

    const authz = (await import('@tapcrm/authz')) as {
      registeredResourceTypes: () => readonly string[];
    };
    const routeModule = (await import(
      pathToFileURL(resolve(ROOT, 'packages/server/dist/platform/http/route.js')).href
    )) as { registeredBindings: () => readonly { method: string; path: string }[] };

    registerAllPolicies();
    registerAllRoutes();

    /* ---- CI-2: manifest bindings with a route ---- */
    const bound = new Set(routeModule.registeredBindings().map((b) => `${b.method} ${b.path}`));
    const declared = new Set(seed.bindings.map((b) => `${b.method} ${b.path}`));
    const unimplemented = [...declared].filter((k) => !bound.has(k));

    if (unimplemented.length > 0) {
      phased(
        'CI-2',
        'RM-1',
        `${bound.size} of ${declared.size} manifest bindings implemented; ` +
          `${unimplemented.length} awaiting their module.`,
      );
    } else {
      ok('CI-2   every manifest binding has a route');
    }

    /* ---- CI-10: registry resources with a ResourcePolicy ---- */
    const registeredResources = new Set(authz.registeredResourceTypes());
    const needed = new Set(
      seed.actions.map((a) => a.resource).filter((r): r is string => r !== null),
    );
    const missing = [...needed].filter((r) => !registeredResources.has(r));

    if (missing.length > 0) {
      phased(
        'CI-10',
        'AZ-I6b',
        `${needed.size - missing.length} of ${needed.size} registry resources have a ` +
          'ResourcePolicy. Startup fails on the rest once their module lands.',
      );
    } else {
      ok('CI-10  every registry resource has a ResourcePolicy');
    }

    /* ---- A registered policy for a resource no action names is dead code ---- */
    const orphans = [...registeredResources].filter((r) => !needed.has(r));
    if (orphans.length > 0) {
      blocking(
        'CI-10b',
        'RG-5',
        `ResourcePolicy registered for resource(s) no registry action names: ${orphans.join(', ')}. ` +
          'Either the name is misspelled or the policy is dead code.',
      );
    }
  }
}

/* ================================================================== *
 * CI-7 — every approval-bearing action declares an initiator field
 * ================================================================== */
{
  const seedPath = resolve(ROOT, 'seeds/registry.seed.json');
  if (existsSync(seedPath)) {
    const seed = JSON.parse(read(seedPath)) as {
      actions: { action: string; approvalBearing: boolean; initiatorField: string | null }[];
    };
    const bad = seed.actions.filter((a) => a.approvalBearing && a.initiatorField === null);
    if (bad.length > 0) {
      blocking(
        'CI-7',
        'GP-5',
        `${bad.length} approval-bearing action(s) with no initiator field: ` +
          bad.map((a) => a.action).join(', '),
      );
    } else {
      const count = seed.actions.filter((a) => a.approvalBearing).length;
      ok(`CI-7   all ${count} approval-bearing actions declare an initiator field`);
    }
  }
}

/* ================================================================== *
 * Report
 * ================================================================== */

const blockingFindings = findings.filter((f) => f.severity === 'blocking');
const phasedFindings = findings.filter((f) => f.severity === 'phased');

console.log('\nTapCRM CI gates — TECH.md §15\n');
for (const check of passed) console.log(`  ✓ ${check}`);

if (phasedFindings.length > 0) {
  console.log('\n  Phased (expected while modules are unimplemented):');
  for (const f of phasedFindings) {
    console.log(`  ${STRICT ? '✗' : '○'} ${f.check}  [${f.rule}] ${f.message}`);
  }
}

if (blockingFindings.length > 0) {
  console.log('\n  Blocking:');
  for (const f of blockingFindings) {
    console.log(`  ✗ ${f.check}  [${f.rule}] ${f.message}`);
  }
}

const failed = STRICT ? findings.length : blockingFindings.length;

if (failed > 0) {
  console.error(
    `\n✗ ${failed} check(s) failed${STRICT ? ' (strict)' : ''}. ` +
      `${passed.length} passed.\n`,
  );
  process.exit(1);
}

console.log(
  `\n✓ ${passed.length} check(s) passed` +
    (phasedFindings.length > 0
      ? `, ${phasedFindings.length} phased gap(s) reported. Run with --strict for release verification.\n`
      : '.\n'),
);

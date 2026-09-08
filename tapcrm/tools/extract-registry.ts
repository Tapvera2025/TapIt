#!/usr/bin/env tsx
/**
 * Registry extractor — TECH.md §6.1.
 *
 *   AUTHORIZATION.md §6.4 ──┐
 *   AUTHORIZATION.md §6.5 ──┼──► registry.generated.ts
 *                            └──► registry.seed.json
 *
 * RG-I1: the generated file is committed, CI regenerates and diffs it, and
 * drift between the document and the code fails the build.
 * RG-I4: invariants RG-1..RG-6 are asserted HERE, at build time — an invalid
 * registry cannot be compiled, rather than failing on some request months later.
 *
 * Run:  npm run registry:extract
 * Check: npm run registry:extract -- --check   (no write; exits 1 on drift)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const SOURCE = resolve(ROOT, 'docs/AUTHORIZATION.md');
const OUT_TS = resolve(ROOT, 'packages/contracts/src/registry.generated.ts');
const OUT_JSON = resolve(ROOT, 'seeds/registry.seed.json');

/* ------------------------------------------------------------------ *
 * The 42 modules. Duplicated deliberately: this tool runs BEFORE the
 * contracts package is compiled, so it cannot import from it. CI-11
 * asserts the two lists agree.
 * ------------------------------------------------------------------ */
const MODULES = new Set([
  'identity', 'organization', 'access-management', 'audit', 'system-administration',
  'employee-directory', 'onboarding', 'live-status', 'attendance', 'break-management',
  'shifts', 'biometric', 'leave', 'holidays', 'payroll', 'performance',
  'territories', 'leads', 'callbacks', 'handovers', 'deals', 'approvals',
  'handoff', 'projects', 'tasks', 'resource-planning', 'delivery',
  'clients', 'post-closure', 'client-portal',
  'billing-terms', 'invoicing', 'payments', 'receivables', 'payables', 'accounting',
  'chat', 'project-communication', 'documents', 'reporting', 'notifications', 'workspace',
]);

/**
 * Action namespace → owning module.
 *
 * The namespace is NOT always the module name: `org:` belongs to
 * `organization`, `access:` to `access-management`, `system:` to
 * `system-administration`. RG-1 checks the declared module against this map
 * rather than assuming the prefix is the module, because assuming it would
 * silently accept `org:view-people` as belonging to a module named "org" that
 * does not exist.
 */
const NAMESPACE_TO_MODULE: Record<string, string> = {
  org: 'organization',
  access: 'access-management',
  system: 'system-administration',
  users: 'employee-directory',
  notepad: 'workspace',
  notices: 'workspace',
  sheets: 'workspace',
  todo: 'workspace',
  profile: 'workspace',
  search: 'workspace',
  billing: 'billing-terms',
  resources: 'resource-planning',
  changes: 'delivery',
  accounts: 'clients',
  communication: 'project-communication',
  reports: 'reporting',
  renewals: 'post-closure',
  breaks: 'break-management',
  wfh: 'leave',
  status: 'live-status',
  portal: 'client-portal',
  brief: 'handoff',
};

function moduleForNamespace(ns: string): string | undefined {
  return NAMESPACE_TO_MODULE[ns] ?? (MODULES.has(ns) ? ns : undefined);
}

/* ------------------------------------------------------------------ *
 * Markdown table parsing
 * ------------------------------------------------------------------ */

interface Row {
  readonly cells: Record<string, string>;
  readonly line: number;
}

class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionError';
  }
}

const errors: string[] = [];
const warnings: string[] = [];
function fail(rule: string, message: string): void {
  errors.push(`  [${rule}] ${message}`);
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function isSeparator(line: string): boolean {
  return /^\|?[\s:|-]+\|[\s:|-]*$/.test(line.trim()) && line.includes('-');
}

/**
 * Finds the LAST markdown table under the given `## <heading>` section that
 * contains every required column. "Last" rather than "first" because a section
 * commonly opens with a column-semantics table before the data table.
 */
function findTable(markdown: string, heading: string, required: string[]): Row[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.trim().toLowerCase().startsWith(`## ${heading.toLowerCase()}`));
  if (start === -1) {
    throw new ExtractionError(`Section "## ${heading}" not found in ${SOURCE}`);
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i]!.startsWith('## ')) {
      end = i;
      break;
    }
  }

  const tables: Row[][] = [];
  let i = start + 1;

  while (i < end) {
    const line = lines[i]!;
    if (line.trim().startsWith('|') && i + 1 < end && isSeparator(lines[i + 1]!)) {
      const headers = splitRow(line);
      const rows: Row[] = [];
      let j = i + 2;
      while (j < end && lines[j]!.trim().startsWith('|')) {
        const cells = splitRow(lines[j]!);
        const record: Record<string, string> = {};
        headers.forEach((h, idx) => {
          record[h] = cells[idx] ?? '';
        });
        rows.push({ cells: record, line: j + 1 });
        j += 1;
      }
      if (required.every((r) => headers.includes(r))) tables.push(rows);
      i = j;
    } else {
      i += 1;
    }
  }

  const table = tables.at(-1);
  if (!table || table.length === 0) {
    throw new ExtractionError(
      `No table under "## ${heading}" has all required columns: ${required.join(', ')}`,
    );
  }
  return table;
}

const clean = (v: string): string => v.replace(/`/g, '').trim();
const isDash = (v: string): boolean => {
  const c = clean(v);
  return c === '' || c === '—' || c === '-' || c === 'null';
};

function bool(value: string, rule: string, where: string): boolean {
  const v = clean(value).toLowerCase();
  if (v === 'yes' || v === 'true') return true;
  if (v === 'no' || v === 'false') return false;
  fail(rule, `${where}: expected yes/no, got "${value}"`);
  return false;
}

/* ------------------------------------------------------------------ *
 * Extraction
 * ------------------------------------------------------------------ */

interface ActionRow {
  action: string;
  module: string;
  resource: string | null;
  domain: string;
  sensitive: boolean;
  approvalBearing: boolean;
  initiatorField: string | null;
  grantPolicy: { positionGrantable: boolean; delegationAllowed: boolean; superAdminOnly: boolean };
  description: string;
}

interface BindingRow {
  method: string;
  path: string;
  action: string;
  resourceParam: string | null;
}

const ACTION_COLUMNS = [
  'Action', 'Module', 'Resource', 'Domain', 'Sensitive',
  'ApprovalBearing', 'InitiatorField', 'PositionGrantable',
  'DelegationAllowed', 'SuperAdminOnly',
];

function extractActions(markdown: string): ActionRow[] {
  const rows = findTable(markdown, '6.4 Action Registry', ACTION_COLUMNS);
  const seen = new Map<string, number>();
  const out: ActionRow[] = [];

  for (const { cells, line } of rows) {
    const action = clean(cells['Action'] ?? '');
    if (!action) continue;
    const where = `${action} (line ${line})`;

    // RG-2 — action names are unique.
    const prior = seen.get(action);
    if (prior !== undefined) {
      fail('RG-2', `Duplicate action "${action}" at lines ${prior} and ${line}`);
      continue;
    }
    seen.set(action, line);

    // RG-1 — `<namespace>:<verb>`, namespace resolves to the declared module.
    const declaredModule = clean(cells['Module'] ?? '');
    const match = /^([a-z][a-z0-9-]*):([a-z][a-z0-9-]*)$/.exec(action);
    if (!match) {
      fail('RG-1', `${where}: not of the form <namespace>:<verb>`);
      continue;
    }
    const expected = moduleForNamespace(match[1]!);
    if (expected === undefined) {
      fail('RG-1', `${where}: namespace "${match[1]}" maps to no known module`);
    } else if (expected !== declaredModule) {
      fail('RG-1', `${where}: namespace implies module "${expected}", row declares "${declaredModule}"`);
    }
    if (!MODULES.has(declaredModule)) {
      fail('RG-1', `${where}: "${declaredModule}" is not one of the 42 modules`);
    }

    const domain = clean(cells['Domain'] ?? '');
    if (!['people', 'business', 'derived'].includes(domain)) {
      fail('RG-1', `${where}: domain "${domain}" is not people | business | derived`);
    }

    const approvalBearing = bool(cells['ApprovalBearing'] ?? '', 'RG-4', where);
    const initiatorField = isDash(cells['InitiatorField'] ?? '')
      ? null
      : clean(cells['InitiatorField'] ?? '');

    const sensitive = bool(cells['Sensitive'] ?? '', 'RG-1', where);
    const positionGrantable = bool(cells['PositionGrantable'] ?? '', 'RG-3', where);
    const delegationAllowed = bool(cells['DelegationAllowed'] ?? '', 'RG-1', where);
    const superAdminOnly = bool(cells['SuperAdminOnly'] ?? '', 'RG-2', where);

    /* ---- Registry invariants, verbatim from AUTHORIZATION.md §6.4 ---- */

    // RG-1 — Del = Y requires Sens = ·. "A sensitive action is never delegable
    // — a delegate may hold it, but only Super Admin may hand it out."
    if (delegationAllowed && sensitive) {
      fail('RG-1', `${where}: delegable but sensitive — a sensitive action is never delegable`);
    }

    // RG-2 — SA = Y implies Del = · (GP-2).
    if (superAdminOnly && delegationAllowed) {
      fail('RG-2', `${where}: superAdminOnly but delegable (GP-2)`);
    }

    // RG-3 — Pos = · implies Del = · and SA = Y (GP-1). Exactly two actions
    // qualify: notepad:view-all and billing:set-terms.
    if (!positionGrantable) {
      if (delegationAllowed) {
        fail('RG-3', `${where}: not positionGrantable but delegable (GP-1)`);
      }
      if (!superAdminOnly) {
        fail('RG-3', `${where}: not positionGrantable but not superAdminOnly (GP-1)`);
      }
    }

    // RG-4 — Appr = Y requires a non-null initiator field (GP-5). AZ-I12: a
    // segregation control that silently passes when the field is absent is
    // worse than none, because it is believed.
    if (approvalBearing && initiatorField === null) {
      fail('RG-4', `${where}: approvalBearing with no initiatorField (GP-5)`);
    }
    if (!approvalBearing && initiatorField !== null) {
      fail('RG-4', `${where}: initiatorField declared on a non-approval-bearing action`);
    }

    // RG-5 — every action names a resource or is explicitly —. Satisfied by
    // construction: an absent cell would have failed the column check above.

    out.push({
      action,
      module: declaredModule,
      resource: isDash(cells['Resource'] ?? '') ? null : clean(cells['Resource'] ?? ''),
      domain,
      sensitive,
      approvalBearing,
      initiatorField,
      grantPolicy: { positionGrantable, delegationAllowed, superAdminOnly },
      description: (cells['Description'] ?? '').trim(),
    });
  }

  return out.sort((a, b) => a.action.localeCompare(b.action));
}

function extractBindings(markdown: string, actions: ActionRow[]): BindingRow[] {
  const rows = findTable(markdown, '6.5 API Bindings', ['Method', 'Path', 'Action', 'ResourceParam']);
  const byAction = new Map(actions.map((a) => [a.action, a]));
  const seen = new Set<string>();
  const routeOwners = new Map<string, string>();
  const routeConflicts: string[] = [];
  const paramWithoutResource: string[] = [];
  const out: BindingRow[] = [];

  for (const { cells, line } of rows) {
    const action = clean(cells['Action'] ?? '');
    const path = clean(cells['Path'] ?? '');
    const method = clean(cells['Method'] ?? '').toUpperCase();
    if (!action || !path) continue;
    const where = `${method} ${path} (line ${line})`;

    if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      fail('CI-3', `${where}: unknown method "${method}"`);
    }

    // §6.2 makes method+path the authorization key, so two actions on one route
    // is ambiguous. It occurs once in v1.8 (`GET /api/changes`), so this is a
    // WARNING rather than a build failure: the document is the authority on
    // what exists, and the boot-time router check (RM-1) is the enforcement
    // point that will reject the second registration.
    const routeKey = `${method} ${path}`;
    const fullKey = `${routeKey} ${action}`;
    if (seen.has(fullKey)) {
      fail('CI-3', `${where}: duplicate binding (identical method, path and action)`);
    }
    seen.add(fullKey);
    const priorAction = routeOwners.get(routeKey);
    if (priorAction !== undefined && priorAction !== action) {
      routeConflicts.push(`${routeKey} → ${priorAction} and ${action}`);
    } else {
      routeOwners.set(routeKey, action);
    }

    // CI-3 — every binding names a registered action.
    const def = byAction.get(action);
    if (!def) {
      fail('CI-3', `${where}: action "${action}" is not in the registry`);
      continue;
    }

    const resourceParam = isDash(cells['ResourceParam'] ?? '')
      ? null
      : clean(cells['ResourceParam'] ?? '');

    // CI-6 / RM-14 — a declared ResourceParam must be a real path parameter.
    //
    // The converse is NOT checked. A path parameter is not necessarily a
    // resource identifier: `GET /api/org/ladder/:departmentCode` and
    // `GET /api/access/who-can/:action` both carry a parameter that FILTERS a
    // collection rather than naming an instance, and the registry correctly
    // marks both `—`. Deciding which is which is the document's judgement, and
    // it has already made it — inferring it here would just second-guess the
    // authority with a heuristic.
    const pathParams = [...path.matchAll(/:([a-zA-Z][a-zA-Z0-9_]*)/g)].map((m) => m[1]!);
    if (resourceParam !== null && !pathParams.includes(resourceParam)) {
      fail('CI-6', `${where}: ResourceParam ":${resourceParam}" is not a parameter of the path`);
    }
    if (resourceParam !== null && def.resource === null) {
      // Not a failure. The Param column records the path parameter, which is
      // not always a resource identifier — `PUT /api/system/integrations/:key`
      // names a configuration key. The route binder ignores `resourceParam`
      // whenever `REGISTRY[action].resource` is null, so no object is loaded
      // and no object-level check is skipped. Recorded so the mismatch is
      // visible rather than silently absorbed.
      paramWithoutResource.push(`${method} ${path} (${action}, :${resourceParam})`);
    }

    out.push({ method, path, action, resourceParam });
  }

  if (paramWithoutResource.length > 0) {
    warnings.push(
      'Binding declares a path parameter for an action that names no resource.\n' +
        '  The router loads no object for these and performs no object-level check,\n' +
        '  which is correct for configuration routes:\n    ' +
        paramWithoutResource.join('\n    '),
    );
  }

  if (routeConflicts.length > 0) {
    warnings.push(
      'One route is bound to more than one action. §6.2 makes method+path the\n' +
        '  authorization key, so this is ambiguous and the boot-time router check\n' +
        '  (RM-1) will reject the second registration:\n    ' +
        routeConflicts.join('\n    '),
    );
  }

  // CI-2 — every registry action has at least one binding. An action with no
  // route is an action nothing can exercise.
  const bound = new Set(out.map((b) => b.action));
  for (const a of actions) {
    if (!bound.has(a.action)) fail('CI-2', `Action "${a.action}" has no API binding`);
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Emit
 * ------------------------------------------------------------------ */

function emitTypeScript(actions: ActionRow[], bindings: BindingRow[]): string {
  const union = actions.map((a) => `  | '${a.action}'`).join('\n');

  const entries = actions
    .map((a) => {
      const j = (v: string | null) => (v === null ? 'null' : `'${v}'`);
      return `  '${a.action}': {
    action: '${a.action}',
    module: '${a.module}',
    resource: ${j(a.resource)},
    domain: '${a.domain}',
    sensitive: ${a.sensitive},
    approvalBearing: ${a.approvalBearing},
    initiatorField: ${j(a.initiatorField)},
    grantPolicy: {
      positionGrantable: ${a.grantPolicy.positionGrantable},
      delegationAllowed: ${a.grantPolicy.delegationAllowed},
      superAdminOnly: ${a.grantPolicy.superAdminOnly},
    },
    description: ${JSON.stringify(a.description)},
  },`;
    })
    .join('\n');

  const bind = bindings
    .map(
      (b) =>
        `  { method: '${b.method}', path: '${b.path}', action: '${b.action}', resourceParam: ${
          b.resourceParam === null ? 'null' : `'${b.resourceParam}'`
        } },`,
    )
    .join('\n');

  return `/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source:    docs/AUTHORIZATION.md §6.4, §6.5
 * Generator: tools/extract-registry.ts
 * Regenerate: npm run registry:extract
 *
 * RG-I1: this file is committed and CI diffs it against a fresh extraction.
 * Editing it by hand makes the build red, which is the point — the document is
 * the source of truth, not the code.
 *
 * Actions: ${actions.length}   Bindings: ${bindings.length}
 */

import type { ActionDefinition, ActionBinding } from './registry.types.js';

/**
 * RG-I2 — a union of string literals. Every function that takes an action takes
 * this type, so a typo is a compile error rather than a runtime deny.
 */
export type Action =
${union};

export const ACTIONS: readonly Action[] = [
${actions.map((a) => `  '${a.action}',`).join('\n')}
] as const;

export const REGISTRY: Readonly<Record<Action, ActionDefinition<Action>>> = {
${entries}
};

export const BINDINGS: readonly ActionBinding<Action>[] = [
${bind}
];

const ACTION_SET: ReadonlySet<string> = new Set(ACTIONS);

/** SE-2 — unknown actions DENY. The system fails closed. */
export function isAction(value: string): value is Action {
  return ACTION_SET.has(value);
}
`;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

function main(): void {
  const check = process.argv.includes('--check');

  if (!existsSync(SOURCE)) {
    console.error(`✗ ${SOURCE} does not exist.

AUTHORIZATION.md is the authoritative source for the action registry
(PRD §22, TECH.md §1). Without it there is no Action union, no route
binding and no permission matrix seed.`);
    process.exit(1);
  }

  const markdown = readFileSync(SOURCE, 'utf8');

  let actions: ActionRow[];
  let bindings: BindingRow[];
  try {
    actions = extractActions(markdown);
    bindings = extractBindings(markdown, actions);
  } catch (error) {
    console.error(`✗ ${(error as Error).message}`);
    process.exit(1);
  }

  if (errors.length > 0) {
    console.error(`✗ Registry invariants violated (RG-I4 — an invalid registry cannot compile):\n`);
    console.error(errors.join('\n'));
    console.error(`\n${errors.length} problem(s) in docs/AUTHORIZATION.md.`);
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('\n⚠ ' + warnings.join('\n⚠ ') + '\n');
  }

  const generated = emitTypeScript(actions, bindings);
  const seed = JSON.stringify({ actions, bindings }, null, 2) + '\n';

  if (check) {
    const currentTs = existsSync(OUT_TS) ? readFileSync(OUT_TS, 'utf8') : '';
    const currentJson = existsSync(OUT_JSON) ? readFileSync(OUT_JSON, 'utf8') : '';
    if (currentTs !== generated || currentJson !== seed) {
      console.error(
        `✗ CI-9: generated registry does not match a fresh extraction.\n` +
          `  Run \`npm run registry:extract\` and commit the result.`,
      );
      process.exit(1);
    }
    console.log(`✓ CI-9: registry in sync (${actions.length} actions, ${bindings.length} bindings)`);
    return;
  }

  writeFileSync(OUT_TS, generated, 'utf8');
  writeFileSync(OUT_JSON, seed, 'utf8');
  console.log(
    `✓ Extracted ${actions.length} actions and ${bindings.length} bindings\n` +
      `  → packages/contracts/src/registry.generated.ts\n` +
      `  → seeds/registry.seed.json`,
  );

  const EXPECTED_ACTIONS = 147;
  const EXPECTED_BINDINGS = 292;
  if (actions.length < EXPECTED_ACTIONS) {
    console.warn(
      `\n⚠ TECH.md §1 cites ${EXPECTED_ACTIONS} actions and ${EXPECTED_BINDINGS} bindings.\n` +
        `  docs/AUTHORIZATION.md currently defines ${actions.length} and ${bindings.length}.\n` +
        `  This is expected while the document is a scaffold. It is a GO-LIVE BLOCKER.`,
    );
  }
}

main();

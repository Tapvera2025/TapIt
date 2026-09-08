import { registerConstraint, PASS, DENY } from './registry.js';

/**
 * Absolute constraints A1–A4 — PRD §4.7.
 *
 * These apply to EVERY principal INCLUDING Super Admin, and run at pipeline
 * step 3, before the bypass at step 4 (AZ-I8).
 *
 * A1 (segregation of duties) is not registered here: it needs the per-action
 * initiator field from the registry and runs at step 2, even earlier. See
 * `sod.ts`.
 *
 * AC-4 requires each of A1–A4 to have a test that attempts the prohibited
 * action THROUGH THE API and is refused (TS-I1).
 */

export function registerAbsoluteConstraints(): void {
  /* ------------------------------------------------------------------ *
   * A2 — Client isolation
   * ------------------------------------------------------------------ */
  registerConstraint({
    id: 'A2',
    kind: 'absolute',
    appliesTo: ['*'],
    describe: 'A client principal can only reach resources belonging to their own account.',
    evaluate: (ctx, _action, resource) => {
      if (ctx.principal.accountType !== 'client') return PASS;
      if (resource === undefined) return PASS;

      // PRD §4.1: "A client principal has no scope. Client isolation is a
      // principal-to-resource relationship evaluated as absolute constraint A2
      // BEFORE any policy resolution, not a value on this enum."
      const owner = resource['clientId'] ?? resource['client_id'];

      if (owner === undefined) {
        // Fails closed: a resource that cannot prove it belongs to this client
        // is not reachable by this client.
        return DENY(
          `A2: ${resource.type} declares no client owner; a client principal cannot reach it.`,
        );
      }
      if (owner !== ctx.principal.clientId) {
        // NOTE: the HTTP layer renders this as 404, not 403 (CP-2). A 403 would
        // confirm the record exists, which is itself a disclosure across the
        // boundary this constraint defends.
        return DENY(`A2: client boundary — ${resource.type}:${resource.id} belongs to another account.`);
      }
      return PASS;
    },
  });

  /* ------------------------------------------------------------------ *
   * A3 — Record immutability
   * ------------------------------------------------------------------ */
  registerConstraint({
    id: 'A3',
    kind: 'absolute',
    appliesTo: ['*'],
    describe:
      'Published payslips, recorded approvals, audit entries, delivery sign-offs, issued ' +
      'invoices, recorded receipts and posted journals cannot be edited — only superseded ' +
      'by a linked correcting document.',
    evaluate: (_ctx, action, resource) => {
      if (resource === undefined) return PASS;
      if (resource['immutable'] !== true) return PASS;

      // Reads are always fine against an immutable record; only mutation is barred.
      const verb = action.split(':')[1] ?? '';
      const isMutation = !/^(view|list|export|search|download)/.test(verb);
      if (!isMutation) return PASS;

      return DENY(
        `A3: ${resource.type}:${resource.id} is immutable. Supersede it with a linked ` +
          'correcting document — a revision, a credit note, or a reversing journal — ' +
          'rather than editing it. This binds Super Admin too.',
      );
    },
  });

  /* ------------------------------------------------------------------ *
   * A4 — Financial period integrity
   * ------------------------------------------------------------------ */
  registerConstraint({
    id: 'A4',
    kind: 'absolute',
    appliesTo: ['*'],
    describe: 'Nothing posts into a closed accounting period.',
    evaluate: (_ctx, action, resource) => {
      if (resource === undefined) return PASS;
      if (resource['periodStatus'] !== 'closed') return PASS;

      const verb = action.split(':')[1] ?? '';
      if (/^(view|list|export|search|download)/.test(verb)) return PASS;

      // "This binds every principal including Super Admin: Super Admin may
      // REOPEN a period, but may not POST into one that is closed."
      if (action === 'accounting:reopen-period') return PASS;

      return DENY(
        `A4: the accounting period for ${resource.type}:${resource.id} is closed. ` +
          'Reopen it first — Super Admin only, with a recorded reason, and both the close ' +
          'and the reopen are audited.',
      );
    },
  });
}

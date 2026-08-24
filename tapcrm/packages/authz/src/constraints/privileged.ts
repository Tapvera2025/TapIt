import { registerConstraint, PASS, DENY } from './registry.js';

/**
 * Privileged constraints P1–P8 — PRD §4.7.
 *
 * These apply to everyone EXCEPT Super Admin, and run at pipeline step 5,
 * after the bypass at step 4 (AZ-I8).
 *
 * ⚠ SCAFFOLD STATUS. P1, P2, P3, P4 and P8 are implemented below because their
 * predicates are fully specified in the PRD and depend only on resource fields.
 * P5, P6 and P7 are declared but NOT yet enforceable: each needs data the
 * Foundation phase does not carry yet.
 *
 *   P5 — needs the delivery task/client-data model (P4 phase)
 *   P6 — needs sub-team membership resolution (P4 phase)
 *   P7 — needs resource domain declared on every business resource (per phase)
 *
 * They are registered as explicit FAIL-CLOSED placeholders rather than omitted,
 * so that wiring a resource into a phase cannot silently skip its constraint.
 * Each throws a defect if reached with a resource it cannot judge, per AZ-I9.
 */

export function registerPrivilegedConstraints(): void {
  /* ------------------------------------------------------------------ *
   * P1 — Closing-terms confidentiality
   * ------------------------------------------------------------------ */
  registerConstraint({
    id: 'P1',
    kind: 'privileged',
    appliesTo: ['*'],
    describe:
      'An agent cannot read the commercials of a deal they did not close that passed ' +
      'beyond their own approval limit. Governs the Deal resource ONLY — post-closure ' +
      'account ownership does not widen it (an ownership relationship is not a ' +
      'disclosure channel).',
    evaluate: (ctx, action, resource) => {
      if (resource === undefined) return PASS;
      if (resource.type !== 'deal') return PASS;
      if (!action.includes('commercial')) return PASS;

      if (resource['closedBy'] === ctx.principal.id) return PASS;

      // AC-4c — an originating agent who did not close the deal sees stage,
      // lifecycle and sourcing credit, and NO monetary field (unless BD-9 is
      // enabled, in which case exactly `creditedValue`, handled by projection).
      return DENY(
        'P1: closing terms are readable by the closer and the approval chain only. ' +
          'Sourcing credit does not confer commercial visibility.',
      );
    },
  });

  /* ------------------------------------------------------------------ *
   * P2 — Payslip privacy
   * ------------------------------------------------------------------ */
  registerConstraint({
    id: 'P2',
    kind: 'privileged',
    appliesTo: ['*'],
    describe: 'A payslip is readable by its subject and by payroll holders. Team scope never reaches payslips.',
    evaluate: (ctx, _action, resource) => {
      if (resource === undefined) return PASS;
      if (resource.type !== 'payslip' && resource.type !== 'salary_structure') return PASS;

      if (resource['subjectId'] === ctx.principal.id) return PASS;
      if (resource['__holderHasPayrollManage'] === true) return PASS;

      return DENY(
        'P2: payslips are readable by their subject and by payroll holders only. ' +
          'A line manager does not receive subordinate payslips through team scope.',
      );
    },
  });

  /* ------------------------------------------------------------------ *
   * P3 — Notepad privacy
   * ------------------------------------------------------------------ */
  registerConstraint({
    id: 'P3',
    kind: 'privileged',
    appliesTo: ['*'],
    describe: 'Employee notepads are readable by the owner and by Super Admin. Disclosed in-product (DP-7).',
    evaluate: (ctx, _action, resource) => {
      if (resource === undefined) return PASS;
      if (resource.type !== 'notepad') return PASS;
      if (resource['ownerId'] === ctx.principal.id) return PASS;

      // `notepad:view-all` is Super Admin only and not grantable to anyone, so
      // reaching here as a non-super-admin is always a denial.
      return DENY('P3: a notepad is readable by its owner and by Super Admin.');
    },
  });

  /* ------------------------------------------------------------------ *
   * P4 — Leave document privacy
   * ------------------------------------------------------------------ */
  registerConstraint({
    id: 'P4',
    kind: 'privileged',
    appliesTo: ['*'],
    describe: 'Attachments on a leave request are readable by HR only.',
    evaluate: (ctx, _action, resource) => {
      if (resource === undefined) return PASS;
      if (resource.type !== 'leave_attachment') return PASS;
      if (resource['subjectId'] === ctx.principal.id) return PASS;
      if (resource['__holderIsHr'] === true) return PASS;

      return DENY(
        'P4: leave attachments are readable by HR only. An approving manager sees the ' +
          'request, not the medical certificate.',
      );
    },
  });

  /* ------------------------------------------------------------------ *
   * P5, P6, P7 — declared, fail-closed until their phase lands
   * ------------------------------------------------------------------ */
  registerConstraint({
    id: 'P5',
    kind: 'privileged',
    appliesTo: ['*'],
    describe: 'Base delivery employees cannot read client contact, payment or contract details.',
    evaluate: (_ctx, _action, resource) => {
      if (resource === undefined) return PASS;
      if (resource['__p5ClientData'] !== true) return PASS;
      return DENY(
        'P5: client contact, payment and contract details are not readable by base ' +
          'delivery employees. (Scaffold: full predicate lands with P4 Delivery.)',
      );
    },
  });

  registerConstraint({
    id: 'P6',
    kind: 'privileged',
    appliesTo: ['*'],
    describe: 'A sub-team manager cannot reach another sub-team\'s work.',
    evaluate: (_ctx, _action, resource) => {
      if (resource === undefined) return PASS;
      // Primary enforcement is structural: team scope resolution descends only
      // through parent_team_id and never ascends to a sibling branch
      // (TECH.md §6.5). This entry is the belt to that braces.
      if (resource['__crossSubTeam'] !== true) return PASS;
      return DENY('P6: cross-sub-team isolation. The three sub-teams are disjoint boundaries.');
    },
  });

  registerConstraint({
    id: 'P7',
    kind: 'privileged',
    appliesTo: ['*'],
    describe:
      'An HR principal cannot read business-domain records at any scope. HR reads derived ' +
      'aggregates only. Compensation and payroll are PEOPLE-domain and are not restricted here.',
    evaluate: (_ctx, _action, resource) => {
      if (resource === undefined) return PASS;
      if (resource['__holderIsHr'] !== true) return PASS;
      if (resource['__domain'] !== 'business') return PASS;

      // PD-2: "This is how P7 is enforced STRUCTURALLY. HR cannot reach a deal
      // because the scope they hold is undefined for that domain, not because a
      // check remembered to run." This constraint is the explicit backstop.
      return DENY(
        'P7: HR holds people-domain policies. Business-domain records are outside that ' +
          'domain entirely — HR reads derived aggregates only.',
      );
    },
  });

  /* ------------------------------------------------------------------ *
   * P8 — Billing terms authority
   * ------------------------------------------------------------------ */
  registerConstraint({
    id: 'P8',
    kind: 'privileged',
    appliesTo: ['*'],
    describe:
      'Setting what a client pays belongs to Super Admin permanently, whether or not ' +
      'Finance is staffed. Never grantable — not even to a Finance Manager.',
    evaluate: (_ctx, action) => {
      if (action !== 'billing:set-terms') return PASS;
      // Reaching step 5 at all means the principal is not Super Admin, since
      // Super Admin returned at step 4.
      return DENY(
        'P8: `billing:set-terms` is a protected capability held by Super Admin alone ' +
          'and is not grantable through Access Management.',
      );
    },
  });
}

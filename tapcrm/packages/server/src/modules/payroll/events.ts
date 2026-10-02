export const PAYROLL_EVENTS = {
  INPUT_CHANGED: 'payroll.input-changed',
  STRUCTURE_CHANGED: 'payroll.structure-changed',
  CONFIG_CHANGED: 'payroll.config-changed',
  /** A run moved to computing: its pending employees are queued for calculation. */
  RUN_STARTED: 'payroll.run-started',
  PUBLISHED: 'payroll.published',
  REVISED: 'payroll.revised',
} as const;

export interface InputChanged {
  readonly inputId: string;
  readonly userId: string;
  readonly periodStart: string;
  readonly action: 'created' | 'revoked';
}

export interface StructureChanged {
  readonly structureId: string;
  readonly userId: string;
}

export interface ConfigChanged {
  readonly configId: string;
  readonly effectiveFrom: string;
  readonly action: 'accepted' | 'superseded';
}

export interface RunStarted {
  readonly runId: string;
}

export interface RunPublished {
  readonly runId: string;
  readonly periodStart: string;
  readonly publishedAt: string;
  readonly payslips: readonly { readonly payslipId: string; readonly userId: string }[];
}

export interface SlipRevised {
  readonly slipId: string;
  readonly userId: string;
  readonly periodStart: string;
  readonly revisionNumber: number;
  readonly reason: string;
}

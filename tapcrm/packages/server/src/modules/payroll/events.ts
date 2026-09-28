export const PAYROLL_EVENTS = {
  INPUT_CHANGED: 'payroll.input-changed',
  STRUCTURE_CHANGED: 'payroll.structure-changed',
  CONFIG_CHANGED: 'payroll.config-changed',
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

import type { DateOnly } from '@tapcrm/contracts';
import type { PinMapping } from './types.js';

/**
 * PIN → person (§10.3 step 6, BI-2 as G15 scopes it). Mappings are dated and
 * end-exclusive. Within a connector a device's own row overrides the
 * connector-wide row for that device. The date asked about is the punch's own
 * date: its corrected instant's calendar date in the organization's timezone.
 */

export function covers(
  mapping: Pick<PinMapping, 'effectiveFrom' | 'effectiveTo'>,
  date: DateOnly,
): boolean {
  return (
    mapping.effectiveFrom <= date &&
    (mapping.effectiveTo === null || date < mapping.effectiveTo)
  );
}

/** The mapping that says whose punch this is, or null (the punch waits, unmapped). */
export function resolvePin(
  mappings: readonly PinMapping[],
  punch: {
    readonly connectorId: string;
    readonly deviceId: string;
    readonly pin: string;
  },
  date: DateOnly,
): PinMapping | null {
  const candidates = mappings.filter(
    (mapping) =>
      mapping.connectorId === punch.connectorId &&
      mapping.pin === punch.pin &&
      covers(mapping, date),
  );
  return (
    candidates.find((mapping) => mapping.deviceId === punch.deviceId) ??
    candidates.find((mapping) => mapping.deviceId === null) ??
    null
  );
}

type Period = Pick<PinMapping, 'effectiveFrom' | 'effectiveTo'>;

/** Two end-exclusive periods share a day. */
export function periodsOverlap(a: Period, b: Period): boolean {
  return (
    (b.effectiveTo === null || a.effectiveFrom < b.effectiveTo) &&
    (a.effectiveTo === null || b.effectiveFrom < a.effectiveTo)
  );
}

export type ProposedMapping = Omit<PinMapping, 'id'> & {
  readonly id?: string | undefined;
};

/**
 * Rows the proposal would collide with: the same PIN in the same scope — the
 * connector, or the same device of it — for a shared day. The database's
 * exclusion constraint says the same; this names the rows for the answer.
 */
export function scopeConflicts(
  existing: readonly PinMapping[],
  proposed: ProposedMapping,
): PinMapping[] {
  return existing.filter(
    (row) =>
      row.id !== proposed.id &&
      row.connectorId === proposed.connectorId &&
      row.deviceId === proposed.deviceId &&
      row.pin === proposed.pin &&
      periodsOverlap(row, proposed),
  );
}

export interface OverrideWarning {
  readonly pin: string;
  readonly deviceId: string;
  readonly deviceRowUserId: string;
  readonly connectorRowUserId: string;
}

/**
 * A device row and a connector-wide row for the same PIN, over a shared day,
 * naming different people. Allowed — the device row wins there — but usually
 * a mistake, so the registry shows it (G15).
 */
export function overrideWarnings(mappings: readonly PinMapping[]): OverrideWarning[] {
  const warnings: OverrideWarning[] = [];
  for (const device of mappings) {
    if (device.deviceId === null) continue;
    for (const wide of mappings) {
      if (
        wide.deviceId === null &&
        wide.connectorId === device.connectorId &&
        wide.pin === device.pin &&
        wide.userId !== device.userId &&
        periodsOverlap(wide, device)
      )
        warnings.push({
          pin: device.pin,
          deviceId: device.deviceId,
          deviceRowUserId: device.userId,
          connectorRowUserId: wide.userId,
        });
    }
  }
  return warnings;
}

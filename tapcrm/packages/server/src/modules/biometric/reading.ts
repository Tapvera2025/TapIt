import type { EventKind, Evidence } from '@tapcrm/contracts';
import type {
  DeviceReadingSettings,
  NormalizedPunch,
  PunchMeaning,
  ReaderDirection,
  StatusKind,
} from './types.js';

/**
 * Reading a punch, once, when it first arrives (D37, §10.3 step 3). Everything
 * here is fixed on the stored punch; a replay reads the stored reading, never
 * today's device settings.
 */

export interface PunchReading {
  readonly occurredAt: Date;
  /** `occurredAt` plus the device's clock offset (BI-4). */
  readonly correctedAt: Date;
  readonly appliedOffsetSeconds: number;
  readonly directionAtReceipt: ReaderDirection;
  readonly meaning: PunchMeaning;
  readonly dryRunAtReceipt: boolean;
}

export function readPunch(
  punch: NormalizedPunch,
  device: DeviceReadingSettings,
): PunchReading {
  const direction =
    (punch.readerKey === null ? undefined : device.readers.get(punch.readerKey)) ??
    device.readerDirection;
  return {
    occurredAt: punch.occurredAt,
    correctedAt: new Date(punch.occurredAt.getTime() + device.clockOffsetSeconds * 1000),
    appliedOffsetSeconds: device.clockOffsetSeconds,
    directionAtReceipt: direction,
    meaning: meaningOf(direction, punch.statusKind),
    dryRunAtReceipt: device.dryRun,
  };
}

/**
 * An entry reader means `in` and an exit reader `out`; a both-trusted reader
 * means what its key says, or a plain scan when the key says nothing known; an
 * alternating or undirected reader gives a plain scan.
 */
export function meaningOf(
  direction: ReaderDirection,
  statusKind: StatusKind | null,
): PunchMeaning {
  switch (direction) {
    case 'entry':
      return 'in';
    case 'exit':
      return 'out';
    case 'both-trusted':
      return statusKind ?? 'scan';
    case 'alternating':
    case 'undirected':
      return 'scan';
  }
}

/**
 * The event a stored reading becomes (§10.3 step 9): its meaning, `confirmed`
 * when a directed reader said it, `assumed` for a scan. An alternating reader's
 * scans stay scans until alternation is switched on (step 5 Task 5).
 */
export function eventOf(reading: Pick<PunchReading, 'meaning'>): {
  readonly kind: EventKind;
  readonly evidence: Evidence;
} {
  return reading.meaning === 'scan'
    ? { kind: 'scan', evidence: 'assumed' }
    : { kind: reading.meaning, evidence: 'confirmed' };
}

/** More than this ahead of the server's clock is a wrong device clock, not a punch. */
export const FUTURE_TOLERANCE_SECONDS = 5 * 60;

export type Plausibility = 'plausible' | 'future' | 'backdated';

/**
 * §10.3 step 5. A punch from the future is refused ("check the device clock");
 * one older than the device's backfill window waits, held, for an
 * administrator — a backdated push cannot open a paid day by itself.
 */
export function plausibilityOf(
  correctedAt: Date,
  now: Date,
  backfillHours: number,
): Plausibility {
  const ahead = correctedAt.getTime() - now.getTime();
  if (ahead > FUTURE_TOLERANCE_SECONDS * 1000) return 'future';
  if (-ahead > backfillHours * 3600 * 1000) return 'backdated';
  return 'plausible';
}

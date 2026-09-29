import type { PunchMeaning } from './types.js';

/**
 * Duplicate bursts (BI-6, §10.3 step 7, as the 26 September review decided).
 *
 * A burst is one person's punches with one meaning in one mode (dry-run or
 * live) in one organization, each within 60 seconds of the one before. Device,
 * reader, connector and PIN are provenance, not partitions: two devices' scans
 * of one arrival are one burst. The earliest punch leads whatever order they
 * arrive in. Equal instants are ordered by provenance — reader key, the
 * source's event id, the raw line, device, then PIN, missing values first —
 * never by row id or arrival, so every order of delivery gives one answer.
 * Only punches with a person take part.
 */

export const BURST_GAP_SECONDS = 60;

export interface BurstPunch {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly meaning: PunchMeaning;
  readonly dryRun: boolean;
  readonly correctedAt: Date;
  readonly readerKey: string | null;
  readonly externalEventId: string | null;
  readonly rawLine: string;
  readonly deviceId: string;
  readonly pin: string;
}

export interface Burst {
  /** The earliest punch; it alone may become attendance. */
  readonly head: BurstPunch;
  /** Every punch of the burst in order, the head first. */
  readonly members: readonly BurstPunch[];
}

/** What separates bursts that can never be one. */
export function burstPartition(punch: BurstPunch): string {
  return JSON.stringify([
    punch.organizationId,
    punch.userId,
    punch.meaning,
    punch.dryRun,
  ]);
}

function compareText(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

/** The total order: corrected instant, then provenance. */
export function comparePunches(a: BurstPunch, b: BurstPunch): number {
  return (
    a.correctedAt.getTime() - b.correctedAt.getTime() ||
    compareText(a.readerKey, b.readerKey) ||
    compareText(a.externalEventId, b.externalEventId) ||
    compareText(a.rawLine, b.rawLine) ||
    compareText(a.deviceId, b.deviceId) ||
    compareText(a.pin, b.pin)
  );
}

/** Groups punches into bursts, in order. */
export function groupBursts(punches: readonly BurstPunch[]): Burst[] {
  const partitions = new Map<string, BurstPunch[]>();
  for (const punch of punches) {
    const key = burstPartition(punch);
    const list = partitions.get(key);
    if (list === undefined) partitions.set(key, [punch]);
    else list.push(punch);
  }
  const bursts: Burst[] = [];
  for (const list of partitions.values()) {
    const sorted = [...list].sort(comparePunches);
    let members: BurstPunch[] = [];
    for (const punch of sorted) {
      const previous = members[members.length - 1];
      if (
        previous !== undefined &&
        punch.correctedAt.getTime() - previous.correctedAt.getTime() >
          BURST_GAP_SECONDS * 1000
      ) {
        bursts.push({ head: members[0]!, members });
        members = [];
      }
      members.push(punch);
    }
    if (members.length > 0) bursts.push({ head: members[0]!, members });
  }
  return bursts.sort((a, b) => comparePunches(a.head, b.head));
}

export interface Reconciliation {
  /** The burst the incoming punch belongs to once it has arrived. */
  readonly burst: Burst;
  /**
   * Heads that no longer lead: the head of the burst an earlier punch joined,
   * or the head of the later of two bursts a punch bridged. At most one.
   */
  readonly displacedHeads: readonly BurstPunch[];
}

/**
 * What an arriving punch changes. `neighbours` are the punches already placed
 * in the incoming punch's partition, as far along the chain as it reaches.
 */
export function reconcile(
  neighbours: readonly BurstPunch[],
  incoming: BurstPunch,
): Reconciliation {
  const before = groupBursts(neighbours.filter((punch) => punch.id !== incoming.id));
  const burst = groupBursts([
    ...neighbours.filter((punch) => punch.id !== incoming.id),
    incoming,
  ]).find((candidate) => candidate.members.some((member) => member.id === incoming.id))!;
  const inBurst = new Set(burst.members.map((member) => member.id));
  const displacedHeads = before
    .filter(
      (previous) => inBurst.has(previous.head.id) && previous.head.id !== burst.head.id,
    )
    .map((previous) => previous.head);
  return { burst, displacedHeads };
}

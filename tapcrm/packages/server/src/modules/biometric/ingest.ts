import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { systemClock, wholeSeconds, type Clock } from '../../platform/time.js';
import { BIOMETRIC_EVENTS, recordEvent } from './events.js';
import { recordSkewSample, resolveSilence } from './health.js';
import { processPunch } from './pipeline.js';
import * as punches from './punch-repository.js';
import { readPunch } from './reading.js';
import type { NormalizedPunch } from './types.js';

/**
 * Receiving punches (§10.3 steps 3–4). One transaction stores every line with
 * the reading it was given as it arrived, moves the device's cursor and queues
 * the new punches for processing — all or nothing. Only after it commits may
 * the device be told its lines were accepted; from then on a punch is never
 * lost (NF-8, BI-3). Processing is separate: a small push is processed at once,
 * a backlog by jobs, and a failed attempt only delays it.
 */

export interface ReceiptInput {
  readonly deviceId: string;
  /** What the adapter parsed; lines it could not parse are not here. */
  readonly punches: readonly NormalizedPunch[];
  /** The device's cursor for this batch (ADMS `Stamp`), kept with the lines it acknowledges. */
  readonly attlogStamp?: string | null;
  /** The source pushed these lines as they happened, not from a backlog: they may measure skew. */
  readonly realtime?: boolean;
}

export type Receipt =
  | {
      readonly stored: true;
      /** Lines durably held: new now, or resends of lines already stored. */
      readonly accepted: number;
      readonly newPunchIds: readonly string[];
    }
  /** BI-1: a device that is not enabled is heard, but nothing it sends is kept. */
  | { readonly stored: false; readonly reason: 'unknown-device' | 'device-not-enabled' };

/** Lines per insert statement, and punch ids per processing signal. */
const BATCH = 500;

/** A push this small is processed before the device is answered, so the board moves at once. */
export const INLINE_PROCESSING_LIMIT = 10;

export async function receivePunches(
  ctx: RequestContext,
  input: ReceiptInput,
  clock: Clock = systemClock,
): Promise<Receipt> {
  for (const punch of input.punches) {
    if (punch.deviceId !== input.deviceId)
      throw new TypeError('Every punch in a receipt comes from the receipt’s device.');
    if (punch.occurredAt.getTime() !== wholeSeconds(punch.occurredAt).getTime())
      throw new TypeError('A device punch is read to the whole second (T-6).');
  }
  const now = wholeSeconds(clock.now());
  return db.transaction(ctx, async (tx) => {
    const device = await punches.lockDeviceForReceipt(tx, input.deviceId);
    if (device === null) return { stored: false, reason: 'unknown-device' } as const;
    await resolveSilence(tx, device.id, now);
    if (device.status !== 'enabled') {
      await punches.recordContact(tx, device.id, now, null);
      return { stored: false, reason: 'device-not-enabled' } as const;
    }

    // Read once, with the settings the device has now (D37).
    const settings = {
      timezone: device.timezone,
      clockOffsetSeconds: device.clockOffsetSeconds,
      readerDirection: device.readerDirection,
      readers: await punches.readerDirections(tx, device.id),
      dryRun: device.dryRun,
    };
    const read = input.punches.map((punch) => ({
      punch,
      reading: readPunch(punch, settings),
    }));
    const newPunchIds: string[] = [];
    for (let start = 0; start < read.length; start += BATCH) {
      newPunchIds.push(
        ...(await punches.insertPunches(
          tx,
          ctx.organizationId,
          read.slice(start, start + BATCH),
          now,
        )),
      );
    }
    await punches.recordContact(tx, device.id, now, {
      attlogStamp: input.attlogStamp ?? null,
    });

    // Skew is measured only on a realtime push of one new line; a backlog's age is not skew.
    if (input.realtime === true && read.length === 1 && newPunchIds.length === 1) {
      const sample = Math.round(
        (now.getTime() - read[0]!.reading.correctedAt.getTime()) / 1000,
      );
      await recordSkewSample(tx, ctx.organizationId, device, sample, now);
    }
    for (let start = 0; start < newPunchIds.length; start += BATCH) {
      await recordEvent(tx, ctx.organizationId, BIOMETRIC_EVENTS.PUNCHES_RECEIVED, {
        punchIds: newPunchIds.slice(start, start + BATCH),
      });
    }
    return { stored: true, accepted: input.punches.length, newPunchIds } as const;
  });
}

/**
 * Receives a push, then processes a small one at once. A failure here only
 * delays that punch: its processing job, queued with the receipt, runs it.
 */
export async function ingest(
  ctx: RequestContext,
  input: ReceiptInput,
  clock: Clock = systemClock,
): Promise<Receipt> {
  const receipt = await receivePunches(ctx, input, clock);
  if (!receipt.stored || receipt.newPunchIds.length > INLINE_PROCESSING_LIMIT)
    return receipt;
  for (const punchId of receipt.newPunchIds) {
    try {
      await processPunch(ctx, punchId, { clock });
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'warn',
          msg: 'biometric punch left for its job',
          punchId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return receipt;
}

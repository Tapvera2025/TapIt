import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

/**
 * Biometric's outbox events (TX-2). Each is written in the transaction that
 * made the change and handled after commit, so a rolled-back receipt, replay
 * or alert never queues work or sends mail.
 */
export const BIOMETRIC_EVENTS = {
  /** New raw punches were stored; each gets a processing job. */
  PUNCHES_RECEIVED: 'biometric.punches-received',
  /** An administrator asked for a replay; its job works through it. */
  REPLAY_REQUESTED: 'biometric.replay-requested',
  /** A device alert opened; the people who manage devices are told once. */
  DEVICE_ALERT: 'biometric.device-alert',
} as const;

export interface PunchesReceived {
  readonly punchIds: readonly string[];
}

export interface ReplayRequested {
  readonly requestId: string;
}

export interface DeviceAlertOpened {
  readonly alertId: string;
}

export async function recordEvent(
  tx: Tx,
  organizationId: string,
  name: (typeof BIOMETRIC_EVENTS)[keyof typeof BIOMETRIC_EVENTS],
  payload: PunchesReceived | ReplayRequested | DeviceAlertOpened,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO domain_outbox (organization_id, event_name, payload)
    VALUES (${organizationId}, ${name}, ${JSON.stringify(payload)}::jsonb)
  `);
}

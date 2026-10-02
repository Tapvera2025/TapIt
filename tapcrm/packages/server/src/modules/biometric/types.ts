import type { DateOnly } from '@tapcrm/contracts';
import type { DeviceClockReading } from '../../platform/time.js';

/**
 * Biometric ingestion's own types (design §10.2–§10.4). Adapter and pipeline
 * shapes stay here; only the admin DTOs are shared (`@tapcrm/contracts`).
 */

/** How a reader's scans are read (§9.1). */
export type ReaderDirection =
  'entry' | 'exit' | 'both-trusted' | 'alternating' | 'undirected';

/** What a punch meant when it arrived, before any alternation (D37). */
export type PunchMeaning = 'in' | 'out' | 'break-start' | 'break-end' | 'scan';

/** What a device's status key says, in the protocol's own map. */
export type StatusKind = 'in' | 'out' | 'break-start' | 'break-end';

export type VerifyMode = 'fingerprint' | 'face' | 'card' | 'password' | 'palm' | 'other';

export type PunchStatus =
  'received' | 'applied' | 'duplicate' | 'unmapped' | 'dry-run' | 'rejected' | 'held';

/** What every adapter produces (§10.2). The pipeline accepts nothing else. */
export interface NormalizedPunch {
  readonly deviceId: string;
  /** The person's number on the device: text, so leading zeros survive. */
  readonly pin: string;
  /** The device's own clock reading; null when the source sends only an instant. */
  readonly deviceLocalTime: DeviceClockReading | null;
  /** The instant, from the reading and the device's timezone; whole seconds. */
  readonly occurredAt: Date;
  /** The device's in/out key: kept as sent, trusted only by a both-trusted reader. */
  readonly statusCode: string | null;
  readonly statusKind: StatusKind | null;
  readonly verifyMode: VerifyMode | null;
  /** Which reader fired, where the protocol says. */
  readonly readerKey: string | null;
  /** The source's own event id, where it has one. */
  readonly externalEventId: string | null;
  /** The original attendance line; never biometric material. */
  readonly raw: string;
}

/** A line an adapter could not use: logged by number, never costing the rest of the batch. */
export interface RejectedLine {
  readonly line: number;
  readonly reason: string;
}

/** The device settings a punch is read with when it arrives (§10.3 step 3). */
export interface DeviceReadingSettings {
  readonly timezone: string;
  readonly clockOffsetSeconds: number;
  readonly readerDirection: ReaderDirection;
  /** Reader rows, by the key the payload spells; absent keys use `readerDirection`. */
  readonly readers: ReadonlyMap<string, ReaderDirection>;
  readonly dryRun: boolean;
}

/** One dated PIN mapping row (BI-2 as G15 scopes it); `effectiveTo` is exclusive. */
export interface PinMapping {
  readonly id: string;
  readonly connectorId: string;
  /** Null: every device on the connector. */
  readonly deviceId: string | null;
  readonly pin: string;
  readonly userId: string;
  readonly effectiveFrom: DateOnly;
  readonly effectiveTo: DateOnly | null;
}

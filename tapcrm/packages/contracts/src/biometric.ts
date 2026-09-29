/**
 * Biometric administration DTOs (attendance design §10.8).
 *
 * Only the shapes the admin screens share with the API live here; adapter and
 * pipeline types stay in the server's biometric module. Nothing here carries a
 * credential or biometric material. PINs and serials appear only in these
 * admin shapes, never in attendance's employee-facing ones.
 */
import type { DateOnly } from './people.js';

export type BiometricReaderDirection =
  'entry' | 'exit' | 'both-trusted' | 'alternating' | 'undirected';

export type BiometricDeviceStatus = 'pending' | 'enabled' | 'disabled';

export type BiometricPunchStatus =
  'received' | 'applied' | 'duplicate' | 'unmapped' | 'dry-run' | 'rejected' | 'held';

export type BiometricAlertKind =
  'silent' | 'skew' | 'timezone-suspect' | 'biometric-data-received' | 'new-source-ip';

export interface BiometricReaderDto {
  readonly readerKey: string;
  readonly label: string;
  readonly direction: BiometricReaderDirection;
}

export interface BiometricDeviceDto {
  readonly id: string;
  readonly serialNumber: string;
  readonly name: string;
  readonly locationLabel: string | null;
  readonly connector: {
    readonly id: string;
    readonly kind: string;
    readonly name: string;
  };
  readonly status: BiometricDeviceStatus;
  readonly dryRun: boolean;
  readonly timezone: string;
  readonly handshakeTimezone: string;
  readonly clockOffsetSeconds: number;
  readonly readerDirection: BiometricReaderDirection;
  readonly trustStatusKeys: boolean;
  readonly readers: readonly BiometricReaderDto[];
  readonly ipAllowlist: readonly string[];
  readonly backfillHours: number;
  readonly stampMode: 'resend-all' | 'resume';
  readonly firmware: string | null;
  readonly lastSeenAt: string | null;
  readonly lastSkewSeconds: number | null;
  readonly openAlerts: readonly {
    readonly kind: BiometricAlertKind;
    readonly openedAt: string;
  }[];
}

export interface BiometricDeviceList {
  readonly devices: readonly BiometricDeviceDto[];
  /** Pass as `after` for the next page; null on the last. */
  readonly next: string | null;
}

/** A PATCH answer: a change reaches only punches that arrive after it (D37). */
export interface BiometricDeviceChange {
  readonly device: BiometricDeviceDto;
  /** When the device was last heard from: punches it still holds are read the new way. */
  readonly lastSeenAt: string | null;
}

export interface BiometricMappingDto {
  readonly id: string;
  readonly connectorId: string;
  readonly deviceId: string | null;
  readonly pin: string;
  readonly userId: string;
  readonly effectiveFrom: DateOnly;
  /** Exclusive. */
  readonly effectiveTo: DateOnly | null;
}

export interface BiometricMappingWarning {
  readonly pin: string;
  readonly deviceId: string;
  readonly deviceRowUserId: string;
  readonly connectorRowUserId: string;
}

export interface BiometricMappingResult {
  readonly mapping: BiometricMappingDto;
  /** The PIN's rows in this connector, oldest first. */
  readonly history: readonly BiometricMappingDto[];
  readonly warnings: readonly BiometricMappingWarning[];
  /** Unmapped punches of the last 30 days this mapping now covers, ready to replay (BI-3). */
  readonly replayable: number;
  /** Punches already applied to someone else in the mapped period: opened for review, not moved. */
  readonly needsReview: number;
}

export interface BiometricPunchDto {
  readonly id: string;
  readonly deviceId: string;
  readonly serialNumber: string;
  readonly pin: string;
  readonly deviceLocalTime: string | null;
  readonly occurredAt: string;
  readonly correctedAt: string;
  readonly appliedOffsetSeconds: number;
  readonly receivedAt: string;
  readonly readerKey: string | null;
  readonly statusCode: string | null;
  readonly verifyMode: string | null;
  readonly rawLine: string;
  readonly directionAtReceipt: BiometricReaderDirection;
  readonly meaning: 'in' | 'out' | 'break-start' | 'break-end' | 'scan';
  readonly dryRunAtReceipt: boolean;
  readonly status: BiometricPunchStatus;
  readonly statusReason: string | null;
  readonly userId: string | null;
  readonly duplicateOf: string | null;
  readonly attendanceEventId: string | null;
}

export interface BiometricPunchPage {
  readonly punches: readonly BiometricPunchDto[];
  readonly next: string | null;
}

export interface BiometricReplayAccepted {
  readonly requestId: string;
  /** Punches the request selected; applied ones are never selected. */
  readonly selected: number;
}

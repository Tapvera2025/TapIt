import { bootstrapDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

/**
 * The global device directory (migration 0066, G2): which organization and
 * device own a serial. Read before a tenant is known — by the machine endpoint
 * to route a push, and at registration to refuse a serial another company
 * already holds. It reveals directory identity only; the device itself is read
 * under RLS in its tenant's context. Only the trigger on `biometric_device`
 * writes it.
 */
export async function lookupDeviceBySerial(
  serialNumber: string,
): Promise<{ organizationId: string; deviceId: string } | null> {
  const rows = await bootstrapDb.readBiometricDirectory<{
    organizationId: string;
    deviceId: string;
  }>(sql`
    SELECT organization_id, device_id
    FROM biometric_device_directory
    WHERE serial_number = ${serialNumber}
  `);
  return rows[0] ?? null;
}

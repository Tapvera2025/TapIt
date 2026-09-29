import { sendEmail } from './mailer.js';

/**
 * A biometric device needs attention (§10.6, BI-7). Identifiers and times
 * only: no punch, PIN or biometric material is ever put in an alert.
 */
export async function sendBiometricDeviceAlert(
  to: string,
  alert: {
    readonly deviceName: string;
    readonly serialNumber: string;
    readonly kind: string;
    readonly openedAt: Date;
    readonly hint: string;
  },
): Promise<void> {
  await sendEmail({
    to,
    subject: `TapIt Alert — biometric device "${alert.deviceName}" needs attention`,
    text: [
      `Device: ${alert.deviceName} (serial ${alert.serialNumber})`,
      `Alert: ${alert.kind}`,
      `Since: ${alert.openedAt.toISOString()}`,
      alert.hint,
    ].join('\n'),
  });
}

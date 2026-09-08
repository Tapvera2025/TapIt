import { sendEmail } from './mailer.js';

export async function sendGeofenceDenialAlert(adminEmail: string, details: { userEmail: string; userName: string; distanceMeters: number; nearestLocationName: string; ip: string | null }): Promise<void> {
  await sendEmail({
    to: adminEmail,
    subject: 'TapCRM Alert — Geofence Access Violation',
    text: [`User ${details.userName} (${details.userEmail}) was denied sign-in due to geofencing policy.`, `Nearest assigned location: ${details.nearestLocationName}`, `Measured distance: ${Math.round(details.distanceMeters)} metres outside fence`, `IP: ${details.ip ?? 'Unknown'}`, `Time: ${new Date().toISOString()}`].join('\n'),
  });
}

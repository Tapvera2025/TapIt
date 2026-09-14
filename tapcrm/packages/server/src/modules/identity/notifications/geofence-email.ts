import { sendEmail } from './mailer.js';

export async function sendGeofenceDenialAlert(adminEmail: string, details: { userEmail: string; userName: string; distanceMeters: number; nearestLocationName: string; ip: string | null; accuracyMetres?: number | null }): Promise<void> {
  await sendEmail({
    to: adminEmail,
    subject: 'TapCRM Alert — Geofence Access Violation',
    text: [`User ${details.userName} (${details.userEmail}) was denied sign-in due to geofencing policy.`, `Nearest assigned location: ${details.nearestLocationName}`, `Measured distance: ${Math.round(details.distanceMeters)} metres outside fence`, `Reported accuracy: ${details.accuracyMetres === null || details.accuracyMetres === undefined ? 'Unknown' : `${Math.round(details.accuracyMetres)} metres`}`, `IP: ${details.ip ?? 'Unknown'}`, `Time: ${new Date().toISOString()}`].join('\n'),
  });
}

export async function sendGeofenceConfigurationAlert(adminEmail: string, locationName: string): Promise<void> {
  await sendEmail({
    to: adminEmail,
    subject: 'TapCRM Alert — Review Geofence Configuration',
    text: [`Repeated denials were recorded near the shared geofence location "${locationName}".`, 'This may indicate a misconfigured location rather than policy violations.', `Time: ${new Date().toISOString()}`].join('\n'),
  });
}

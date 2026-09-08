import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { loadConfig } from '../../../config.js';

const EARTH_RADIUS_METRES = 6_371_000;

function encryptionKey(): Buffer {
  return createHash('sha256').update(loadConfig().JWT_REFRESH_SECRET).digest();
}

export function encryptCoordinates(latitude: number, longitude: number): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ latitude, longitude }), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

export function decryptCoordinates(value: string): { latitude: number; longitude: number } {
  const payload = Buffer.from(value, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8')) as { latitude: number; longitude: number };
}

export function distanceMetres(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number): number {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(latitudeB - latitudeA);
  const dLon = radians(longitudeB - longitudeA);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function distanceBand(distance: number): string {
  if (distance <= 50) return '0-50m';
  if (distance <= 250) return '51-250m';
  if (distance <= 1000) return '251-1000m';
  return '1000m+';
}

import type {
  BiometricDeviceChange,
  BiometricDeviceDto,
  BiometricDeviceList,
  BiometricMappingResult,
  BiometricPunchPage,
  BiometricReplayAccepted,
} from '@tapcrm/contracts';
import { identityRequest } from '../../identity/api/authApi.js';

export function listBiometricDevices(): Promise<BiometricDeviceList> {
  return identityRequest<BiometricDeviceList>('/api/biometric/devices?limit=200');
}

export function registerBiometricDevice(body: {
  serialNumber: string;
  name: string;
  locationLabel: string | null;
  timezone?: string;
}): Promise<BiometricDeviceDto> {
  return identityRequest<BiometricDeviceDto>('/api/biometric/devices', {
    method: 'POST',
    body: JSON.stringify({ ...body, adapter: 'zk-adms' }),
  });
}

export function changeBiometricDevice(
  serialNumber: string,
  body: Partial<{
    name: string;
    locationLabel: string | null;
    status: 'enabled' | 'disabled';
    dryRun: boolean;
    timezone: string;
    clockOffsetSeconds: number;
    ipAllowlist: string[];
    readerDirection: 'entry' | 'exit' | 'both-trusted' | 'alternating' | 'undirected';
    trustStatusKeys: boolean;
  }>,
): Promise<BiometricDeviceChange> {
  return identityRequest<BiometricDeviceChange>(
    `/api/biometric/devices/${encodeURIComponent(serialNumber)}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
}

export function mapBiometricPin(body: {
  connectorId: string;
  deviceId: string | null;
  pin: string;
  userId: string;
  effectiveFrom: string;
}): Promise<BiometricMappingResult> {
  return identityRequest<BiometricMappingResult>('/api/biometric/mapping', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function listBiometricPunches(query: { status?: string; deviceId?: string } = {}): Promise<BiometricPunchPage> {
  const params = new URLSearchParams({ limit: '100' });
  if (query.status) params.set('status', query.status);
  if (query.deviceId) params.set('deviceId', query.deviceId);
  return identityRequest<BiometricPunchPage>(`/api/biometric/punches?${params.toString()}`);
}

export function replayBiometricPunches(body: {
  reason: string;
  from: string;
  to: string;
  deviceId?: string;
  pin?: string;
}): Promise<BiometricReplayAccepted> {
  return identityRequest<BiometricReplayAccepted>('/api/biometric/punches/replay', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

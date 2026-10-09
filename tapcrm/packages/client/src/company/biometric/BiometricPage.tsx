import { useEffect, useMemo, useState } from 'react';
import type { BiometricDeviceDto, BiometricPunchDto } from '@tapcrm/contracts';
import {
  changeBiometricDevice,
  listBiometricDevices,
  listBiometricPunches,
  mapBiometricPin,
  registerBiometricDevice,
  replayBiometricPunches,
} from '../api/biometricApi.js';
import { getCompanyEmployees, type CompanyEmployee } from '../api/companyApi.js';
import { Button, Card, Field, Notice, SearchableSelect, Select, SkeletonTable } from '../../ui/components.js';

type Tab = 'devices' | 'mapping' | 'punches';

function when(value: string | null): string {
  if (!value) return 'never';
  return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

const STATUS_TONE: Record<string, string> = {
  enabled: 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-200',
  pending: 'bg-amber-500/14 text-amber-800 dark:text-amber-200',
  disabled: 'bg-app-surface-raised text-app-muted',
};

export function BiometricPage(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('devices');
  const [devices, setDevices] = useState<BiometricDeviceDto[]>([]);
  const [employees, setEmployees] = useState<CompanyEmployee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      setDevices([...(await listBiometricDevices()).devices]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load devices.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    void getCompanyEmployees().then(setEmployees).catch(() => setEmployees([]));
  }, []);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap gap-2">
        {(['devices', 'mapping', 'punches'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => { setTab(key); setNotice(null); }}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === key ? 'bg-app-accent text-app-on-accent' : 'border border-app-border text-app-muted hover:text-app-foreground'}`}
          >
            {key === 'devices' ? 'Devices' : key === 'mapping' ? 'Employee PINs' : 'Punch log'}
          </button>
        ))}
      </div>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {tab === 'devices' && (
        <DevicesTab devices={devices} loading={loading} onChanged={load} onNotice={setNotice} onError={setError} />
      )}
      {tab === 'mapping' && (
        <MappingTab devices={devices} employees={employees} onNotice={setNotice} onError={setError} />
      )}
      {tab === 'punches' && <PunchesTab devices={devices} employees={employees} onNotice={setNotice} onError={setError} />}
    </div>
  );
}

function DevicesTab({
  devices,
  loading,
  onChanged,
  onNotice,
  onError,
}: {
  devices: BiometricDeviceDto[];
  loading: boolean;
  onChanged: () => Promise<void>;
  onNotice: (text: string | null) => void;
  onError: (text: string | null) => void;
}): React.JSX.Element {
  const [serial, setSerial] = useState('');
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function register(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy('register');
    try {
      await registerBiometricDevice({
        serialNumber: serial.trim(),
        name: name.trim(),
        locationLabel: location.trim() || null,
      });
      setSerial(''); setName(''); setLocation('');
      onNotice('Device registered. It starts pending and in test mode (dry run): enable it once it has contacted the server.');
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to register the device.');
    } finally {
      setBusy(null);
    }
  }

  async function change(device: BiometricDeviceDto, body: Parameters<typeof changeBiometricDevice>[1], done: string): Promise<void> {
    setBusy(device.id);
    try {
      await changeBiometricDevice(device.serialNumber, body);
      onNotice(done);
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to change the device.');
    } finally {
      setBusy(null);
    }
  }

  const server = `${window.location.protocol}//${window.location.hostname}:4000`;

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm font-semibold">Connecting a machine (eSSL, Identix, ZKTeco)</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-app-muted">
          <li>Register the device below with the serial number printed on it (Menu → System Info).</li>
          <li>On the device, set Comm → Cloud/ADMS server to this API server (for example <code className="text-app-foreground">{server}</code>); the device calls <code className="text-app-foreground">/iclock/cdata</code> by itself.</li>
          <li>When “Last contact” updates, map each employee's device PIN under <em>Employee PINs</em>, then press <em>Enable</em>.</li>
          <li>Check a day of punches under <em>Punch log</em> while in test mode, then switch test mode off to apply punches to attendance.</li>
        </ol>
      </Card>

      <Card>
        <form onSubmit={(e) => void register(e)} className="grid gap-3 md:grid-cols-4">
          <Field label="Serial number" value={serial} onChange={setSerial} required placeholder="e.g. CKJG221060123" />
          <Field label="Name" value={name} onChange={setName} required placeholder="Main entrance" />
          <Field label="Location (optional)" value={location} onChange={setLocation} placeholder="Ground floor" />
          <div className="flex items-end">
            <Button type="submit" disabled={busy !== null || !serial.trim() || !name.trim()}>
              {busy === 'register' ? 'Registering…' : 'Register device'}
            </Button>
          </div>
        </form>
      </Card>

      {loading ? (
        <SkeletonTable columns={4} rows={4} />
      ) : devices.length === 0 ? (
        <p className="text-sm text-app-muted">No devices registered yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-app-border">
          <table className="w-full text-sm">
            <thead className="bg-app-surface text-left text-xs uppercase tracking-wider text-app-muted">
              <tr>
                <th className="px-4 py-3">Device</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Mode</th>
                <th className="px-4 py-3">Last contact</th>
                <th className="px-4 py-3">Timezone</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.id} className="border-t border-app-border">
                  <td className="px-4 py-3">
                    <p className="font-semibold">{device.name}</p>
                    <p className="font-mono text-xs text-app-muted">{device.serialNumber}{device.locationLabel ? ` · ${device.locationLabel}` : ''}</p>
                    {device.openAlerts.length > 0 && (
                      <p className="mt-1 text-xs text-app-danger">{device.openAlerts.map((a) => a.kind).join(', ')}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[device.status] ?? ''}`}>{device.status}</span>
                  </td>
                  <td className="px-4 py-3 text-xs">{device.dryRun ? 'Test mode (not applied)' : 'Live'}</td>
                  <td className="px-4 py-3 text-xs">{when(device.lastSeenAt)}</td>
                  <td className="px-4 py-3 text-xs">{device.timezone}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {device.status !== 'enabled' ? (
                        <Button kind="secondary" disabled={busy !== null} onClick={() => void change(device, { status: 'enabled' }, `${device.name} enabled.`)}>Enable</Button>
                      ) : (
                        <Button kind="secondary" disabled={busy !== null} onClick={() => void change(device, { status: 'disabled' }, `${device.name} disabled.`)}>Disable</Button>
                      )}
                      {device.dryRun ? (
                        <Button kind="secondary" disabled={busy !== null} onClick={() => void change(device, { dryRun: false }, `${device.name} is live: new punches now reach attendance.`)}>Go live</Button>
                      ) : (
                        <Button kind="secondary" disabled={busy !== null} onClick={() => void change(device, { dryRun: true }, `${device.name} is back in test mode.`)}>Test mode</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MappingTab({
  devices,
  employees,
  onNotice,
  onError,
}: {
  devices: BiometricDeviceDto[];
  employees: CompanyEmployee[];
  onNotice: (text: string | null) => void;
  onError: (text: string | null) => void;
}): React.JSX.Element {
  const [deviceId, setDeviceId] = useState('');
  const [pin, setPin] = useState('');
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState(today());
  const [busy, setBusy] = useState(false);
  const connectorId = devices[0]?.connector.id ?? '';
  const employeeOptions = useMemo(
    () => employees.map((e) => ({ value: e.id, label: `${e.fullName}${e.email ? ` · ${e.email}` : ''}` })),
    [employees],
  );

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const device = devices.find((d) => d.id === deviceId);
    setBusy(true);
    try {
      const result = await mapBiometricPin({
        connectorId: device?.connector.id ?? connectorId,
        deviceId: deviceId || null,
        pin: pin.trim(),
        userId,
        effectiveFrom: from,
      });
      const who = employees.find((e) => e.id === userId)?.fullName ?? 'the employee';
      onNotice(
        `PIN ${pin.trim()} now belongs to ${who}, effective ${from}.` +
          (result.replayable > 0 ? ` ${result.replayable} earlier unmapped punch(es) can be replayed from the Punch log.` : ''),
      );
      setPin(''); setUserId('');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to save the mapping.');
    } finally {
      setBusy(false);
    }
  }

  if (devices.length === 0) {
    return <p className="text-sm text-app-muted">Register a device first.</p>;
  }

  return (
    <Card>
      <p className="mb-3 text-sm text-app-muted">
        The PIN is the user number an employee is enrolled under on the machine. Leave the device empty to use the PIN on every device.
      </p>
      <form onSubmit={(e) => void save(e)} className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
        <Select
          label="Device (optional)"
          value={deviceId}
          onChange={setDeviceId}
          options={devices.map((d) => ({ value: d.id, label: `${d.name} (${d.serialNumber})` }))}
        />
        <Field label="Device PIN" value={pin} onChange={setPin} required placeholder="e.g. 1001" />
        <SearchableSelect label="Employee" value={userId} onChange={setUserId} options={employeeOptions} placeholder="Search employees" />
        <Field label="From" type="date" value={from} onChange={setFrom} required />
        <div className="flex items-end">
          <Button type="submit" disabled={busy || !pin.trim() || !userId || !from}>
            {busy ? 'Saving…' : 'Save PIN'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PunchesTab({
  devices,
  employees,
  onNotice,
  onError,
}: {
  devices: BiometricDeviceDto[];
  employees: CompanyEmployee[];
  onNotice: (text: string | null) => void;
  onError: (text: string | null) => void;
}): React.JSX.Element {
  const [status, setStatus] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [rows, setRows] = useState<BiometricPunchDto[]>([]);
  const [loading, setLoading] = useState(true);
  const names = useMemo(() => new Map(employees.map((e) => [e.id, e.fullName])), [employees]);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const page = await listBiometricPunches({
        ...(status ? { status } : {}),
        ...(deviceId ? { deviceId } : {}),
      });
      setRows([...page.punches]);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to load punches.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [status, deviceId]);

  async function replayUnmapped(): Promise<void> {
    try {
      const result = await replayBiometricPunches({
        reason: 'PIN mapping added',
        from: daysAgo(30),
        to: today(),
        ...(deviceId ? { deviceId } : {}),
      });
      onNotice(`${result.selected} punch(es) queued to be read again.`);
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to replay punches.');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Select
            label="Status"
            value={status}
            onChange={setStatus}
            options={['applied', 'dry-run', 'unmapped', 'held', 'duplicate', 'rejected', 'received'].map((s) => ({ value: s, label: s }))}
          />
        </div>
        <div className="w-64">
          <Select
            label="Device"
            value={deviceId}
            onChange={setDeviceId}
            options={devices.map((d) => ({ value: d.id, label: `${d.name} (${d.serialNumber})` }))}
          />
        </div>
        <Button kind="secondary" onClick={() => void replayUnmapped()}>Replay last 30 days</Button>
      </div>
      {loading ? (
        <SkeletonTable columns={5} rows={5} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-app-muted">No punches yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-app-border">
          <table className="w-full text-sm">
            <thead className="bg-app-surface text-left text-xs uppercase tracking-wider text-app-muted">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Device</th>
                <th className="px-4 py-3">PIN</th>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Read as</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-app-border">
                  <td className="px-4 py-2 text-xs">{when(row.correctedAt)}</td>
                  <td className="px-4 py-2 font-mono text-xs">{row.serialNumber}</td>
                  <td className="px-4 py-2 font-mono text-xs">{row.pin}</td>
                  <td className="px-4 py-2 text-xs">{row.userId ? (names.get(row.userId) ?? '—') : '—'}</td>
                  <td className="px-4 py-2 text-xs">{row.meaning}</td>
                  <td className="px-4 py-2 text-xs">
                    {row.status}
                    {row.statusReason ? <span className="text-app-muted"> · {row.statusReason}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

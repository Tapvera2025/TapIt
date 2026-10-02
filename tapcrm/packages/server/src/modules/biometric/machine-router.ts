import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { createRequestContext, systemPrincipal, type RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { enabledModuleKeys } from '../../platform/module-entitlement.js';
import { consumeRateLimit } from '../../platform/security/rate-limit.js';
import { systemClock, wholeSeconds } from '../../platform/time.js';
import { handshakeOptions, handshakeTimeZone, parseAttlog } from './adapters/zk-adms.js';
import { lookupDeviceBySerial } from './directory.js';
import { ingest } from './ingest.js';
import * as punches from './punch-repository.js';

/**
 * The machine surface for ZKTeco-firmware devices (eSSL, Identix …) —
 * attendance design §10.5, G2. Mounted at `/iclock` before JSON parsing and
 * before product authentication, like `/api/platform` and the public identity
 * routes.
 *
 * Every answer is `200 text/plain`, even on an internal error: a non-200 makes
 * the device resend the same batch before anything new, so one bad line would
 * block every later punch. But 200 is not "accepted": `OK: <count>` counts only
 * lines whose raw row committed, and a failure answers a bare `OK` with no
 * count and no Stamp advance (resend-all devices resend by themselves).
 *
 * A request finds its tenant through `biometric_device_directory` (the one
 * pre-tenant read), then runs as a service principal with no actions under
 * ordinary RLS. Unknown serials, pending or disabled devices, disabled
 * connectors, companies without the biometric module and addresses outside a
 * device's allow-list are logged by identifier and answered `OK`; nothing they
 * send is stored and no options are disclosed (BI-1). Devices are never
 * auto-registered.
 */

const PHOTO_OR_TEMPLATE_TABLES = new Set([
  'ATTPHOTO', 'USERINFO', 'USER', 'FINGERTMP', 'FACE', 'BIODATA', 'USERPIC', 'BIOPHOTO', 'FVEIN',
]);

function reply(res: Response, body: string): void {
  if (res.headersSent) return;
  res.status(200).type('text/plain').send(body);
}

function log(level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown>): void {
  console[level === 'error' ? 'error' : 'log'](JSON.stringify({ level, msg, ...fields }));
}

function queryValue(req: Request, name: string): string | null {
  for (const [key, value] of Object.entries(req.query)) {
    if (key.toLowerCase() === name.toLowerCase() && typeof value === 'string') return value.trim();
  }
  return null;
}

/** `/iclock/cdata.aspx`, `/iclock/CData` … → `cdata`. */
function endpointOf(req: Request): string {
  return req.path.replace(/^\/+/, '').toLowerCase().replace(/\.aspx$/, '').split('/')[0] ?? '';
}

interface ResolvedDevice {
  readonly ctx: RequestContext;
  readonly device: punches.MachineDevice;
}

/** Steps 1–4 of §10.5 "How a request finds its tenant"; null means "answer OK, store nothing". */
async function resolveDevice(req: Request, serial: string): Promise<ResolvedDevice | null> {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(serial)) return null;
  const entry = await lookupDeviceBySerial(serial);
  if (entry === null) {
    log('warn', 'biometric push from an unregistered serial', { serial, sourceIp: req.ip ?? null });
    return null;
  }
  const ctx = createRequestContext({
    organizationId: entry.organizationId,
    principal: systemPrincipal(entry.organizationId),
    requestId: `iclock:${serial}:${Date.now().toString(36)}`,
    sourceIp: req.ip ?? null,
  });
  const now = wholeSeconds(systemClock.now());
  const device = await db.transaction(ctx, async (tx) => {
    const found = await punches.findMachineDevice(tx, entry.deviceId);
    // Contact counts even for a pending device: the admin sees it is reachable.
    if (found !== null) await punches.recordContact(tx, found.id, now, null);
    return found;
  });
  if (device === null) return null;
  const refusal =
    device.organizationStatus !== 'active'
      ? 'company not active'
      : device.connectorStatus !== 'active'
        ? 'connector disabled'
        : device.status !== 'enabled'
          ? `device ${device.status}`
          : device.ipAllowlist.length > 0 && !device.ipAllowlist.includes(normaliseIp(req.ip))
            ? 'source address not allowed'
            : !(await enabledModuleKeys(entry.organizationId)).includes('biometric')
              ? 'biometric module not enabled'
              : null;
  if (refusal !== null) {
    log('warn', 'biometric push ignored', {
      serial,
      organizationId: entry.organizationId,
      reason: refusal,
      sourceIp: req.ip ?? null,
    });
    return null;
  }
  return { ctx, device };
}

function normaliseIp(ip: string | undefined): string {
  if (ip === undefined) return '';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

async function handle(req: Request, res: Response): Promise<void> {
  const endpoint = endpointOf(req);
  const serial = queryValue(req, 'SN');
  const sourceKey = normaliseIp(req.ip) || 'unknown';

  const limited = await consumeRateLimit(`iclock:ip:${sourceKey}`, 600, 60);
  if (!limited.allowed) {
    log('warn', 'biometric push rate-limited', { sourceIp: sourceKey, serial });
    reply(res, 'OK');
    return;
  }
  if (serial === null) {
    reply(res, 'OK');
    return;
  }
  const bySerial = await consumeRateLimit(`iclock:sn:${serial}`, 300, 60);
  if (!bySerial.allowed) {
    reply(res, 'OK');
    return;
  }

  const resolved = await resolveDevice(req, serial);
  if (resolved === null) {
    reply(res, 'OK');
    return;
  }
  const { ctx, device } = resolved;

  if (endpoint === 'cdata' && req.method === 'GET') {
    reply(
      res,
      handshakeOptions({
        serialNumber: device.serialNumber,
        attlogStamp: device.stampMode === 'resume' ? device.attlogStamp : null,
        timeZone: handshakeTimeZone(device.handshakeTimezone, device.timezone, new Date()),
      }),
    );
    return;
  }

  if (endpoint === 'cdata' && req.method === 'POST') {
    const table = (queryValue(req, 'table') ?? '').toUpperCase();
    const body = typeof req.body === 'string' ? req.body : '';
    if (table === 'ATTLOG') {
      const { punches: parsed, rejected } = parseAttlog(body, device.id, device.timezone);
      if (rejected.length > 0) {
        log('warn', 'biometric lines not readable', {
          serial,
          organizationId: ctx.organizationId,
          lines: rejected.map((r) => `${r.line}:${r.reason}`).slice(0, 20),
        });
      }
      if (parsed.length === 0) {
        reply(res, 'OK: 0');
        return;
      }
      const receipt = await ingest(ctx, {
        deviceId: device.id,
        punches: parsed,
        attlogStamp: queryValue(req, 'Stamp'),
        realtime: parsed.length === 1,
      });
      reply(res, receipt.stored ? `OK: ${receipt.accepted}` : 'OK');
      return;
    }
    if (PHOTO_OR_TEMPLATE_TABLES.has(table)) {
      // DP-2: biometric material is discarded unread; only the count is logged.
      log('warn', 'biometric material received and discarded', {
        serial,
        organizationId: ctx.organizationId,
        table,
        bytes: body.length,
      });
    }
    reply(res, 'OK');
    return;
  }

  // getrequest, devicecmd, ping, registry, push, fdata, querydata, edata …
  reply(res, 'OK');
}

export function buildBiometricMachineRouter(): Router {
  const router = Router();
  // Plain text whatever the Content-Type, up to 5 MB (§10.5).
  router.use(express.text({ type: () => true, limit: '5mb' }));
  router.use((req: Request, res: Response, next: NextFunction) => {
    handle(req, res).catch(next);
  });
  // Machine-local errors still answer the ADMS text protocol: never HTML, never JSON, never 4xx/5xx.
  router.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    log('error', 'biometric push failed', {
      path: req.path,
      serial: queryValue(req, 'SN'),
      error: error instanceof Error ? error.message : String(error),
    });
    reply(res, 'OK');
  });
  return router;
}

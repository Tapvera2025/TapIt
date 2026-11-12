#!/usr/bin/env tsx
/**
 * Provision a tenant organization with every selectable module enabled and a
 * Super Admin whose password is set directly, bypassing the invitation email
 * flow. Development/local-only — the service `createOrganization` is called
 * exactly as the normal HTTP path would, then the admin invitation is
 * programmatically accepted with a known password.
 *
 *   tsx tools/provision-tenant.ts
 *
 * Env overrides:
 *   TENANT_NAME         default "Demo Workspace <timestamp>"
 *   TENANT_CODE         default "DEMO<timestamp>"
 *   TENANT_ADMIN_EMAIL  default "demo-admin+<timestamp>@tapcrm.local"
 *   TENANT_ADMIN_PASSWORD   if unset, generates a 20-char random one and prints it
 */
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (val.length >= 2) {
      const first = val[0];
      if ((first === '"' || first === "'") && val[val.length - 1] === first) val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

const [{ platformDb }, { sql }, { createOrganization }, { PLATFORM_MODULE_GROUPS }, { hashIdentityPassword }, { normalizeIdentityEmail }, { hashToken }] =
  await Promise.all([
    import('../packages/server/src/platform/dal/db.js'),
    import('../packages/server/src/platform/dal/sql.js'),
    import('../packages/server/src/platform/organizations/service.js'),
    import('../packages/server/src/platform/modules/service.js'),
    import('../packages/server/src/modules/identity/password/service.js'),
    import('../packages/server/src/modules/identity/repository.js'),
    import('../packages/server/src/platform/auth/crypto.js'),
  ]);

const platformAdminEmail = process.env['PLATFORM_ADMIN_EMAIL']?.trim().toLowerCase();
if (!platformAdminEmail) throw new Error('PLATFORM_ADMIN_EMAIL is required (set in .env).');
const platformAdmin = await platformDb.query<{ id: string }>(
  'health-check',
  'resolve platform admin',
  sql`SELECT id FROM platform_user WHERE email = ${platformAdminEmail} LIMIT 1`,
);
const actorId = platformAdmin[0]?.id;
if (!actorId) throw new Error('Platform admin not found. Run `npm run platform:admin` first.');

const stamp = Date.now().toString(36).toUpperCase();
const name = process.env['TENANT_NAME'] ?? `Demo Workspace ${stamp}`;
const code = (process.env['TENANT_CODE'] ?? `DEMO${stamp}`).toUpperCase();
const adminEmail = process.env['TENANT_ADMIN_EMAIL'] ?? `demo-admin+${stamp.toLowerCase()}@tapcrm.local`;
const password = process.env['TENANT_ADMIN_PASSWORD'] ?? `TapcrmAdmin!${randomBytes(6).toString('base64url')}`;
const ownerFullName = process.env['TENANT_OWNER_NAME'] ?? 'Demo Super Admin';

const allModuleKeys = PLATFORM_MODULE_GROUPS.flatMap((group) => group.moduleKeys);

const created = await createOrganization(
  {
    name,
    code,
    adminEmail,
    legalCompanyName: name,
    companyType: 'Private',
    industry: 'IT / Software',
    website: '',
    companyEmail: adminEmail,
    ownerFullName,
    ownerDesignation: 'Super Admin',
    ownerMobile: '+91 9999999999',
    ownerAlternateNumber: '',
    primaryPhone: '+91 9999999999',
    alternatePhone: '',
    supportEmail: '',
    addressLine1: '1 Demo Lane',
    addressLine2: '',
    city: 'Mumbai',
    state: 'Maharashtra',
    country: 'India',
    postalCode: '400001',
    gstin: '',
    pan: '',
    registrationNumber: '',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    modules: allModuleKeys,
  },
  actorId,
);

// The service doesn't return the raw token directly; it embeds it in invitationUrl.
const invitationUrl = created.invitation.invitationUrl;
if (!invitationUrl) throw new Error('Invitation URL missing — service may be in production mode.');
const invitationToken = new URL(invitationUrl).searchParams.get('token');
if (!invitationToken) throw new Error('Could not extract invitation token from URL.');
const passwordHash = await hashIdentityPassword(password);
const normalizedEmail = normalizeIdentityEmail(adminEmail);

const accepted = await platformDb.transactionForOrganization(
  created.organization.id,
  'organization-provisioning',
  'bypass invitation email: directly accept Super Admin invitation',
  async (tx) => {
    const invitation = await tx.one<{ id: string; organizationId: string; email: string }>(sql`
      SELECT id, organization_id, email FROM admin_invitation
      WHERE token_hash = ${hashToken(invitationToken)} FOR UPDATE
    `);
    const user = await tx.one<{ id: string }>(sql`
      INSERT INTO app_user(organization_id, account_type, email, password_hash, status, email_verified_at, mfa_required, full_name)
      VALUES (${invitation.organizationId}, 'super-admin', ${normalizedEmail}, ${passwordHash}, 'active', now(), false, ${ownerFullName})
      RETURNING id
    `);
    await tx.query(sql`UPDATE admin_invitation SET accepted_at = now() WHERE id = ${invitation.id}`);
    return user;
  },
);

const enabledModules = [...created.enabledModules].sort();

console.log('');
console.log('==================== TENANT CREATED ====================');
console.log(`Organization : ${created.organization.name} (${created.organization.code})`);
console.log(`Org ID       : ${created.organization.id}`);
console.log(`Admin email  : ${normalizedEmail}`);
console.log(`Admin pass   : ${password}`);
console.log(`User ID      : ${accepted.id}`);
console.log(`Modules      : ${enabledModules.length} enabled`);
console.log(`             : ${enabledModules.join(', ')}`);
console.log('========================================================');
console.log('Login: POST /api/identity/login  { email, password }');
console.log('UI   : http://localhost:5173');

process.exit(0);

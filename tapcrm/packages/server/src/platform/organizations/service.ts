import { PlatformConflictError, PlatformNotFoundError } from '../errors.js';
import { validateSelectedModules } from '../modules/service.js';
import * as moduleRepo from '../modules/repository.js';
import { createInvitationRecord, deliverInvitation } from '../invitations/service.js';
import * as invitationRepo from '../invitations/repository.js';
import { platformDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { sendAdminInvitation } from '../../modules/identity/notifications/invitation-email.js';
import * as organizationRepo from './repository.js';
import type { OrganizationProfileUpdate } from './repository.js';

export async function createOrganization(
  input: {
    name: string;
    code: string;
    adminEmail: string;
    legalCompanyName: string;
    companyType: string;
    industry: string;
    website: string;
    companyEmail: string;
    ownerFullName: string;
    ownerDesignation: string;
    ownerMobile: string;
    ownerAlternateNumber: string;
    primaryPhone: string;
    alternatePhone: string;
    supportEmail: string;
    addressLine1: string;
    addressLine2: string;
    city: string;
    state: string;
    country: string;
    postalCode: string;
    gstin: string;
    pan: string;
    registrationNumber: string;
    timezone: string;
    currency: string;
    modules: string[];
  },
  actorId: string,
) {
  const modules = await validateSelectedModules(input.modules);
  try {
    const result = await platformDb.transaction(
      'organization-provisioning',
      'create organization, entitlements and admin invitation atomically',
      async (tx) => {
        const org = await tx.one<{
          id: string;
          code: string;
          name: string;
          timezone: string;
          currency: string;
          legalCompanyName: string;
          companyType: string;
          industry: string;
          website: string;
          companyEmail: string;
          ownerEmail: string;
          ownerFullName: string;
          ownerDesignation: string;
          ownerMobile: string;
          ownerAlternateNumber: string;
          primaryPhone: string;
          alternatePhone: string;
          supportEmail: string;
          addressLine1: string;
          addressLine2: string;
          city: string;
          state: string;
          country: string;
          postalCode: string;
          gstin: string;
          pan: string;
          registrationNumber: string;
          status: string;
          createdAt: Date;
          updatedAt: Date;
        }>(sql`
        INSERT INTO organization(name, code, legal_company_name, company_type, industry, website, company_email, owner_full_name, owner_designation, owner_email, owner_mobile, owner_alternate_number, primary_phone, alternate_phone, support_email, address_line_1, address_line_2, city, state, country, postal_code, gstin, pan, registration_number, timezone, currency)
        VALUES (${input.name}, ${input.code.toUpperCase()}, ${input.legalCompanyName}, ${input.companyType}, ${input.industry}, ${input.website}, ${input.companyEmail}, ${input.ownerFullName}, ${input.ownerDesignation}, ${input.adminEmail}, ${input.ownerMobile}, ${input.ownerAlternateNumber}, ${input.primaryPhone}, ${input.alternatePhone}, ${input.supportEmail}, ${input.addressLine1}, ${input.addressLine2}, ${input.city}, ${input.state}, ${input.country}, ${input.postalCode}, ${input.gstin}, ${input.pan}, ${input.registrationNumber}, ${input.timezone}, ${input.currency.toUpperCase()})
        RETURNING id, code, name, timezone, currency, status, created_at, updated_at, legal_company_name, company_type, industry, website, company_email, owner_full_name, owner_designation, owner_email, owner_mobile, owner_alternate_number, primary_phone, alternate_phone, support_email, address_line_1, address_line_2, city, state, country, postal_code, gstin, pan, registration_number
      `);
        const all = await moduleRepo.listModules();
        const selectedIds = new Set(modules.map((m) => m.id));
        const queue = [...selectedIds];
        while (queue.length) {
          const current = queue.shift()!;
          const deps = await moduleRepo.listDependencies([current]);
          for (const dep of deps)
            if (!selectedIds.has(dep.dependsOnModuleId)) {
              selectedIds.add(dep.dependsOnModuleId);
              queue.push(dep.dependsOnModuleId);
            }
        }
        const toEnable = all.filter((m) => m.isCore || selectedIds.has(m.id));
        for (const m of toEnable) {
          await tx.query(
            sql`INSERT INTO organization_module(organization_id, module_id, status, enabled_at, enabled_by) VALUES (${org.id}, ${m.id}, 'enabled', now(), ${actorId}) ON CONFLICT (organization_id, module_id) DO NOTHING`,
          );
        }
        const invitation = await createInvitationRecord(tx, {
          organizationId: org.id,
          email: input.adminEmail,
          createdBy: actorId,
        });
        return { org, toEnable, invitation };
      },
    );

    const base = process.env['CLIENT_ORIGIN'] ?? 'http://localhost:5173';
    const invitationUrl = `${base}/accept-invitation?token=${encodeURIComponent(result.invitation.token)}`;
    let delivery: 'email' | 'development-log' | 'failed';
    try {
      await sendAdminInvitation({
        to: input.adminEmail,
        organizationName: result.org.name,
        invitationUrl,
        expiresAt: result.invitation.expiresAt,
      });
      delivery = process.env['NODE_ENV'] === 'production' ? 'email' : 'development-log';
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'admin invitation delivery failed',
          organizationId: result.org.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      delivery = 'failed';
    }
    return {
      organization: result.org,
      enabledModules: result.toEnable.map((m) => m.key),
      invitation: {
        id: result.invitation.row.id,
        email: result.invitation.row.email,
        expiresAt: result.invitation.expiresAt,
        invitationUrl:
          process.env['NODE_ENV'] === 'production' ? undefined : invitationUrl,
        delivery,
      },
    };
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === '23505')
      throw new PlatformConflictError(
        'Organization code or another unique value already exists',
      );
    throw error;
  }
}

export async function getOrganization(id: string) {
  const org = await (await import('./repository.js')).getOrganization(id);
  if (!org) throw new PlatformNotFoundError('Organization not found');
  return org;
}

export async function deleteOrganization(id: string) {
  const deleted = await (await import('./repository.js')).deleteOrganization(id);
  if (!deleted) throw new PlatformNotFoundError('Organization not found');
  return { id: deleted.id, deleted: true };
}

export async function changeStatus(id: string, status: 'active' | 'suspended') {
  const org = await (await import('./repository.js')).getOrganization(id);
  if (!org) throw new PlatformNotFoundError('Organization not found');
  return (await import('./repository.js')).updateStatus(id, status);
}

export async function updateOrganization(
  id: string,
  input: {
    name: string;
    code: string;
    legalCompanyName: string;
    companyType: string;
    industry: string;
    website: string;
    companyEmail: string;
    adminEmail: string;
    ownerFullName: string;
    ownerDesignation: string;
    ownerMobile: string;
    ownerAlternateNumber: string;
    primaryPhone: string;
    alternatePhone: string;
    supportEmail: string;
    addressLine1: string;
    addressLine2: string;
    city: string;
    state: string;
    country: string;
    postalCode: string;
    gstin: string;
    pan: string;
    registrationNumber: string;
    timezone: string;
    currency: string;
  },
  actorId: string,
) {
  const newEmail = input.adminEmail.trim().toLowerCase();
  try {
    const result = await platformDb.transactionForOrganization(
      id,
      'organization-provisioning',
      'update organization profile and owner email',
      async (tx) => {
        const current = await organizationRepo.getOrganizationForUpdate(tx, id);
        if (!current) throw new PlatformNotFoundError('Organization not found');
        const currentEmail = current.ownerEmail.trim().toLowerCase();
        const ownerEmailChanged = currentEmail !== newEmail;
        let invitation: Awaited<ReturnType<typeof createInvitationRecord>> | undefined;

        const activeAdmin = await tx.maybeOne<{ id: string; email: string }>(sql`
            SELECT id, email
            FROM app_user
            WHERE organization_id = ${id} AND account_type = 'super-admin' AND status = 'active'
            FOR UPDATE
        `);
        const activeAdminEmailChanged = activeAdmin
          ? activeAdmin.email.trim().toLowerCase() !== newEmail
          : false;

        if (activeAdmin) {
          // An existing Super Admin always owns the login identity. This also
          // repairs older partial updates where owner_email changed first.
          if (activeAdminEmailChanged)
            await organizationRepo.updateActiveSuperAdminEmail(tx, id, newEmail);
        } else if (ownerEmailChanged) {
            const pendingInvitation = await tx.maybeOne<{ email: string }>(sql`
              SELECT email
              FROM admin_invitation
              WHERE organization_id = ${id} AND accepted_at IS NULL AND revoked_at IS NULL
              ORDER BY created_at DESC
              LIMIT 1
              FOR UPDATE
            `);
            await invitationRepo.revokePendingInTransaction(
              tx,
              id,
              pendingInvitation?.email ?? currentEmail,
            );
            invitation = await createInvitationRecord(tx, {
              organizationId: id,
              email: newEmail,
              createdBy: actorId,
            });
        }

        const profile: OrganizationProfileUpdate = {
          name: input.name,
          code: input.code,
          legalCompanyName: input.legalCompanyName,
          companyType: input.companyType,
          industry: input.industry,
          website: input.website,
          companyEmail: input.companyEmail,
          ownerEmail: newEmail,
          ownerFullName: input.ownerFullName,
          ownerDesignation: input.ownerDesignation,
          ownerMobile: input.ownerMobile,
          ownerAlternateNumber: input.ownerAlternateNumber,
          primaryPhone: input.primaryPhone,
          alternatePhone: input.alternatePhone,
          supportEmail: input.supportEmail,
          addressLine1: input.addressLine1,
          addressLine2: input.addressLine2,
          city: input.city,
          state: input.state,
          country: input.country,
          postalCode: input.postalCode,
          gstin: input.gstin,
          pan: input.pan,
          registrationNumber: input.registrationNumber,
          timezone: input.timezone,
          currency: input.currency,
        };
        const updated = await organizationRepo.updateOrganization(id, profile, tx);
        if (!updated) throw new PlatformNotFoundError('Organization not found');
        return { organization: updated, invitation };
      },
    );

    let invitationDelivery;
    if (result.invitation) {
      const delivery = await deliverInvitation({
        email: newEmail,
        organizationName: result.organization.name,
        token: result.invitation.token,
        expiresAt: result.invitation.expiresAt,
      });
      invitationDelivery = {
        id: result.invitation.row.id,
        email: result.invitation.row.email,
        expiresAt: result.invitation.expiresAt,
        invitationUrl: process.env['NODE_ENV'] === 'production' ? undefined : delivery.invitationUrl,
        delivery: delivery.delivery,
      };
    }
    return { organization: result.organization, invitation: invitationDelivery };
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === '23505')
      throw new PlatformConflictError('Organization code or another unique value already exists');
    throw error;
  }
}

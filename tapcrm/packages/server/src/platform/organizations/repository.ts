import { platformDb, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

export interface OrganizationRow {
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
}

export interface OrganizationProfileUpdate {
  name: string;
  code: string;
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
  timezone: string;
  currency: string;
}

export async function createOrganization(input: {
  name: string;
  code: string;
  timezone: string;
  currency: string;
}) {
  return platformDb.one<OrganizationRow>(
    'organization-provisioning',
    'create customer organization',
    sql`
    INSERT INTO organization(name, code, timezone, currency) VALUES (${input.name}, ${input.code}, ${input.timezone}, ${input.currency})
    RETURNING id, code, name, timezone, currency, status, created_at, updated_at
  `,
  );
}

export async function listOrganizations() {
  return platformDb.query<OrganizationRow>(
    'health-check',
    'list customer organizations',
    sql`
    SELECT id, code, name, timezone, currency, status, created_at, updated_at, legal_company_name, company_type, industry, website, company_email, owner_full_name, owner_designation, owner_email, owner_mobile, owner_alternate_number, primary_phone, alternate_phone, support_email, address_line_1, address_line_2, city, state, country, postal_code, gstin, pan, registration_number FROM organization WHERE deleted_at IS NULL ORDER BY created_at DESC
  `,
  );
}

export async function getOrganization(id: string) {
  return platformDb.maybeOne<OrganizationRow>(
    'health-check',
    'read customer organization',
    sql`
    SELECT id, code, name, timezone, currency, status, created_at, updated_at, legal_company_name, company_type, industry, website, company_email, owner_full_name, owner_designation, owner_email, owner_mobile, owner_alternate_number, primary_phone, alternate_phone, support_email, address_line_1, address_line_2, city, state, country, postal_code, gstin, pan, registration_number FROM organization WHERE id = ${id}
  `,
  );
}

export async function deleteOrganization(id: string) {
  return platformDb.maybeOne<{ id: string }>(
    'organization-provisioning',
    'soft delete customer organization from platform list',
    sql`UPDATE organization SET status = 'suspended', deleted_at = now() WHERE id = ${id} AND deleted_at IS NULL RETURNING id`,
  );
}

export async function updateStatus(id: string, status: 'active' | 'suspended') {
  return platformDb.one<OrganizationRow>(
    'organization-provisioning',
    'change organization status',
    sql`
    UPDATE organization SET status = ${status} WHERE id = ${id}
    RETURNING id, code, name, timezone, currency, status, created_at, updated_at, legal_company_name, company_type, industry, website, company_email, owner_full_name, owner_designation, owner_email, owner_mobile, owner_alternate_number, primary_phone, alternate_phone, support_email, address_line_1, address_line_2, city, state, country, postal_code, gstin, pan, registration_number
  `,
  );
}

export async function updateOrganization(
  id: string,
  input: OrganizationProfileUpdate,
  tx?: Tx,
) {
  const query = sql`
    UPDATE organization
    SET name = ${input.name}, code = ${input.code.toUpperCase()}, legal_company_name = ${input.legalCompanyName}, company_type = ${input.companyType}, industry = ${input.industry}, website = ${input.website}, company_email = ${input.companyEmail}, owner_email = ${input.ownerEmail}, owner_full_name = ${input.ownerFullName}, owner_designation = ${input.ownerDesignation}, owner_mobile = ${input.ownerMobile}, owner_alternate_number = ${input.ownerAlternateNumber}, primary_phone = ${input.primaryPhone}, alternate_phone = ${input.alternatePhone}, support_email = ${input.supportEmail}, address_line_1 = ${input.addressLine1}, address_line_2 = ${input.addressLine2}, city = ${input.city}, state = ${input.state}, country = ${input.country}, postal_code = ${input.postalCode}, gstin = ${input.gstin}, pan = ${input.pan}, registration_number = ${input.registrationNumber}, timezone = ${input.timezone}, currency = ${input.currency.toUpperCase()}
    WHERE id = ${id}
    RETURNING id, code, name, timezone, currency, status, created_at, updated_at, legal_company_name, company_type, industry, website, company_email, owner_full_name, owner_designation, owner_email, owner_mobile, owner_alternate_number, primary_phone, alternate_phone, support_email, address_line_1, address_line_2, city, state, country, postal_code, gstin, pan, registration_number
  `;
  return tx
    ? tx.maybeOne<OrganizationRow>(query)
    : platformDb.maybeOne<OrganizationRow>('organization-provisioning', 'update customer organization profile', query);
}

export async function getOrganizationForUpdate(tx: Tx, id: string) {
  return tx.maybeOne<{ id: string; name: string; status: 'active' | 'suspended'; ownerEmail: string }>(sql`
    SELECT id, name, status, owner_email
    FROM organization
    WHERE id = ${id}
    FOR UPDATE
  `);
}

export async function updateActiveSuperAdminEmail(
  tx: Tx,
  organizationId: string,
  newEmail: string,
) {
  return tx.maybeOne<{ id: string }>(sql`
    UPDATE app_user
    SET email = ${newEmail}, session_version = session_version + 1
    WHERE organization_id = ${organizationId}
      AND account_type = 'super-admin'
      AND status = 'active'
    RETURNING id
  `);
}

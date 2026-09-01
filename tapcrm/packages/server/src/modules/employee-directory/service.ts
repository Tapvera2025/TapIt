import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { visibilityFilter } from '@tapcrm/authz';
import { db, platformDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { ConflictError, NotFoundError } from '../../platform/http/error-handler.js';
import { sendEmployeeInvitation } from '../identity/email.js';

export interface CreateEmployeeInput {
  employeeId: string;
  fullName: string;
  email: string;

  contact?: string | undefined;
  dateOfBirth?: string | undefined;
  gender?: string | undefined;

  employmentType: 'full-time' | 'part-time' | 'contract' | 'intern' | 'temporary';

  joiningDate: string;
  departmentId: string;
  positionId: string;

  teamId?: string | null | undefined;
  designationId?: string | null | undefined;
  specialization?: string | null | undefined;
  reportsTo?: string | null | undefined;
}

export interface PatchEmployeeInput {
  fullName?: string | undefined;
  contact?: string | null | undefined;
  dateOfBirth?: string | null | undefined;
  gender?: string | null | undefined;

  employmentType?: CreateEmployeeInput['employmentType'] | undefined;

  joiningDate?: string | undefined;

  teamId?: string | null | undefined;
  designationId?: string | null | undefined;
  specialization?: string | null | undefined;
  reportsTo?: string | null | undefined;
  departmentId?: string | undefined;
  positionId?: string | undefined;
}

function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function newInvitation(): {
  raw: string;
  hash: string;
} {
  const raw = randomBytes(32).toString('hex');

  return {
    raw,
    hash: hashToken(raw),
  };
}

const emailOf = (value: string): string => value.trim().toLowerCase();

const employeeIdOf = (value: string): string => value.trim().toUpperCase();

async function validateAssignments(
  ctx: RequestContext,
  input: Pick<
    CreateEmployeeInput,
    'departmentId' | 'positionId' | 'teamId' | 'designationId' | 'reportsTo'
  >,
): Promise<void> {
  const position = await db.maybeOne<{ id: string }>(
    ctx,
    sql`
      SELECT id
      FROM position
      WHERE organization_id = ${ctx.organizationId}
        AND id = ${input.positionId}
        AND department_id = ${input.departmentId}
        AND status = 'active'
      LIMIT 1
    `,
  );

  if (!position) {
    throw new ConflictError(
      'Selected position does not belong to the selected active department.',
    );
  }

  if (input.teamId) {
    const team = await db.maybeOne<{ id: string }>(
      ctx,
      sql`
        SELECT id
        FROM team
        WHERE organization_id = ${ctx.organizationId}
          AND id = ${input.teamId}
          AND department_id = ${input.departmentId}
        LIMIT 1
      `,
    );

    if (!team) {
      throw new ConflictError(
        'Selected team does not belong to the selected department.',
      );
    }
  }

  if (input.designationId) {
    const designation = await db.maybeOne<{ id: string }>(
      ctx,
      sql`
        SELECT id
        FROM designation
        WHERE organization_id = ${ctx.organizationId}
          AND id = ${input.designationId}
        LIMIT 1
      `,
    );

    if (!designation) {
      throw new ConflictError(
        'Selected designation does not belong to the organization.',
      );
    }
  }

  if (input.reportsTo) {
    const manager = await db.maybeOne<{ id: string }>(
      ctx,
      sql`
        SELECT id
        FROM app_user
        WHERE organization_id = ${ctx.organizationId}
          AND id = ${input.reportsTo}
          AND account_type = 'employee'
          AND status = 'active'
        LIMIT 1
      `,
    );

    if (!manager) {
      throw new ConflictError('Reporting manager is invalid or inactive.');
    }
  }
}

export async function createEmployee(ctx: RequestContext, input: CreateEmployeeInput) {
  const employeeId = employeeIdOf(input.employeeId);
  const email = emailOf(input.email);

  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(employeeId)) {
    throw new ConflictError(
      'Employee ID may contain only letters, numbers, hyphens and underscores.',
    );
  }

  const duplicate = await db.maybeOne<{ id: string }>(
    ctx,
    sql`
      SELECT id
      FROM employee_profile
      WHERE organization_id = ${ctx.organizationId}
        AND employee_id = ${employeeId}
      LIMIT 1
    `,
  );

  if (duplicate) {
    throw new ConflictError('Employee ID already exists.', 'employee_id');
  }

  const duplicateEmail = await db.maybeOne<{ id: string }>(
    ctx,
    sql`
      SELECT id
      FROM app_user
      WHERE organization_id = ${ctx.organizationId}
        AND account_type = 'employee'
        AND email = ${email}
      LIMIT 1
    `,
  );

  if (duplicateEmail) {
    throw new ConflictError(
      'An employee account with this email already exists.',
      'email',
    );
  }

  await validateAssignments(ctx, input);

  const invitation = newInvitation();
  const userId = randomUUID();

  const user = await db.transaction(ctx, async (tx) => {
    const createdUser = await tx.one<{ id: string }>(
      sql`
          INSERT INTO app_user (
            id,
            organization_id,
            account_type,
            email,
            password_hash,
            status,
            session_version,
            email_verified_at,
            position_id,
            department_id,
            team_id,
            designation_id,
            specialization,
            reports_to,
            full_name
          )
          VALUES (
            ${userId},
            ${ctx.organizationId},
            'employee',
            ${email},
            NULL,
            'active',
            1,
            NULL,
            ${input.positionId},
            ${input.departmentId},
            ${input.teamId ?? null},
            ${input.designationId ?? null},
            ${input.specialization ?? null},
            ${input.reportsTo ?? null},
            ${input.fullName.trim()}
          )
          RETURNING id
        `,
    );

    await tx.one(
      sql`
          INSERT INTO employee_profile (
            organization_id,
            user_id,
            employee_id,
            contact,
            date_of_birth,
            gender,
            employment_type,
            joining_date,
            employment_status
          )
          VALUES (
            ${ctx.organizationId},
            ${createdUser.id},
            ${employeeId},
            ${input.contact ?? null},
            ${input.dateOfBirth ?? null},
            ${input.gender ?? null},
            ${input.employmentType},
            ${input.joiningDate},
            'active'
          )
          RETURNING id
        `,
    );

    await tx.one(
      sql`
          INSERT INTO employee_invitation (
            organization_id,
            user_id,
            token_hash,
            expires_at,
            created_by
          )
          VALUES (
            ${ctx.organizationId},
            ${createdUser.id},
            ${invitation.hash},
            NOW() + INTERVAL '72 hours',
            ${ctx.principal.id}
          )
          RETURNING id
        `,
    );

    return createdUser;
  });

  const organization = await platformDb.query<{ code: string }>(
    {
      operation: 'organization-lookup',
      reason: 'load the organization code for an employee invitation email',
      tables: ['organization'],
    },
    sql`
      SELECT code
      FROM organization
      WHERE id = ${ctx.organizationId}
      LIMIT 1
    `,
  );

  if (!organization[0]) {
    throw new NotFoundError('Organization');
  }

  await sendEmployeeInvitation(email, invitation.raw, organization[0].code);

  return {
    id: user.id,
    employeeId,
    email,
    invitationSent: true as const,
  };
}

/**
 * The scoped employee directory.
 *
 * AZ-2 — "List endpoints build their filter from the scope BEFORE querying. No
 * endpoint fetches broadly and rejects rows afterwards." The visibility
 * predicate goes into the WHERE clause, so a caller with `team` scope reads
 * their team's rows and the database never materialises anyone else's.
 *
 * The previous version read the whole tenant, ran a second query for the ids
 * the caller could see, and intersected the two in memory — which reads every
 * employee record on every call and makes pagination return short pages.
 *
 * AZ-4 — the count comes from the same predicate as the list, so it can never
 * reveal the existence of a row the caller cannot open.
 */
export async function listEmployees(
  ctx: RequestContext,
  options: { limit: number; page: number },
) {
  const filter = await visibilityFilter(ctx, 'users:view', 'user');
  const offset = (options.page - 1) * options.limit;

  const [rows, totals] = await Promise.all([
    db.query(
      ctx,
      sql`
      SELECT
        u.id,
        ep.employee_id AS "employeeId",
        u.full_name AS "fullName",
        u.email,
        ep.contact,
        ep.date_of_birth AS "dateOfBirth",
        ep.gender,
        ep.employment_type AS "employmentType",
        ep.joining_date AS "joiningDate",
        ep.employment_status AS "employmentStatus",
        u.position_id AS "positionId",
        p.code AS "positionCode",
        p.name AS "positionName",
        u.department_id AS "departmentId",
        d.code AS "departmentCode",
        d.name AS "departmentName",
        u.team_id AS "teamId",
        t.name AS "teamName",
        u.designation_id AS "designationId",
        des.name AS "designationName",
        u.reports_to AS "reportsTo",
        manager.full_name AS "managerName",
        (u.password_hash IS NOT NULL) AS "accountSetupComplete"
      FROM app_user u
      JOIN employee_profile ep
        ON ep.organization_id = u.organization_id
       AND ep.user_id = u.id
      LEFT JOIN position p
        ON p.id = u.position_id
      LEFT JOIN department d
        ON d.id = u.department_id
      LEFT JOIN team t
        ON t.id = u.team_id
      LEFT JOIN designation des
        ON des.id = u.designation_id
      LEFT JOIN app_user manager
        ON manager.organization_id = u.organization_id
       AND manager.id = u.reports_to
      WHERE u.organization_id = ${ctx.organizationId}
        AND u.account_type = 'employee'
        AND ${filter}
      ORDER BY ep.employee_id, u.full_name
      LIMIT ${options.limit} OFFSET ${offset}
    `,
    ),
    db.one<{ total: string }>(
      ctx,
      sql`
        SELECT count(*)::text AS total
        FROM app_user u
        JOIN employee_profile ep
          ON ep.organization_id = u.organization_id
         AND ep.user_id = u.id
        WHERE u.organization_id = ${ctx.organizationId}
          AND u.account_type = 'employee'
          AND ${filter}
      `,
    ),
  ]);

  return { items: rows, total: Number(totals.total), page: options.page, limit: options.limit };
}

export async function getEmployee(ctx: RequestContext, userId: string) {
  const row = await db.maybeOne(
    ctx,
    sql`
      SELECT
        u.id,
        ep.employee_id AS "employeeId",
        u.full_name AS "fullName",
        u.email,
        ep.contact,
        ep.date_of_birth AS "dateOfBirth",
        ep.gender,
        ep.employment_type AS "employmentType",
        ep.joining_date AS "joiningDate",
        ep.employment_status AS "employmentStatus",
        u.position_id AS "positionId",
        p.code AS "positionCode",
        p.name AS "positionName",
        u.department_id AS "departmentId",
        d.code AS "departmentCode",
        d.name AS "departmentName",
        u.team_id AS "teamId",
        t.name AS "teamName",
        u.designation_id AS "designationId",
        des.name AS "designationName",
        u.specialization,
        u.reports_to AS "reportsTo",
        manager.full_name AS "managerName",
        (u.password_hash IS NOT NULL) AS "accountSetupComplete"
      FROM app_user u
      JOIN employee_profile ep
        ON ep.organization_id = u.organization_id
       AND ep.user_id = u.id
      LEFT JOIN position p
        ON p.id = u.position_id
      LEFT JOIN department d
        ON d.id = u.department_id
      LEFT JOIN team t
        ON t.id = u.team_id
      LEFT JOIN designation des
        ON des.id = u.designation_id
      LEFT JOIN app_user manager
        ON manager.organization_id = u.organization_id
       AND manager.id = u.reports_to
      WHERE u.organization_id = ${ctx.organizationId}
        AND u.id = ${userId}
        AND u.account_type = 'employee'
      LIMIT 1
    `,
  );

  if (!row) {
    throw new NotFoundError('Employee');
  }

  return row;
}

export async function patchEmployee(
  ctx: RequestContext,
  userId: string,
  input: PatchEmployeeInput,
) {
  const current = (await getEmployee(ctx, userId)) as Record<string, unknown>;

  await validateAssignments(ctx, {
    departmentId: input.departmentId ?? String(current['departmentId']),

    positionId: input.positionId ?? String(current['positionId']),

    teamId:
      input.teamId !== undefined ? input.teamId : (current['teamId'] as string | null),

    designationId:
      input.designationId !== undefined
        ? input.designationId
        : (current['designationId'] as string | null),

    reportsTo:
      input.reportsTo !== undefined
        ? input.reportsTo
        : (current['reportsTo'] as string | null),
  });

  await db.transaction(ctx, async (tx) => {
    await tx.one(
      sql`
          UPDATE app_user
          SET
            full_name =
              COALESCE(
                ${input.fullName ?? null},
                full_name
              ),

            position_id =
              COALESCE(
                ${input.positionId ?? null},
                position_id
              ),

            department_id =
              COALESCE(
                ${input.departmentId ?? null},
                department_id
              ),

            team_id =
              ${input.teamId === undefined ? (current['teamId'] ?? null) : input.teamId},

            designation_id =
              ${
                input.designationId === undefined
                  ? (current['designationId'] ?? null)
                  : input.designationId
              },

            specialization =
              ${
                input.specialization === undefined
                  ? (current['specialization'] ?? null)
                  : input.specialization
              },

            reports_to =
              ${
                input.reportsTo === undefined
                  ? (current['reportsTo'] ?? null)
                  : input.reportsTo
              },

            session_version =
              CASE
                WHEN ${input.positionId !== undefined || input.departmentId !== undefined}
                THEN session_version + 1
                ELSE session_version
              END,

            updated_at = NOW()

          WHERE organization_id = ${ctx.organizationId}
            AND id = ${userId}
            AND account_type = 'employee'

          RETURNING id
        `,
    );

    await tx.one(
      sql`
          UPDATE employee_profile
          SET
            contact =
              ${
                input.contact === undefined ? (current['contact'] ?? null) : input.contact
              },

            date_of_birth =
              ${
                input.dateOfBirth === undefined
                  ? (current['dateOfBirth'] ?? null)
                  : input.dateOfBirth
              },

            gender =
              ${input.gender === undefined ? (current['gender'] ?? null) : input.gender},

            employment_type =
              COALESCE(
                ${input.employmentType ?? null},
                employment_type
              ),

            joining_date =
              COALESCE(
                ${input.joiningDate ?? null},
                joining_date
              ),

            updated_at = NOW()

          WHERE organization_id = ${ctx.organizationId}
            AND user_id = ${userId}

          RETURNING id
        `,
    );
  });

  return getEmployee(ctx, userId);
}

export async function changeEmploymentStatus(
  ctx: RequestContext,
  userId: string,
  status: 'active' | 'on-notice' | 'inactive' | 'terminated' | 'absconded',
) {
  await db.transaction(ctx, async (tx) => {
    const result = await tx.maybeOne<{ id: string }>(
      sql`
          UPDATE employee_profile
          SET
            employment_status = ${status},
            updated_at = NOW()
          WHERE organization_id = ${ctx.organizationId}
            AND user_id = ${userId}
          RETURNING user_id AS id
        `,
    );

    if (!result) {
      throw new NotFoundError('Employee');
    }

    if (status !== 'active') {
      await tx.one(
        sql`
            UPDATE app_user
            SET
              session_version = session_version + 1,
              updated_at = NOW()
            WHERE organization_id = ${ctx.organizationId}
              AND id = ${userId}
            RETURNING id
          `,
      );
    }
  });

  return getEmployee(ctx, userId);
}

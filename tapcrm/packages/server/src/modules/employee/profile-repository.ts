import type { SqlFragment } from '@tapcrm/authz';
import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { saveEmployeeQualifications, saveEmployeeSkills } from './repository.js';

/**
 * The employee's self-service profile: personal details, education,
 * experience and skills. Documents live in the verification module.
 */

export interface PersonalDetails {
  phone: string | null;
  dateOfBirth: DateOnly | null;
  gender: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  hasNoPriorExperience: boolean;
}

export type PersonalDetailFields = Omit<PersonalDetails, 'hasNoPriorExperience'>;

export interface QualificationRow {
  id: string;
  institution: string;
  degree: string;
  fieldOfStudy: string | null;
  passingYear: number | null;
  grade: string | null;
}

export interface ExperienceRow {
  id: string;
  companyName: string;
  jobTitle: string;
  startDate: DateOnly;
  endDate: DateOnly | null;
  description: string | null;
}

export interface SkillRow {
  id: string;
  skillName: string;
  proficiency: 'beginner' | 'intermediate' | 'advanced' | 'expert' | null;
}

const PERSONAL_COLUMNS = sql`
  phone, date_of_birth::text AS date_of_birth, gender,
  address_line1, address_line2, city, state, postal_code,
  emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
  has_no_prior_experience
`;

export async function findPersonalDetails(
  tx: Tx,
  organizationId: string,
  userId: string,
): Promise<PersonalDetails | null> {
  return tx.maybeOne<PersonalDetails>(sql`
    SELECT ${PERSONAL_COLUMNS}
    FROM employee_profile
    WHERE organization_id = ${organizationId} AND user_id = ${userId}
  `);
}

export async function listPersonalDetails(
  tx: Tx,
  organizationId: string,
  userIds: readonly string[],
): Promise<(PersonalDetails & { userId: string })[]> {
  if (userIds.length === 0) return [];
  return tx.query<PersonalDetails & { userId: string }>(sql`
    SELECT user_id, ${PERSONAL_COLUMNS}
    FROM employee_profile
    WHERE organization_id = ${organizationId} AND user_id = ANY(${[...userIds]}::uuid[])
  `);
}

/** Writes every personal column; the service has already merged in what was not sent. */
export async function savePersonalDetails(
  tx: Tx,
  organizationId: string,
  userId: string,
  details: PersonalDetailFields,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO employee_profile (
      organization_id, user_id, phone, date_of_birth, gender,
      address_line1, address_line2, city, state, postal_code,
      emergency_contact_name, emergency_contact_phone, emergency_contact_relation
    )
    VALUES (
      ${organizationId}, ${userId}, ${details.phone}, ${details.dateOfBirth}, ${details.gender},
      ${details.addressLine1}, ${details.addressLine2}, ${details.city}, ${details.state}, ${details.postalCode},
      ${details.emergencyContactName}, ${details.emergencyContactPhone}, ${details.emergencyContactRelation}
    )
    ON CONFLICT (organization_id, user_id) DO UPDATE SET
      phone = EXCLUDED.phone,
      date_of_birth = EXCLUDED.date_of_birth,
      gender = EXCLUDED.gender,
      address_line1 = EXCLUDED.address_line1,
      address_line2 = EXCLUDED.address_line2,
      city = EXCLUDED.city,
      state = EXCLUDED.state,
      postal_code = EXCLUDED.postal_code,
      emergency_contact_name = EXCLUDED.emergency_contact_name,
      emergency_contact_phone = EXCLUDED.emergency_contact_phone,
      emergency_contact_relation = EXCLUDED.emergency_contact_relation
  `);
}

export async function setNoPriorExperience(
  tx: Tx,
  organizationId: string,
  userId: string,
  value: boolean,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO employee_profile (organization_id, user_id, has_no_prior_experience)
    VALUES (${organizationId}, ${userId}, ${value})
    ON CONFLICT (organization_id, user_id) DO UPDATE SET
      has_no_prior_experience = EXCLUDED.has_no_prior_experience
  `);
}

export async function listQualifications(
  tx: Tx,
  organizationId: string,
  userId: string,
): Promise<QualificationRow[]> {
  return tx.query<QualificationRow>(sql`
    SELECT id, institution, degree, field_of_study, passing_year, grade
    FROM employee_qualification
    WHERE organization_id = ${organizationId} AND user_id = ${userId}
    ORDER BY passing_year DESC NULLS LAST, created_at, id
  `);
}

export async function replaceQualifications(
  tx: Tx,
  organizationId: string,
  userId: string,
  qualifications: Parameters<typeof saveEmployeeQualifications>[3],
): Promise<void> {
  await tx.query(sql`
    DELETE FROM employee_qualification
    WHERE organization_id = ${organizationId} AND user_id = ${userId}
  `);
  if (qualifications.length > 0) {
    await saveEmployeeQualifications(tx, organizationId, userId, qualifications);
  }
}

export async function listExperience(
  tx: Tx,
  organizationId: string,
  userId: string,
): Promise<ExperienceRow[]> {
  return tx.query<ExperienceRow>(sql`
    SELECT id, company_name, job_title, start_date::text AS start_date,
           end_date::text AS end_date, description
    FROM employee_experience
    WHERE organization_id = ${organizationId} AND user_id = ${userId}
    ORDER BY end_date DESC NULLS FIRST, start_date DESC, id
  `);
}

export async function replaceExperience(
  tx: Tx,
  organizationId: string,
  userId: string,
  entries: readonly {
    companyName: string;
    jobTitle: string;
    startDate: DateOnly;
    endDate: DateOnly | null;
    description: string | null;
  }[],
): Promise<void> {
  await tx.query(sql`
    DELETE FROM employee_experience
    WHERE organization_id = ${organizationId} AND user_id = ${userId}
  `);
  for (const entry of entries) {
    await tx.query(sql`
      INSERT INTO employee_experience (
        organization_id, user_id, company_name, job_title, start_date, end_date, description
      )
      VALUES (
        ${organizationId}, ${userId}, ${entry.companyName}, ${entry.jobTitle},
        ${entry.startDate}, ${entry.endDate}, ${entry.description}
      )
    `);
  }
}

export async function listSkills(tx: Tx, organizationId: string, userId: string): Promise<SkillRow[]> {
  return tx.query<SkillRow>(sql`
    SELECT id, skill_name, proficiency
    FROM employee_skill
    WHERE organization_id = ${organizationId} AND user_id = ${userId}
    ORDER BY created_at, id
  `);
}

export async function replaceSkills(
  tx: Tx,
  organizationId: string,
  userId: string,
  skills: Parameters<typeof saveEmployeeSkills>[3],
): Promise<void> {
  await tx.query(sql`
    DELETE FROM employee_skill
    WHERE organization_id = ${organizationId} AND user_id = ${userId}
  `);
  if (skills.length > 0) {
    await saveEmployeeSkills(tx, organizationId, userId, skills);
  }
}

/** How many education, experience and skill entries each person has. */
export async function countProfileEntries(
  tx: Tx,
  organizationId: string,
  userIds: readonly string[],
): Promise<Map<string, { qualifications: number; experience: number; skills: number }>> {
  const counts = new Map<string, { qualifications: number; experience: number; skills: number }>();
  if (userIds.length === 0) return counts;
  const rows = await tx.query<{ userId: string; qualifications: string; experience: string; skills: string }>(sql`
    SELECT u.id AS user_id,
           (SELECT count(*) FROM employee_qualification q
             WHERE q.organization_id = u.organization_id AND q.user_id = u.id)::text AS qualifications,
           (SELECT count(*) FROM employee_experience e
             WHERE e.organization_id = u.organization_id AND e.user_id = u.id)::text AS experience,
           (SELECT count(*) FROM employee_skill s
             WHERE s.organization_id = u.organization_id AND s.user_id = u.id)::text AS skills
    FROM app_user u
    WHERE u.organization_id = ${organizationId} AND u.id = ANY(${[...userIds]}::uuid[])
  `);
  for (const row of rows) {
    counts.set(row.userId, {
      qualifications: Number(row.qualifications),
      experience: Number(row.experience),
      skills: Number(row.skills),
    });
  }
  return counts;
}

/** Working employees the caller may see, for the HR completion overview. */
export async function listProfileSubjects(
  tx: Tx,
  organizationId: string,
  visibility: SqlFragment,
): Promise<{ id: string }[]> {
  return tx.query<{ id: string }>(sql`
    SELECT u.id
    FROM app_user u
    WHERE u.organization_id = ${organizationId}
      AND u.account_type = 'employee'
      AND u.status IN ('active', 'locked')
      AND ${visibility}
    ORDER BY u.full_name, u.id
  `);
}

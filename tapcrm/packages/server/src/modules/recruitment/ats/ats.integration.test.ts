import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@tapcrm/contracts';
import { createRequestContext, type RequestContext } from '../../../platform/dal/context.js';
import { db, platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { sql } from '../../../platform/dal/sql.js';
import { NotEligibleError, NotFoundError } from '../../../platform/http/error-handler.js';
import { listResumeSubmissions, updateResumeSubmissionStatus } from '../service.js';
import { MemoryStorageService, resetStorageService, setStorageService } from '../storage.js';
import {
  getCriteriaSettings,
  getSubmissionScanState,
  runSubmissionScan,
  saveCriteriaSettings,
} from './service.js';

/**
 * The ATS flow against REAL PostgreSQL through the runtime role: RLS, the
 * append-only report table, idempotent re-scans, staleness when criteria
 * change, and the lock that stops a scan landing after an HR decision.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=... DATABASE_URL=... \
 *   REDIS_URL=... JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=... \
 *   npx vitest run packages/server/src/modules/recruitment/ats
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const migrationUrl = process.env['MIGRATION_DATABASE_URL'] ?? '';

const RESUME = `Meera Nair
meera@example.com | +91 90000 11111

WORK EXPERIENCE
Senior Developer, Initech   Apr 2020 - Present
- Built React and TypeScript front ends backed by Node.js services on PostgreSQL.
- Ran Docker workloads on AWS and mentored four engineers.
Developer, Globex   Jun 2018 - Mar 2020
- Maintained REST APIs and wrote Jest unit tests.

EDUCATION
B.Tech in Computer Science, College of Engineering Pune, 2014 - 2018

SKILLS
React, TypeScript, Node.js, PostgreSQL, Docker, AWS, Git, Jest
`;

describe.skipIf(!enabled)('ATS screening (PostgreSQL)', () => {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const dept = randomUUID();
  const position = randomUUID();
  const hr = randomUUID();
  const requisition = randomUUID();
  const openSubmission = randomUUID();
  const closingSubmission = randomUUID();
  const storage = new MemoryStorageService();

  const asOwner = <T = unknown>(reason: string, fragment: ReturnType<typeof sql>) =>
    platformDb.query<T>('migration', reason, fragment);

  function ctxFor(organizationId: string, userId: string): RequestContext {
    const principal: Principal = {
      id: userId, organizationId, accountType: 'employee', sessionVersion: 1,
      positionId: position, departmentId: dept, teamId: null, reportsTo: null, organizationalLevel: 1,
    };
    return createRequestContext({ organizationId, principal, requestId: `ats-test-${userId}` });
  }
  const asHr = () => ctxFor(orgA, hr);

  beforeAll(async () => {
    const dbName = new URL(migrationUrl).pathname;
    if (!dbName.includes('test')) throw new Error(`Refusing to run against "${dbName}"`);
    setStorageService(storage);

    for (const [id, code] of [[orgA, 'ATSA'], [orgB, 'ATSB']] as const) {
      await asOwner('seed org', sql`INSERT INTO organization (id, code, name) VALUES (${id}, ${`${code}${id.slice(0, 6)}`}, ${code})`);
    }
    await asOwner('seed dept', sql`INSERT INTO department (id, organization_id, code, name, kind) VALUES (${dept}, ${orgA}, 'HR', 'People', 'support')`);
    await asOwner('seed position', sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level) VALUES (${position}, ${orgA}, ${dept}, 'HRX', 'HR', 20)`);
    await asOwner('seed user', sql`
      INSERT INTO app_user (id, organization_id, account_type, email, status, full_name, employee_id, department_id, position_id)
      VALUES (${hr}, ${orgA}, 'employee', ${`hr-${hr}@ats-test.invalid`}, 'active', 'Anita HR', 'ATS-1', ${dept}, ${position})`);
    await asOwner('seed requisition', sql`
      INSERT INTO job_requisition (id, organization_id, requisition_number, title, department_id, status, description, requirements, created_by)
      VALUES (${requisition}, ${orgA}, 'REQ-ATS-1', 'Frontend Engineer', ${dept}, 'open',
        'Build dashboards in React and TypeScript.',
        '4+ years of experience. Node.js and PostgreSQL. B.Tech in Computer Science. Kubernetes is a plus.', ${hr})`);
    for (const id of [openSubmission, closingSubmission]) {
      const key = `recruitment/resumes/${orgA}/${id}/cv.txt`;
      await storage.putObject(key, Buffer.from(RESUME), 'text/plain');
      await asOwner('seed submission', sql`
        INSERT INTO candidate_resume_submission
          (id, organization_id, requisition_id, first_name, last_name, email, resume_object_key, resume_filename, resume_mime_type, resume_file_size)
        VALUES (${id}, ${orgA}, ${requisition}, 'Meera', 'Nair', ${`${id}@ats-test.invalid`}, ${key}, 'cv.txt', 'text/plain', ${RESUME.length})`);
    }
  });

  afterAll(async () => {
    for (const table of [
      'recruitment_ats_scan', 'recruitment_ats_criteria', 'candidate_resume_submission', 'job_requisition',
      'identity_email_directory', 'app_user', 'position', 'department',
    ]) {
      await asOwner(`cleanup ${table}`, sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ANY(${[orgA, orgB]}::uuid[])`);
    }
    await asOwner('cleanup orgs', sql`DELETE FROM organization WHERE id = ANY(${[orgA, orgB]}::uuid[])`);
    resetStorageService();
    await closePools();
  });

  it('suggests criteria from the job post until HR saves its own', async () => {
    const settings = await getCriteriaSettings(asHr(), requisition);
    expect(settings.configured).toBe(false);
    expect(settings.updatedAt).toBeNull();
    expect(settings.criteria).toMatchObject({
      requiredSkills: ['React', 'TypeScript', 'Node.js', 'PostgreSQL'],
      preferredSkills: ['Kubernetes'],
      minimumExperienceYears: 4,
      requiredQualifications: ['B.Tech in Computer Science'],
    });
  });

  it('refuses to scan before the job has saved criteria', async () => {
    await expect(runSubmissionScan(asHr(), openSubmission)).rejects.toMatchObject({ code: 'ATS_CRITERIA_NOT_CONFIGURED' });
  });

  it('stores an immutable, explained report and returns the same report for an identical re-scan', async () => {
    const saved = await saveCriteriaSettings(asHr(), requisition, {
      requiredSkills: ['React', 'TypeScript', 'Node.js', 'PostgreSQL', 'GraphQL'],
      preferredSkills: ['Kubernetes'],
      minimumExperienceYears: 4,
      requiredQualifications: ['B.Tech in Computer Science'],
    });
    expect(saved.configured).toBe(true);

    const report = await runSubmissionScan(asHr(), openSubmission);
    expect(report).toMatchObject({ status: 'completed', stale: false, scannedBy: hr, scannedByName: 'Anita HR', criteriaHash: saved.criteriaHash });
    // 4 of 5 required skills (40/50) + experience (20/20) + degree (15/15) + no Kubernetes (0/15).
    expect(report.score).toBe(75);
    expect(report.checks.find((item) => item.criterion === 'GraphQL')?.outcome).toBe('not_found');
    expect(report.extractedExperienceYears).toBeGreaterThan(8);

    const again = await runSubmissionScan(asHr(), openSubmission);
    expect(again.id).toBe(report.id);
    const state = await getSubmissionScanState(asHr(), openSubmission);
    expect(state.scans).toHaveLength(1);
  });

  it('marks earlier reports stale when the job criteria change, and keeps them', async () => {
    await saveCriteriaSettings(asHr(), requisition, {
      requiredSkills: ['React', 'TypeScript'],
      preferredSkills: [],
      minimumExperienceYears: 4,
      requiredQualifications: [],
    });
    expect((await getSubmissionScanState(asHr(), openSubmission)).scans.map((scan) => scan.stale)).toEqual([true]);

    const fresh = await runSubmissionScan(asHr(), openSubmission);
    expect(fresh.score).toBe(100);
    const state = await getSubmissionScanState(asHr(), openSubmission);
    expect(state.scans.map((scan) => [scan.id === fresh.id, scan.stale])).toEqual([[true, false], [false, true]]);
  });

  it('shows the latest result on the inbox list', async () => {
    const rows = await listResumeSubmissions(asHr(), { requisitionId: requisition });
    const open = rows.find((row) => row.id === openSubmission);
    expect(open?.ats).toMatchObject({ status: 'completed', score: 100, missingRequired: 0, stale: false });
    expect(rows.find((row) => row.id === closingSubmission)?.ats).toBeNull();
  });

  it('never changes the application status, and stops scanning once HR has decided', async () => {
    await runSubmissionScan(asHr(), closingSubmission);
    const [before] = await asOwner<{ status: string }>('read', sql`SELECT status FROM candidate_resume_submission WHERE id = ${closingSubmission}`);
    expect(before?.status).toBe('submitted');

    await updateResumeSubmissionStatus(asHr(), closingSubmission, { status: 'rejected', rejectionReason: 'Not enough backend depth' });
    await expect(runSubmissionScan(asHr(), closingSubmission)).rejects.toBeInstanceOf(NotEligibleError);
    expect((await getSubmissionScanState(asHr(), closingSubmission)).scans).toHaveLength(1);
  });

  it('lets the application role append reports but never rewrite them', async () => {
    await expect(db.query(asHr(), sql`UPDATE recruitment_ats_scan SET engine_version = 'tampered' WHERE organization_id = ${orgA}`))
      .rejects.toThrow(/permission denied/);
    await expect(db.query(asHr(), sql`DELETE FROM recruitment_ats_scan WHERE organization_id = ${orgA}`))
      .rejects.toThrow(/permission denied/);
  });

  it('keeps reports inside their organisation', async () => {
    const outsider = ctxFor(orgB, randomUUID());
    await expect(getSubmissionScanState(outsider, openSubmission)).rejects.toBeInstanceOf(NotFoundError);
    const visible = await db.query<{ n: string }>(outsider, sql`SELECT count(*)::text AS n FROM recruitment_ats_scan`);
    expect(visible[0]?.n).toBe('0');
  });
});

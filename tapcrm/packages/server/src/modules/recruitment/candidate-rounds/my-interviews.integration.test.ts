import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@tapcrm/contracts';
import { createRequestContext, type RequestContext } from '../../../platform/dal/context.js';
import { platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { sql } from '../../../platform/dal/sql.js';
import {
  getInterviewResumeFile,
  getPanelInterviewResumeFile,
  listMyInterviews,
  loadCandidateRoundResource,
  loadPanelInterviewResource,
  saveMyInterviewFeedback,
  scheduleInterview,
} from '../service.js';

/**
 * "My Interviews" against REAL PostgreSQL through the runtime role: an
 * interviewer from any department sees the pipeline rounds HR assigned to them
 * and the scheduled interviews that name them on the panel — with the
 * candidate and job each is for — and nobody else's.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=... DATABASE_URL=... \
 *   npx vitest run packages/server/src/modules/recruitment/candidate-rounds
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const migrationUrl = process.env['MIGRATION_DATABASE_URL'] ?? '';

describe.skipIf(!enabled)('My Interviews (PostgreSQL)', () => {
  const org = randomUUID();
  const hrDept = randomUUID();
  const devDept = randomUUID();
  const hrPosition = randomUUID();
  const managerPosition = randomUUID();
  const hr = randomUUID();
  const manager = randomUUID();
  const otherManager = randomUUID();
  const requisition = randomUUID();
  const candidate = randomUUID();
  const removedCandidate = randomUUID();
  const technical = randomUUID();
  const final = randomUUID();
  const assigned = randomUUID();
  const someoneElses = randomUUID();
  const onRemovedCandidate = randomUUID();
  // Scheduled interviews and their panels.
  const panelInterview = randomUUID();
  const calledOff = randomUUID();
  const othersInterview = randomUUID();
  const onRemovedInterview = randomUUID();

  const asOwner = <T = unknown>(reason: string, fragment: ReturnType<typeof sql>) =>
    platformDb.query<T>('migration', reason, fragment);

  function ctxFor(userId: string, positionId: string, departmentId: string): RequestContext {
    const principal: Principal = {
      id: userId, organizationId: org, accountType: 'employee', sessionVersion: 1,
      positionId, departmentId, teamId: null, reportsTo: null, organizationalLevel: 65,
    };
    return createRequestContext({ organizationId: org, principal, requestId: `my-interviews-${userId}` });
  }
  const asManager = () => ctxFor(manager, managerPosition, devDept);
  const asOtherManager = () => ctxFor(otherManager, managerPosition, devDept);
  const asHr = () => ctxFor(hr, hrPosition, hrDept);

  beforeAll(async () => {
    const dbName = new URL(migrationUrl).pathname;
    if (!dbName.includes('test')) throw new Error(`Refusing to run against "${dbName}"`);
    await asOwner('seed org', sql`INSERT INTO organization (id, code, name) VALUES (${org}, ${`MYI${org.slice(0, 6)}`}, 'Interviews Co')`);
    await asOwner('seed departments', sql`
      INSERT INTO department (id, organization_id, code, name, kind)
      VALUES (${hrDept}, ${org}, 'HR', 'People', 'support'), (${devDept}, ${org}, 'DEV', 'Development', 'delivery')`);
    await asOwner('seed positions', sql`
      INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
      VALUES (${hrPosition}, ${org}, ${hrDept}, 'HRX', 'HR', 90), (${managerPosition}, ${org}, ${devDept}, 'DTM', 'Developer Team Manager', 65)`);
    await asOwner('seed users', sql`
      INSERT INTO app_user (id, organization_id, account_type, email, status, full_name, employee_id, department_id, position_id)
      VALUES
        (${hr}, ${org}, 'employee', ${`hr-${hr}@my-interviews.invalid`}, 'active', 'Anita HR', 'MYI-1', ${hrDept}, ${hrPosition}),
        (${manager}, ${org}, 'employee', ${`vikram-${manager}@my-interviews.invalid`}, 'active', 'Vikram Rao', 'MYI-2', ${devDept}, ${managerPosition}),
        (${otherManager}, ${org}, 'employee', ${`meera-${otherManager}@my-interviews.invalid`}, 'active', 'Meera Iyer', 'MYI-3', ${devDept}, ${managerPosition})`);
    await asOwner('seed requisition', sql`
      INSERT INTO job_requisition (id, organization_id, requisition_number, title, department_id, status, created_by)
      VALUES (${requisition}, ${org}, 'REQ-MYI-1', 'Backend Developer', ${devDept}, 'open', ${hr})`);
    await asOwner('seed candidates', sql`
      INSERT INTO candidate (id, organization_id, requisition_id, first_name, last_name, email, resume_object_key, created_by, deleted_at)
      VALUES
        (${candidate}, ${org}, ${requisition}, 'Priya', 'Raman', 'priya@example.com', ${`recruitment/resumes/${org}/x/cv.pdf`}, ${hr}, NULL),
        (${removedCandidate}, ${org}, ${requisition}, 'Old', 'Applicant', 'old@example.com', NULL, ${hr}, now())`);
    await asOwner('seed pipeline', sql`
      INSERT INTO recruitment_pipeline_round (id, organization_id, requisition_id, name, order_index, interviewer_note)
      VALUES (${technical}, ${org}, ${requisition}, 'Technical Round', 1, 'Probe API design and SQL.'),
             (${final}, ${org}, ${requisition}, 'Final Round', 2, NULL)`);
    await asOwner('seed rounds', sql`
      INSERT INTO recruitment_candidate_round (id, organization_id, candidate_id, pipeline_round_id, assigned_to, status, scheduled_at)
      VALUES
        (${assigned}, ${org}, ${candidate}, ${technical}, ${manager}, 'scheduled', now() + interval '1 day'),
        (${someoneElses}, ${org}, ${candidate}, ${final}, ${otherManager}, 'scheduled', now() + interval '2 days'),
        (${onRemovedCandidate}, ${org}, ${removedCandidate}, ${technical}, ${manager}, 'scheduled', now())`);
    await asOwner('seed interviews', sql`
      INSERT INTO interview (id, organization_id, candidate_id, requisition_id, stage, round, interview_type, scheduled_at, duration_minutes, location_or_link, status, notes, created_by)
      VALUES
        (${panelInterview}, ${org}, ${candidate}, ${requisition}, 'technical', 1, 'video', now() + interval '3 days', 60, 'https://meet.example.com/abc', 'scheduled', 'Bring the take-home task.', ${hr}),
        (${calledOff}, ${org}, ${candidate}, ${requisition}, 'managerial', 2, 'in_person', now() + interval '4 days', 45, 'Room 4', 'cancelled', NULL, ${hr}),
        (${othersInterview}, ${org}, ${candidate}, ${requisition}, 'final', 3, 'phone', now() + interval '5 days', 30, NULL, 'scheduled', NULL, ${hr}),
        (${onRemovedInterview}, ${org}, ${removedCandidate}, ${requisition}, 'technical', 1, 'video', now(), 60, NULL, 'scheduled', NULL, ${hr})`);
    await asOwner('seed panels', sql`
      INSERT INTO interview_interviewer (organization_id, interview_id, user_id, assigned_by)
      VALUES
        (${org}, ${panelInterview}, ${manager}, ${hr}),
        (${org}, ${panelInterview}, ${otherManager}, ${hr}),
        (${org}, ${calledOff}, ${manager}, ${hr}),
        (${org}, ${othersInterview}, ${otherManager}, ${hr}),
        (${org}, ${onRemovedInterview}, ${manager}, ${hr})`);
  });

  afterAll(async () => {
    for (const table of [
      'notification_outbox', 'interview_feedback', 'interview_interviewer', 'interview',
      'recruitment_candidate_round', 'recruitment_pipeline_round', 'candidate', 'job_requisition',
      'identity_email_directory', 'app_user', 'position', 'department',
    ]) {
      await asOwner(`cleanup ${table}`, sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ${org}`);
    }
    await asOwner('cleanup org', sql`DELETE FROM organization WHERE id = ${org}`);
    await closePools();
  });

  it('lists the rounds assigned to the interviewer, with the candidate, job and brief', async () => {
    const { rounds } = await listMyInterviews(asManager());
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({
      id: assigned,
      candidateName: 'Priya Raman',
      requisitionTitle: 'Backend Developer',
      requisitionNumber: 'REQ-MYI-1',
      pipelineRoundName: 'Technical Round',
      interviewerBrief: 'Probe API design and SQL.',
      hasResume: true,
      status: 'scheduled',
    });
  });

  it('lists the scheduled interviews that name them on the panel, but none called off', async () => {
    const { interviews } = await listMyInterviews(asManager());
    expect(interviews.map((row) => row.id)).toEqual([panelInterview]);
    expect(interviews[0]).toMatchObject({
      candidateId: candidate,
      candidateName: 'Priya Raman',
      requisitionTitle: 'Backend Developer',
      requisitionNumber: 'REQ-MYI-1',
      stage: 'technical',
      round: 1,
      interviewType: 'video',
      durationMinutes: 60,
      locationOrLink: 'https://meet.example.com/abc',
      status: 'scheduled',
      notes: 'Bring the take-home task.',
      panel: ['Meera Iyer', 'Vikram Rao'],
      hasResume: true,
      myFeedback: null,
    });
  });

  it('shows nothing to someone with no interviews, and never another interviewer’s', async () => {
    expect(await listMyInterviews(asHr())).toEqual({ rounds: [], interviews: [] });
    const theirs = await listMyInterviews(asOtherManager());
    expect(theirs.rounds.map((row) => row.id)).toEqual([someoneElses]);
    expect(theirs.interviews.map((row) => row.id)).toEqual([panelInterview, othersInterview]);
  });

  it('authorizes a round as its candidate, naming the round’s interviewer', async () => {
    const resource = await loadCandidateRoundResource(asManager(), assigned);
    expect(resource).toMatchObject({ type: 'candidate', id: candidate, organizationId: org, createdBy: hr, interviewerIds: [manager] });
    // A removed candidate's round is not found at all.
    expect(await loadCandidateRoundResource(asManager(), onRemovedCandidate)).toBeNull();
  });

  it('authorizes a scheduled interview as its candidate, naming the whole panel', async () => {
    const resource = await loadPanelInterviewResource(asManager(), panelInterview);
    expect(resource).toMatchObject({ type: 'candidate', id: candidate, organizationId: org, createdBy: hr });
    expect(resource?.['interviewerIds']).toEqual(expect.arrayContaining([manager, otherManager]));
    expect(resource?.['interviewerIds']).toHaveLength(2);
    expect(await loadPanelInterviewResource(asManager(), onRemovedInterview)).toBeNull();
  });

  it('opens a resume only for the caller’s own round or panel', async () => {
    // Nothing is in storage here, so a member gets "no resume"; anyone else, "no such interview".
    await expect(getInterviewResumeFile(asManager(), assigned)).rejects.toThrow('Candidate resume not found');
    await expect(getInterviewResumeFile(asManager(), someoneElses)).rejects.toThrow('Candidate round not found');
    await expect(getPanelInterviewResumeFile(asManager(), panelInterview)).rejects.toThrow('Candidate resume not found');
    await expect(getPanelInterviewResumeFile(asManager(), othersInterview)).rejects.toThrow('Interview not found');
    await expect(getPanelInterviewResumeFile(asHr(), panelInterview)).rejects.toThrow('Interview not found');
  });

  it('saves a panel member’s own feedback, then lets them change it', async () => {
    const first = await saveMyInterviewFeedback(asManager(), panelInterview, {
      recommendation: 'hire', rating: 4, feedback: 'Clear on indexing; good API instincts.', strengths: 'SQL', areasForImprovement: null,
    });
    expect(first).toMatchObject({ interviewId: panelInterview, interviewerId: manager, recommendation: 'hire', rating: 4 });

    const afterFirst = await listMyInterviews(asManager());
    expect(afterFirst.interviews[0]).toMatchObject({
      status: 'completed', // the first feedback completes a scheduled interview, as HR's does
      myFeedback: { id: first.id, recommendation: 'hire', rating: 4, feedback: 'Clear on indexing; good API instincts.', strengths: 'SQL' },
    });
    // The other panel member sees the interview, but not this feedback as theirs.
    expect((await listMyInterviews(asOtherManager())).interviews.find((row) => row.id === panelInterview)?.myFeedback).toBeNull();

    const changed = await saveMyInterviewFeedback(asManager(), panelInterview, {
      recommendation: 'strong_hire', rating: 5, feedback: 'Second look: excellent.', strengths: null, areasForImprovement: 'Testing',
    });
    expect(changed.id).toBe(first.id);
    expect((await listMyInterviews(asManager())).interviews[0]?.myFeedback).toMatchObject({
      recommendation: 'strong_hire', rating: 5, feedback: 'Second look: excellent.', strengths: null, areasForImprovement: 'Testing',
    });
    const stored = await asOwner<{ n: number }>('count feedback', sql`
      SELECT count(*)::int AS n FROM interview_feedback WHERE organization_id = ${org} AND interview_id = ${panelInterview}`);
    expect(stored[0]?.n).toBe(1);
  });

  it('takes no feedback from someone off the panel, or on an interview called off', async () => {
    const input = { recommendation: 'no_hire' as const, rating: 2, feedback: 'Not mine to judge.' };
    await expect(saveMyInterviewFeedback(asHr(), panelInterview, input)).rejects.toThrow('Interview not found');
    await expect(saveMyInterviewFeedback(asManager(), othersInterview, input)).rejects.toThrow('Interview not found');
    await expect(saveMyInterviewFeedback(asManager(), calledOff, input)).rejects.toThrow('called off');
  });

  it('tells the panel when HR schedules an interview, linking to My Interviews', async () => {
    const created = await scheduleInterview(asHr(), {
      candidateId: candidate,
      requisitionId: requisition,
      stage: 'hr',
      round: 4,
      interviewType: 'video',
      scheduledAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
      durationMinutes: 30,
      locationOrLink: null,
      interviewerIds: [manager, hr],
      notes: null,
    });
    const outbox = await asOwner<{ payload: { title: string; body: string; link: string; audience: { users: string[] }; metadata: Record<string, unknown> } }>(
      'read outbox',
      sql`SELECT payload FROM notification_outbox WHERE organization_id = ${org} AND payload->'metadata'->>'interviewId' = ${created.id}`,
    );
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.payload).toMatchObject({
      title: 'You are on an interview panel',
      body: 'Priya Raman · Backend Developer — HR round 4',
      link: '/company/my-interviews',
      // Whoever scheduled it is not told about their own interview.
      audience: { users: [manager] },
    });
    expect((await listMyInterviews(asManager())).interviews.map((row) => row.id)).toContain(created.id);
  });
});

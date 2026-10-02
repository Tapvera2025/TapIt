import { describe, expect, it } from 'vitest';
import { viewerRooms, subjectRooms, type PeopleChannel, type Subject } from '../../platform/realtime/rooms.js';
import { userStatusPolicy } from './policy.js';

/**
 * The scope-agreement invariant: HTTP board filter and socket room routing
 * for `attendance:view-live` reach the same subjects, for every scope
 * (design §9.4 "Check" — plan Task 9).
 *
 * A full integration test would spin up sockets and hit the HTTP route.
 * The invariant we care about is smaller: the AXES the two paths filter
 * on must match. This test verifies that by parsing what `viewerRooms`
 * emits (room-name suffix) and what `userStatusPolicy.filter` emits (SQL
 * predicate on `u.department_id` / `u.team_id` / `u.id`). Same axis =
 * same subject set on any fixture.
 *
 * A team lead's socket lands in `t:<team>` rooms; their HTTP board
 * filters `u.team_id = ANY(<their teams>)`. Both are keyed on
 * `app_user.team_id`, the current placement. If we ever changed one to
 * read the record's snapshot instead, this test would fail because the
 * axes would drift.
 */

const CHANNEL: PeopleChannel = { name: 'status', action: 'attendance:view-live' };
const ORG = 'org-1';

async function filterFor(scope: 'own' | 'team' | 'department' | 'pool' | 'all-people') {
  // Minimal ctx stub for the policy filter — the filter only reaches into
  // `ctx.scope` and `ctx.principal`, and returns a { sql, parameters }
  // fragment we can inspect.
  const ctx = {
    organizationId: ORG,
    principal: { id: 'lead-1' },
    scope: {
      departmentId: async () => 'dept-a',
      teamIds: async () => new Set(['team-a']),
      poolIds: async () => new Set(['team-b']),
    },
  } as unknown as Parameters<typeof userStatusPolicy.filter>[0];
  return userStatusPolicy.filter(ctx, 'attendance:view-live', scope);
}

describe('scope agreement — HTTP filter and socket rooms use the same axes', () => {
  it('all-people: HTTP filter is TRUE; viewerRooms is [`all`]', async () => {
    const f = await filterFor('all-people');
    expect(f.sql).toBe('TRUE');
    const rooms = viewerRooms(CHANNEL, {
      organizationId: ORG,
      userId: 'lead-1',
      everyone: false,
      scope: 'all-people',
      departmentId: 'dept-a',
      teamIds: [],
      poolIds: [],
    });
    expect(rooms).toEqual([`o:${ORG}:status:all`]);
  });

  it('own: HTTP filter targets u.id; viewerRooms is [`u:<caller>`]', async () => {
    const f = await filterFor('own');
    expect(f.sql).toBe('u.id = $1');
    expect(f.parameters).toEqual(['lead-1']);
    const rooms = viewerRooms(CHANNEL, {
      organizationId: ORG,
      userId: 'lead-1',
      everyone: false,
      scope: 'own',
      departmentId: null,
      teamIds: [],
      poolIds: [],
    });
    expect(rooms).toEqual([`o:${ORG}:status:u:lead-1`]);
  });

  it('department: HTTP filter targets u.department_id; viewerRooms is [`d:<dept>`]', async () => {
    const f = await filterFor('department');
    expect(f.sql).toBe('u.department_id = $1');
    expect(f.parameters).toEqual(['dept-a']);
    const rooms = viewerRooms(CHANNEL, {
      organizationId: ORG,
      userId: 'lead-1',
      everyone: false,
      scope: 'department',
      departmentId: 'dept-a',
      teamIds: [],
      poolIds: [],
    });
    expect(rooms).toEqual([`o:${ORG}:status:d:dept-a`]);
  });

  it('team: HTTP filter targets u.team_id ANY; viewerRooms is [`t:<team>`, ...]', async () => {
    const f = await filterFor('team');
    expect(f.sql).toBe('u.team_id = ANY($1::uuid[])');
    expect(f.parameters).toEqual([['team-a']]);
    const rooms = viewerRooms(CHANNEL, {
      organizationId: ORG,
      userId: 'lead-1',
      everyone: false,
      scope: 'team',
      departmentId: 'dept-a',
      teamIds: ['team-a'],
      poolIds: [],
    });
    expect(rooms).toEqual([`o:${ORG}:status:t:team-a`]);
  });

  it('pool: HTTP filter targets u.team_id ANY; viewerRooms is [`t:<pool-team>`, ...]', async () => {
    const f = await filterFor('pool');
    expect(f.sql).toBe('u.team_id = ANY($1::uuid[])');
    expect(f.parameters).toEqual([['team-b']]);
    const rooms = viewerRooms(CHANNEL, {
      organizationId: ORG,
      userId: 'lead-1',
      everyone: false,
      scope: 'pool',
      departmentId: null,
      teamIds: [],
      poolIds: ['team-b'],
    });
    expect(rooms).toEqual([`o:${ORG}:status:t:team-b`]);
  });

  it('subject routing keys are the same shapes the filter targets', () => {
    const subject: Subject = { userId: 'emp-1', departmentId: 'dept-a', teamId: 'team-a' };
    const rooms = subjectRooms(ORG, CHANNEL, subject);
    // A subject in dept-a on team-a shows up in the 'all', personal,
    // team-a, and dept-a rooms. Every viewer whose scope includes any
    // of those rooms sees the emit — matching what the HTTP filter's
    // per-axis clause captures.
    expect(rooms).toContain(`o:${ORG}:status:all`);
    expect(rooms).toContain(`o:${ORG}:status:u:emp-1`);
    expect(rooms).toContain(`o:${ORG}:status:t:team-a`);
    expect(rooms).toContain(`o:${ORG}:status:d:dept-a`);
  });
});

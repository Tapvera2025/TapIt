import { describe, expect, it } from 'vitest';
import { subjectRooms, viewerRooms, type PeopleChannel, type ViewerReach } from './rooms.js';

const ORG = 'org-1';
const status: PeopleChannel = { name: 'status', action: 'attendance:view-live' };
const viewer = (reach: Partial<ViewerReach>): ViewerReach => ({
  organizationId: ORG,
  userId: 'lead',
  everyone: false,
  scope: null,
  departmentId: 'ops',
  teamIds: ['night', 'night-a'],
  poolIds: ['night'],
  ...reach,
});
const alice = { userId: 'alice', teamId: 'night-a', departmentId: 'ops' };
const bob = { userId: 'bob', teamId: 'day', departmentId: 'sales' };

/** Does a viewer hear about a subject? The same test Socket.IO applies. */
const hears = (reach: ViewerReach, subject: typeof alice) =>
  viewerRooms(status, reach).some((room) => subjectRooms(ORG, status, subject).includes(room));

describe('RT-2 — a viewer hears only about the people their scope covers', () => {
  it('team scope reaches the viewer’s teams and the teams below, not others', () => {
    const lead = viewer({ scope: 'team' });
    expect(hears(lead, alice)).toBe(true);
    expect(hears(lead, bob)).toBe(false);
  });

  it('department scope reaches the viewer’s department only', () => {
    const head = viewer({ scope: 'department' });
    expect(hears(head, alice)).toBe(true);
    expect(hears(head, bob)).toBe(false);
  });

  it('own scope reaches the viewer alone', () => {
    const self = viewer({ scope: 'own', userId: 'alice' });
    expect(hears(self, alice)).toBe(true);
    expect(hears(self, bob)).toBe(false);
  });

  it('all-people and Super Admin reach everyone in the organization', () => {
    expect(hears(viewer({ scope: 'all-people' }), bob)).toBe(true);
    expect(hears(viewer({ everyone: true }), bob)).toBe(true);
  });

  it('no policy, or participant scope, joins no channel room', () => {
    expect(viewerRooms(status, viewer({ scope: null }))).toEqual([]);
    expect(viewerRooms(status, viewer({ scope: 'participant' }))).toEqual([]);
  });

  it('every room names the organization, so nothing crosses tenants', () => {
    for (const room of [...viewerRooms(status, viewer({ scope: 'team' })), ...subjectRooms(ORG, status, alice)]) {
      expect(room.startsWith(`o:${ORG}:`)).toBe(true);
    }
  });
});

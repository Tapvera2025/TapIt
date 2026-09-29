import type { Action, Scope } from '@tapcrm/contracts';

/**
 * Socket rooms — RT-2, attendance design §5.5.
 *
 * Every room name starts with the organization, so no emit can cross tenants.
 * A socket joins its person's room, plus — for each people channel — the rooms
 * its scope for the channel's action covers. The people scope rules are the
 * ones `userPolicy` applies to people records (modules/employee/policy.ts):
 *
 *   all-people   the whole organization
 *   department   the viewer's department
 *   team, pool   those teams (team: the viewer's team and every team below it)
 *   own          the viewer alone
 *
 * An event about a person goes to that person's room, their team's, their
 * department's and the organization's; Socket.IO sends it once to each socket
 * in any of them. A viewer therefore receives exactly the people their scope
 * covers, and a principal never joins a room it cannot read.
 */

export interface PeopleChannel {
  /** Short and stable: `status` gives rooms like `o:<org>:status:t:<team>`. */
  readonly name: string;
  /** The action whose scope decides who hears about whom. */
  readonly action: Action;
}

export interface Subject {
  readonly userId: string;
  readonly teamId: string | null;
  readonly departmentId: string | null;
}

export const personalRoom = (organizationId: string, userId: string): string =>
  `o:${organizationId}:u:${userId}`;

const channelRoom = (organizationId: string, channel: string, part: string): string =>
  `o:${organizationId}:${channel}:${part}`;

/** What a viewer's scope reaches, already resolved. */
export interface ViewerReach {
  readonly organizationId: string;
  readonly userId: string;
  /** Super Admin (globalAccess) — the whole organization. */
  readonly everyone: boolean;
  /** Null when no policy grants the channel's action. */
  readonly scope: Scope | null;
  readonly departmentId: string | null;
  readonly teamIds: readonly string[];
  readonly poolIds: readonly string[];
}

export function viewerRooms(channel: PeopleChannel, viewer: ViewerReach): string[] {
  const room = (part: string) => channelRoom(viewer.organizationId, channel.name, part);
  if (viewer.everyone) return [room('all')];
  switch (viewer.scope) {
    case 'all-people':
      return [room('all')];
    case 'department':
      return viewer.departmentId === null ? [] : [room(`d:${viewer.departmentId}`)];
    case 'team':
      return viewer.teamIds.map((id) => room(`t:${id}`));
    case 'pool':
      return viewer.poolIds.map((id) => room(`t:${id}`));
    case 'own':
      return [room(`u:${viewer.userId}`)];
    default:
      // No policy, or `participant`, which names parties to a record and has
      // no meaning for a person: no rooms.
      return [];
  }
}

export function subjectRooms(organizationId: string, channel: PeopleChannel, subject: Subject): string[] {
  const room = (part: string) => channelRoom(organizationId, channel.name, part);
  return [
    room('all'),
    room(`u:${subject.userId}`),
    ...(subject.teamId === null ? [] : [room(`t:${subject.teamId}`)]),
    ...(subject.departmentId === null ? [] : [room(`d:${subject.departmentId}`)]),
  ];
}

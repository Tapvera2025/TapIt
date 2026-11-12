import { z } from 'zod';
import { route } from '../../platform/http/route.js';
import { calendarConnectionStatus, completeCalendarConnect, disconnectCalendar, startCalendarConnect } from './google/connect.js';
import { loadMeetingResource } from './policy.js';
import {
  acceptMeeting,
  cancelMeeting,
  completeMeeting,
  declineMeeting,
  joinMeeting,
  listAllMeetings,
  listMeetableClients,
  listMeetingPeople,
  listMyMeetings,
  portalCancelMeeting,
  portalChooseProposal,
  portalHosts,
  portalListMeetings,
  portalRequestMeeting,
  portalSlots,
  proposeTimes,
  scheduleMeeting,
  setMeetingLink,
  staffAvailability,
} from './service.js';
import {
  acceptMeetingSchema,
  availabilityQuerySchema,
  calendarCompleteSchema,
  completeMeetingSchema,
  meetingLinkSchema,
  meetingListQuerySchema,
  optionalReasonSchema,
  portalChooseSchema,
  portalRequestSchema,
  portalSlotsQuerySchema,
  proposeTimesSchema,
  reasonSchema,
  scheduleMeetingSchema,
} from './validators.js';

const MODULE = 'meetings';
const id = (value: string | undefined) => z.string().uuid().parse(value);

export function registerMeetingRoutes(): void {
  // Staff. `meetings:host` reaches a meeting through its host: your own, or
  // your people's when your scope is wider (meeting policy).
  route({ method: 'GET', path: '/api/meetings', action: 'meetings:view', module: MODULE,
    handler: async ({ ctx, query }) => ({ items: await listAllMeetings(ctx, meetingListQuerySchema.parse(query)) }) });
  route({ method: 'GET', path: '/api/meetings/mine', action: 'meetings:host', module: MODULE,
    handler: async ({ ctx, query }) => ({ items: await listMyMeetings(ctx, meetingListQuerySchema.parse(query)) }) });
  route({ method: 'GET', path: '/api/meetings/people', action: 'meetings:host', module: MODULE,
    handler: async ({ ctx }) => ({ items: await listMeetingPeople(ctx) }) });
  route({ method: 'GET', path: '/api/meetings/clients', action: 'meetings:host', module: MODULE,
    handler: async ({ ctx }) => ({ items: await listMeetableClients(ctx) }) });
  route({ method: 'GET', path: '/api/meetings/availability', action: 'meetings:host', module: MODULE,
    handler: async ({ ctx, query }) => staffAvailability(ctx, availabilityQuerySchema.parse(query)) });
  route({ method: 'POST', path: '/api/meetings', action: 'meetings:host', module: MODULE,
    handler: async ({ ctx, body }) => scheduleMeeting(ctx, scheduleMeetingSchema.parse(body)) });
  route({ method: 'POST', path: '/api/meetings/:id/accept', action: 'meetings:host', module: MODULE, resourceParam: 'id', loadResource: loadMeetingResource, status: 200,
    handler: async ({ ctx, params, body }) => acceptMeeting(ctx, id(params['id']), acceptMeetingSchema.parse(body ?? {})) });
  route({ method: 'POST', path: '/api/meetings/:id/propose', action: 'meetings:host', module: MODULE, resourceParam: 'id', loadResource: loadMeetingResource, status: 200,
    handler: async ({ ctx, params, body }) => proposeTimes(ctx, id(params['id']), proposeTimesSchema.parse(body)) });
  route({ method: 'POST', path: '/api/meetings/:id/decline', action: 'meetings:host', module: MODULE, resourceParam: 'id', loadResource: loadMeetingResource, status: 200,
    handler: async ({ ctx, params, body }) => declineMeeting(ctx, id(params['id']), reasonSchema.parse(body)) });
  route({ method: 'POST', path: '/api/meetings/:id/cancel', action: 'meetings:host', module: MODULE, resourceParam: 'id', loadResource: loadMeetingResource, status: 200,
    handler: async ({ ctx, params, body }) => cancelMeeting(ctx, id(params['id']), reasonSchema.parse(body)) });
  route({ method: 'POST', path: '/api/meetings/:id/outcome', action: 'meetings:host', module: MODULE, resourceParam: 'id', loadResource: loadMeetingResource, status: 200,
    handler: async ({ ctx, params, body }) => completeMeeting(ctx, id(params['id']), completeMeetingSchema.parse(body)) });
  route({ method: 'PATCH', path: '/api/meetings/:id/link', action: 'meetings:host', module: MODULE, resourceParam: 'id', loadResource: loadMeetingResource,
    handler: async ({ ctx, params, body }) => setMeetingLink(ctx, id(params['id']), meetingLinkSchema.parse(body)) });
  route({ method: 'POST', path: '/api/meetings/:id/join', action: 'meetings:join', module: MODULE, resourceParam: 'id', loadResource: loadMeetingResource, status: 200,
    handler: async ({ ctx, params }) => joinMeeting(ctx, id(params['id'])) });

  // The person's own Google Calendar connection.
  route({ method: 'GET', path: '/api/meetings/calendar', action: 'meetings:host', module: MODULE,
    handler: async ({ ctx }) => calendarConnectionStatus(ctx) });
  route({ method: 'POST', path: '/api/meetings/calendar/connect', action: 'meetings:host', module: MODULE, status: 200,
    handler: async ({ ctx, res }) => startCalendarConnect(ctx, res) });
  route({ method: 'POST', path: '/api/meetings/calendar/complete', action: 'meetings:host', module: MODULE, status: 200,
    handler: async ({ ctx, req, res, body }) => completeCalendarConnect(ctx, calendarCompleteSchema.parse(body), req, res) });
  route({ method: 'DELETE', path: '/api/meetings/calendar', action: 'meetings:host', module: MODULE,
    handler: async ({ ctx }) => disconnectCalendar(ctx) });

  // Client portal. Auth-only like the rest of the portal (client-portal/routes.ts):
  // every handler takes the client id from the principal alone (requireClient)
  // and filters by it, and the meetings module entitlement still applies.
  const portal = { authOnly: true, module: MODULE } as const;
  route({ ...portal, method: 'GET', path: '/api/client-portal/meetings',
    handler: async ({ ctx }) => ({ items: await portalListMeetings(ctx) }) });
  route({ ...portal, method: 'GET', path: '/api/client-portal/projects/:projectId/meeting-hosts',
    handler: async ({ ctx, params }) => portalHosts(ctx, id(params['projectId'])) });
  route({ ...portal, method: 'GET', path: '/api/client-portal/projects/:projectId/meeting-slots',
    handler: async ({ ctx, params, query }) => portalSlots(ctx, id(params['projectId']), portalSlotsQuerySchema.parse(query)) });
  route({ ...portal, method: 'POST', path: '/api/client-portal/meetings',
    handler: async ({ ctx, body }) => portalRequestMeeting(ctx, portalRequestSchema.parse(body)) });
  route({ ...portal, method: 'POST', path: '/api/client-portal/meetings/:id/choose', status: 200,
    handler: async ({ ctx, params, body }) => portalChooseProposal(ctx, id(params['id']), portalChooseSchema.parse(body).proposalId) });
  route({ ...portal, method: 'POST', path: '/api/client-portal/meetings/:id/cancel', status: 200,
    handler: async ({ ctx, params, body }) => portalCancelMeeting(ctx, id(params['id']), optionalReasonSchema.parse(body ?? {})) });
}

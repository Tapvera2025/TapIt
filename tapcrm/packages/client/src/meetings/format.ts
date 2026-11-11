import type { MeetingHistoryEntry, MeetingSlot, MeetingStatus } from './api.js';

export const MEETING_STATUS_LABEL: Record<MeetingStatus, string> = {
  requested: 'Waiting for an answer',
  proposed: 'Other times offered',
  confirmed: 'Confirmed',
  declined: 'Declined',
  cancelled: 'Cancelled',
  expired: 'Lapsed',
  completed: 'Held',
  no_show: 'Client did not join',
};

export const MEETING_STATUS_TONE: Record<MeetingStatus, 'waiting' | 'good' | 'bad' | 'neutral'> = {
  requested: 'waiting',
  proposed: 'waiting',
  confirmed: 'good',
  completed: 'good',
  declined: 'bad',
  cancelled: 'bad',
  expired: 'bad',
  no_show: 'bad',
};

function format(iso: string, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat('en-IN', { timeZone, ...options }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

/** "Mon 9 Nov, 10:00 am" in the zone. */
export function formatMeetingTime(iso: string, timeZone: string): string {
  return format(iso, timeZone, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function formatClock(iso: string, timeZone: string): string {
  return format(iso, timeZone, { hour: 'numeric', minute: '2-digit' });
}

export function formatDay(iso: string, timeZone: string): string {
  return format(iso, timeZone, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** The calendar date of an instant in the zone, YYYY-MM-DD. */
export function dayKey(iso: string, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return iso.slice(0, 10);
  }
}

export interface SlotDay {
  readonly key: string;
  readonly label: string;
  readonly slots: readonly MeetingSlot[];
}

export function groupSlotsByDay(slots: readonly MeetingSlot[], timeZone: string): SlotDay[] {
  const days = new Map<string, MeetingSlot[]>();
  for (const slot of slots) {
    const key = dayKey(slot.startsAt, timeZone);
    days.set(key, [...(days.get(key) ?? []), slot]);
  }
  return [...days.entries()].map(([key, daySlots]) => ({ key, label: formatDay(daySlots[0]!.startsAt, timeZone), slots: daySlots }));
}

export function durationMinutes(startsAt: string, endsAt: string): number {
  return Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** One line of a meeting's history, in plain words. */
export function describeHistory(entry: MeetingHistoryEntry, timeZone: string): string {
  const who = entry.actorKind === 'system' ? 'TapCRM' : entry.actorName ?? (entry.actorKind === 'client' ? 'The client' : 'Someone');
  const detail = entry.detail;
  const onBehalf = text(detail['onBehalfOf']) ? ` for ${text(detail['onBehalfOf'])}` : '';
  const reason = text(detail['reason']);
  switch (entry.event) {
    case 'requested':
      return `${who} asked for a meeting${text(detail['startsAt']) ? ` on ${formatMeetingTime(text(detail['startsAt'])!, timeZone)}` : ''}${detail['askedFor'] === 'anyone' ? ' with anyone on the team' : ''}`;
    case 'scheduled':
      return `${who} booked the meeting`;
    case 'accepted':
      return `${who} accepted${onBehalf}`;
    case 'proposed': {
      const times = Array.isArray(detail['times']) ? (detail['times'] as unknown[]).filter((time): time is string => typeof time === 'string') : [];
      const verb = detail['from'] === 'confirmed' ? 'moved it and offered' : 'offered';
      return `${who} ${verb}${onBehalf} ${times.map((time) => formatMeetingTime(time, timeZone)).join(', ') || 'other times'}${text(detail['note']) ? ` (“${text(detail['note'])}”)` : ''}`;
    }
    case 'chosen':
      return `${who} picked ${text(detail['startsAt']) ? formatMeetingTime(text(detail['startsAt'])!, timeZone) : 'a time'}`;
    case 'declined':
      return `${who} declined${onBehalf}${reason ? `: ${reason}` : ''}`;
    case 'cancelled':
      return `${who} cancelled${onBehalf}${reason ? `: ${reason}` : ''}`;
    case 'expired':
      return detail['from'] === 'proposed' ? 'Lapsed: the client did not pick a time' : 'Lapsed: nobody answered in time';
    case 'completed':
      return `${who} recorded it as held${text(detail['note']) ? `: ${text(detail['note'])}` : ''}`;
    case 'no_show':
      return `${who} recorded that the client did not join${text(detail['note']) ? `: ${text(detail['note'])}` : ''}`;
    case 'joined':
      return `${who} joined the meeting`;
    case 'reminded':
      return detail['who'] === 'host' ? 'Reminded the host to answer' : 'Reminded the client';
    case 'escalated':
      return 'Told the manager the request was still waiting';
    case 'link_added':
      return `${who} added a meeting link`;
    case 'calendar_failed':
      return `Google Calendar did not take it${text(detail['message']) ? `: ${text(detail['message'])}` : ''}`;
    default:
      return `${who}: ${entry.event}`;
  }
}

/** True when the meeting can be joined now: from 15 minutes before until its end. */
export function joinableNow(startsAt: string, endsAt: string, now = Date.now()): boolean {
  return now >= new Date(startsAt).getTime() - 15 * 60_000 && now <= new Date(endsAt).getTime();
}

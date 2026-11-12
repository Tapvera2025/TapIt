import { loadConfig } from '../../config.js';
import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import { addEmailToQueue, escapeHtml } from '../../platform/email/index.js';
import { notify } from '../notifications/facade.js';
import type { ClientContact } from './repository.js';

/**
 * Everything TapCRM tells people about meetings. Staff hear in the app (and
 * the host by email for a new request); clients hear in the portal and by
 * email. Google's own invitation carries the calendar entry when the event
 * is on a Google Calendar.
 *
 * Emails are collected while the transaction runs and sent after it commits,
 * so nobody is emailed about a change that rolled back.
 */

type NotifyCtx = Pick<RequestContext, 'organizationId' | 'principal'>;

export interface QueuedEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export class Outbox {
  readonly emails: QueuedEmail[] = [];

  email(to: string | null | undefined, subject: string, lines: readonly string[], action?: { label: string; url: string }): void {
    if (!to) return;
    const text = [...lines, ...(action ? ['', `${action.label}: ${action.url}`] : [])].join('\n');
    const html = [
      ...lines.map((line) => (line ? `<p>${escapeHtml(line)}</p>` : '')),
      action ? `<p><a href="${escapeHtml(action.url)}">${escapeHtml(action.label)}</a></p>` : '',
    ].join('\n');
    this.emails.push({ to, subject, text, html });
  }

  async flush(): Promise<void> {
    for (const message of this.emails.splice(0)) {
      try {
        await addEmailToQueue(message.to, message.subject, { text: message.text, html: message.html });
      } catch (cause) {
        // The meeting change stands; a lost email must not undo it.
        console.error('[meetings] email not queued', message.to, cause instanceof Error ? cause.message : cause);
      }
    }
  }
}

/** "Tue, 10 Nov, 3:30 pm IST" in the reader's zone. */
export function formatWhen(at: Date, zone: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).format(at);
  } catch {
    return at.toISOString();
  }
}

export function portalUrl(): string {
  return new URL('/client/meetings', loadConfig().CLIENT_ORIGIN).href;
}

export function staffUrl(meetingId: string): string {
  return new URL(`/company/meetings?meeting=${meetingId}`, loadConfig().CLIENT_ORIGIN).href;
}

export const staffLink = (meetingId: string): string => `/company/meetings?meeting=${meetingId}`;
const PORTAL_LINK = '/client/meetings';

/** In the app for staff. */
export async function tellStaff(
  tx: Tx,
  ctx: NotifyCtx,
  userIds: readonly string[],
  input: { type: string; title: string; body: string; meetingId: string; urgent?: boolean; includeActor?: boolean },
): Promise<void> {
  const users = [...new Set(userIds)].filter((id) => input.includeActor || id !== ctx.principal.id);
  if (users.length === 0) return;
  await notify(tx, ctx, {
    type: input.type,
    priority: input.urgent ? 'operational' : 'informational',
    audience: { users },
    title: input.title.slice(0, 200),
    body: input.body.slice(0, 2000),
    link: staffLink(input.meetingId),
    metadata: { meetingId: input.meetingId },
  });
}

/** In the portal and by email for the client's people. */
export async function tellClient(
  tx: Tx,
  ctx: NotifyCtx,
  outbox: Outbox,
  contacts: readonly ClientContact[],
  input: {
    type: string;
    title: string;
    lines: readonly string[];
    meetingId: string;
    meetUrl?: string | null;
    urgent?: boolean;
    /** Also tell the client who made the change (a confirmation they want in writing). */
    includeActor?: boolean;
  },
): Promise<void> {
  const skip = (userId: string | null) => !input.includeActor && userId !== null && userId === ctx.principal.id;
  const users = contacts.map((contact) => contact.userId).filter((id): id is string => id !== null && !skip(id));
  if (users.length > 0) {
    await notify(tx, ctx, {
      type: input.type,
      priority: input.urgent ? 'operational' : 'informational',
      audience: { users },
      title: input.title.slice(0, 200),
      body: input.lines.filter(Boolean).join(' ').slice(0, 2000),
      link: PORTAL_LINK,
      metadata: { meetingId: input.meetingId },
    });
  }
  for (const contact of contacts) {
    if (skip(contact.userId)) continue;
    outbox.email(
      contact.email,
      input.title,
      [`Hello ${contact.name},`, '', ...input.lines, ...(input.meetUrl ? ['', `Join the meeting: ${input.meetUrl}`] : [])],
      { label: 'Open your meetings', url: portalUrl() },
    );
  }
}

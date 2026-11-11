import type { ConversationKind } from './api/chatApi.js';

/**
 * Where a message was sent, after its sender's name: "in Q4 Launch" for a
 * group, and for a direct message who it went to rather than the sender's
 * own name a second time ("You to Asha", "Asha · Direct message").
 */
export function whereSent(kind: ConversationKind, label: string, fromViewer: boolean): string {
  if (kind !== 'direct') return ` in ${label}`;
  return fromViewer ? ` to ${label}` : ' · Direct message';
}

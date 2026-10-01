/**
 * Fired by App.tsx's `navigate()` on every call, even when the target path
 * equals the current one (e.g. a second notification deep link to
 * "/company/messages?conversationId=..." while already on that page) —
 * `pathname` state wouldn't change in that case, so nothing downstream would
 * otherwise know a new destination (with new query params) arrived.
 */
export const APP_NAVIGATE_EVENT = 'app:navigate';

/** `event.detail` on an `APP_NAVIGATE_EVENT` — the full path exactly as passed to `navigate()`. */
export type AppNavigateEvent = CustomEvent<string>;

/**
 * Outbox handlers — attendance design §5.5, MB-3, D22.
 *
 * A business transaction writes a `domain_outbox` row; after it commits, the
 * drainer hands the row to every handler registered for its name. Delivery is
 * AT LEAST ONCE: a handler can succeed and the "processed" write still fail,
 * so the same event can arrive again, carrying the same `id`. Every handler
 * must therefore be idempotent — an upsert, an insert behind a unique key, a
 * job enqueued under a key, or a socket event the client may see twice. Say
 * how, in a comment above each handler.
 */

export interface OutboxEvent {
  /** Stable across deliveries — the row's id. */
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly payload: unknown;
  readonly enqueuedAt: Date;
}

export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

export interface OutboxHandlerOptions {
  /**
   * For an event that records a change another module must apply, however
   * long that takes. The drainer never gives up on it: after the usual ten
   * attempts it raises an alert and keeps retrying every five minutes until
   * the handler succeeds.
   */
  readonly retryUntilDelivered?: boolean;
}

const handlers = new Map<string, OutboxHandler[]>();
const untilDelivered = new Set<string>();

export function onOutboxEvent(
  name: string,
  handler: OutboxHandler,
  options: OutboxHandlerOptions = {},
): void {
  handlers.set(name, [...(handlers.get(name) ?? []), handler]);
  if (options.retryUntilDelivered === true) untilDelivered.add(name);
}

export function handlersFor(name: string): readonly OutboxHandler[] {
  return handlers.get(name) ?? [];
}

/**
 * The drainer claims only these. A row nobody in this process handles stays
 * pending for a process that does — during a rolling deploy the new name may
 * be known to only half the fleet.
 */
export function handledEventNames(): string[] {
  return [...handlers.keys()].sort();
}

/** The events the drainer never gives up on (`retryUntilDelivered`). */
export function retriedUntilDelivered(): string[] {
  return [...untilDelivered].sort();
}

/** Tests only. */
export function __resetOutboxHandlers(): void {
  handlers.clear();
  untilDelivered.clear();
}

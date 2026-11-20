import { describe, expect, it } from 'vitest';
import { listenOnPersonalChannel, type PersonalChannelSocket } from './useNotifications.js';

/** A stand-in socket that records listeners and lets the test fire events. */
function fakeSocket() {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const socket = {
    on(event: string, listener: (...args: unknown[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return socket;
    },
  };
  const fire = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };
  return { socket: socket as unknown as PersonalChannelSocket, fire };
}

describe('the always-open notification socket', () => {
  it('passes on that the person\'s powers changed, on any page', () => {
    const { socket, fire } = fakeSocket();
    let changed = 0;
    listenOnPersonalChannel(socket, { onPermissionsChanged: () => { changed += 1; }, reconnect: () => undefined });
    fire('permissions:changed', { eventId: 'e-1', positionId: 'p-1' });
    expect(changed).toBe(1);
  });

  it('reconnects after the server closes it (powers changed, token expired)', () => {
    const { socket, fire } = fakeSocket();
    let reconnects = 0;
    listenOnPersonalChannel(socket, { reconnect: () => { reconnects += 1; } });
    fire('disconnect', 'io server disconnect');
    expect(reconnects).toBe(1);
    // socket.io retries every other kind of drop by itself.
    fire('disconnect', 'transport close');
    fire('disconnect', 'io client disconnect');
    expect(reconnects).toBe(1);
  });

  it('is harmless in a portal that does not follow powers', () => {
    const { socket, fire } = fakeSocket();
    listenOnPersonalChannel(socket, { reconnect: () => undefined });
    expect(() => fire('permissions:changed', {})).not.toThrow();
  });
});

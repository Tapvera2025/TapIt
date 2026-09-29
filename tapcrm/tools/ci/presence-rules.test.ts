import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findPresenceViolations } from './presence-rules.js';

const ROOT = '/repo';
const file = (path: string, text: string) => ({ path: resolve(ROOT, path), text });

describe('D26 — one presence state machine (design §20)', () => {
  it('allows the declaration in contracts/presence.ts', () => {
    expect(
      findPresenceViolations(
        [
          file(
            'packages/contracts/src/presence.ts',
            "export type PresenceState = 'NOT_IN' | 'WORKING';\nNOT_IN: { in: 'WORKING' }",
          ),
        ],
        ROOT,
      ),
    ).toEqual([]);
  });

  it('flags a transition table declared anywhere else', () => {
    const found = findPresenceViolations(
      [
        file(
          'packages/server/src/modules/live-status/state.ts',
          "const T = {\n  NOT_IN: { in: 'WORKING' },\n};",
        ),
      ],
      ROOT,
    );
    expect(found).toEqual([
      {
        file: 'packages/server/src/modules/live-status/state.ts',
        line: 2,
        what: 'declares a presence transition table',
      },
    ]);
  });

  it('flags the union spelled out again', () => {
    const found = findPresenceViolations(
      [
        file(
          'packages/server/src/modules/attendance/types.ts',
          "type S = 'NOT_IN' | 'WORKING' | 'FINISHED';",
        ),
      ],
      ROOT,
    );
    expect(found[0]?.what).toBe('declares the PresenceState union');
  });

  it('flags attendance importing live-status, even through its façade', () => {
    const found = findPresenceViolations(
      [
        file(
          'packages/server/src/modules/attendance/ledger.ts',
          "import { x } from '../live-status/facade.js';",
        ),
      ],
      ROOT,
    );
    expect(found[0]?.what).toBe('imports live-status');
  });

  it('lets a state be compared by name', () => {
    expect(
      findPresenceViolations(
        [
          file(
            'packages/server/src/modules/attendance/ledger.ts',
            "if (state === 'WORKING') {}",
          ),
        ],
        ROOT,
      ),
    ).toEqual([]);
  });
});

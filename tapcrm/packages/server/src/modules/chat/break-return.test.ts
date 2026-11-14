import { describe, expect, it } from 'vitest';
import { breakOutcome } from './break-return.js';
import { breakReturnNotice } from './notifications.js';

describe("Tell me when they're back (0159)", () => {
  it('keeps waiting while the break goes on, and only then', () => {
    expect(breakOutcome('ON_BREAK')).toBeNull();
    expect(breakOutcome('WORKING')).toBe('back');
    expect(breakOutcome('FINISHED')).toBe('away');
    expect(breakOutcome('NOT_IN')).toBe('away');
    expect(breakOutcome(null)).toBe('away');
  });

  it('tells the asker in plain words', () => {
    expect(breakReturnNotice('Rahul Sharma', 'back')).toEqual({ title: 'Rahul Sharma is back from break', body: '' });
    const away = breakReturnNotice('Rahul Sharma', 'away');
    expect(away.title).toBe("Rahul Sharma's break has ended");
    expect(away.body).toBe("They aren't at work right now, so a reply may have to wait.");
  });
});

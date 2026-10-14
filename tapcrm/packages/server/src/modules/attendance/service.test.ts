import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { visibilityFilter } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import { toDateOnly } from '../../platform/time.js';
import type { listRecordsInRange, RecordListRow } from './api-repository.js';
import type { applyCloseDecision } from './ledger.js';
import type { recalculateRecord } from './recalculate.js';
import type { closeDueRecords, lockPerson } from './repository.js';

const mocks = vi.hoisted(() => ({
  tx: {} as Tx,
  visibility: vi.fn<typeof visibilityFilter>(),
  list: vi.fn<typeof listRecordsInRange>(),
  lock: vi.fn<typeof lockPerson>(),
  overdue: vi.fn<typeof closeDueRecords>(),
  close: vi.fn<typeof applyCloseDecision>(),
  recalculate: vi.fn<typeof recalculateRecord>(),
}));

vi.mock('@tapcrm/authz', () => ({ visibilityFilter: mocks.visibility }));
vi.mock('../../platform/dal/db.js', () => ({
  db: {
    transaction: async <T>(_ctx: RequestContext, fn: (tx: Tx) => Promise<T>) =>
      fn(mocks.tx),
  },
}));
vi.mock('./api-repository.js', () => ({ listRecordsInRange: mocks.list }));
vi.mock('./detail.js', () => ({ loadDayDetail: vi.fn() }));
vi.mock('./repository.js', () => ({
  closeDueRecords: mocks.overdue,
  lockPerson: mocks.lock,
}));
vi.mock('./ledger.js', () => ({ applyCloseDecision: mocks.close }));
vi.mock('./recalculate.js', () => ({ recalculateRecord: mocks.recalculate }));

import { listRecords } from './service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const workDate = toDateOnly('2026-10-01');
const query = { from: workDate, to: workDate };
const ctx = {
  organizationId: 'organization',
  principal: { id: userId },
} as RequestContext;
const visibility = { sql: 'u.id = $1', parameters: [userId] };
const row: RecordListRow = {
  userId,
  employeeId: 'EMP-1',
  workDate,
  state: 'open',
  status: null,
  dayType: 'working',
  presentUnits: 0,
  paidLeaveUnits: 0,
  unpaidLeaveUnits: 0,
  absentUnits: 0,
  holidayUnits: 0,
  workedMinutes: 0,
  breakMinutes: 0,
  lateMinutes: 0,
  earlyExitMinutes: 0,
  overtimeMinutes: 0,
  nightMinutes: 0,
  arrivalAt: null,
  departureAt: null,
  isWfh: false,
  flags: [],
  shiftId: null,
  shiftSource: 'default',
  shiftKind: null,
  shiftStart: null,
  shiftEnd: null,
  departmentId: null,
  calculationVersion: 0,
  recalculating: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.visibility.mockResolvedValue(visibility);
  mocks.list.mockResolvedValue([row]);
  mocks.lock.mockResolvedValue(undefined);
  mocks.overdue.mockResolvedValue([]);
  mocks.close.mockResolvedValue(undefined);
  mocks.recalculate.mockResolvedValue('calculated');
});

describe('attendance list read repair', () => {
  it('keeps an explicit subject outside the visible rows read only', async () => {
    mocks.list.mockResolvedValue([]);

    await expect(listRecords(ctx, { ...query, userId })).resolves.toEqual({
      records: [],
    });

    expect(mocks.list).toHaveBeenCalledOnce();
    expect(mocks.list).toHaveBeenCalledWith(
      mocks.tx,
      visibility,
      workDate,
      workDate,
      userId,
    );
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.overdue).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.recalculate).not.toHaveBeenCalled();
  });

  it('holds the person lock while finding and repairing overdue days, then returns the fresh result', async () => {
    let locked = false;
    mocks.lock.mockImplementation(async () => {
      locked = true;
    });
    mocks.overdue.mockImplementation(async () => {
      expect(locked).toBe(true);
      return [
        {
          id: 'record',
          userId,
          workDate,
          closeDueAt: new Date('2026-10-02'),
          inputVersion: 1,
        },
      ];
    });
    mocks.close.mockImplementation(async () => {
      expect(locked).toBe(true);
    });
    mocks.list.mockResolvedValueOnce([row]).mockResolvedValueOnce([
      {
        ...row,
        state: 'closed',
        status: 'absent',
        absentUnits: 1,
        recalculating: false,
      },
    ]);

    const result = await listRecords(ctx, { ...query, userId });

    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.lock).toHaveBeenCalledWith(mocks.tx, userId);
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledWith(mocks.tx, userId, workDate);
    expect(mocks.recalculate).toHaveBeenCalledOnce();
    expect(mocks.recalculate).toHaveBeenCalledWith(mocks.tx, 'record');
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(result.records[0]).toMatchObject({
      state: 'closed',
      status: 'absent',
      recalculating: false,
    });
  });

  it('keeps a list without an explicit subject read only', async () => {
    const result = await listRecords(ctx, query);

    expect(result.records[0]).toMatchObject({
      userId,
      state: 'open',
      recalculating: true,
    });
    expect(mocks.list).toHaveBeenCalledOnce();
    expect(mocks.list).toHaveBeenCalledWith(
      mocks.tx,
      visibility,
      workDate,
      workDate,
      null,
    );
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.overdue).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.recalculate).not.toHaveBeenCalled();
  });

  it('returns fresh rows when another closer finished before the person lock was acquired', async () => {
    mocks.list
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([
        { ...row, state: 'closed', status: 'absent', recalculating: false },
      ]);
    mocks.overdue.mockResolvedValue([]);

    const result = await listRecords(ctx, { ...query, userId });

    expect(result.records[0]).toMatchObject({ state: 'closed', recalculating: false });
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.recalculate).not.toHaveBeenCalled();
  });
});

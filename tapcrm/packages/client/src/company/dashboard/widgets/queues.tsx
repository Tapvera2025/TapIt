import { useEffect, useState } from 'react';
import {
  listLeaveAcknowledgements,
  listLeaveDecisions,
} from '../../api/leaveApi.js';
import { listCorrections, type CorrectionListItem } from '../../attendance/attendanceApi.js';
import { loadLiveBoard, type LiveBoard } from '../../live/liveApi.js';
import type { WidgetContext } from '../widget-types.js';

function Panel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="flex h-full flex-col overflow-hidden">{children}</div>;
}
function Loading(): React.JSX.Element {
  return <div className="flex-1 animate-pulse rounded-lg bg-app-surface/60" />;
}

/* ------------------------------------------------------------ Leave queue */

export function LeaveQueueWidget({ ctx }: { ctx: WidgetContext }): React.JSX.Element {
  const [total, setTotal] = useState<number | null>(null);
  useEffect(() => {
    void Promise.allSettled([listLeaveDecisions(), listLeaveAcknowledgements()])
      .then(([d, a]) => {
        const decisions = d.status === 'fulfilled' ? d.value : [];
        const acks = a.status === 'fulfilled' ? a.value : [];
        setTotal(decisions.length + acks.length);
      });
  }, []);

  return (
    <Panel>
      <div className="flex items-center justify-between">
        <p className="text-sm text-app-muted">Leave queue</p>
        <button type="button" className="text-xs font-semibold text-app-accent hover:underline" onClick={() => ctx.onNavigate('/company/leave/queue')}>
          Review →
        </button>
      </div>
      {total === null ? (
        <Loading />
      ) : (
        <>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{total}</p>
          <p className="mt-2 text-xs text-app-muted">Awaiting your action</p>
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------- Corrections queue */

export function CorrectionsQueueWidget({ ctx }: { ctx: WidgetContext }): React.JSX.Element {
  const [items, setItems] = useState<CorrectionListItem[] | null>(null);
  useEffect(() => {
    listCorrections({ status: 'pending' })
      .then((r) => setItems(r.corrections))
      .catch(() => setItems([]));
  }, []);

  return (
    <Panel>
      <div className="flex items-center justify-between">
        <p className="text-sm text-app-muted">Attendance corrections</p>
        <button type="button" className="text-xs font-semibold text-app-accent hover:underline" onClick={() => ctx.onNavigate('/company/attendance/corrections')}>
          Review →
        </button>
      </div>
      {items === null ? (
        <Loading />
      ) : (
        <>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{items.length}</p>
          <p className="mt-2 text-xs text-app-muted">Pending decisions</p>
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------ Team live */

export function TeamLiveWidget({ ctx }: { ctx: WidgetContext }): React.JSX.Element {
  const [board, setBoard] = useState<LiveBoard | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    loadLiveBoard(controller.signal).then(setBoard).catch(() => setBoard({ rows: [], groups: {} as LiveBoard['groups'] }));
    return () => controller.abort();
  }, []);

  if (!board) return <Panel><Loading /></Panel>;
  const groups = board.groups ?? {};
  const working = (groups['working'] ?? 0) + (groups['onBreak'] ?? 0);
  const finished = groups['finished'] ?? 0;
  const notIn = (groups['notInDue'] ?? 0) + (groups['notInNotYetDue'] ?? 0);
  const total = board.rows.length;

  return (
    <Panel>
      <div className="flex items-center justify-between">
        <p className="text-sm text-app-muted">Team present today</p>
        <button type="button" className="text-xs font-semibold text-app-accent hover:underline" onClick={() => ctx.onNavigate('/company/attendance/live')}>
          Open board →
        </button>
      </div>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{working} <span className="text-base text-app-muted">/ {total}</span></p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg border border-app-border p-2"><p className="text-app-muted">Working</p><p className="mt-1 font-semibold">{working}</p></div>
        <div className="rounded-lg border border-app-border p-2"><p className="text-app-muted">Finished</p><p className="mt-1 font-semibold">{finished}</p></div>
        <div className="rounded-lg border border-app-border p-2"><p className="text-app-muted">Not in</p><p className="mt-1 font-semibold">{notIn}</p></div>
      </div>
    </Panel>
  );
}

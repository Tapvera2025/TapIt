import { useEffect, useState } from 'react';
import { ACTIONS, actionTitle } from '@tapcrm/contracts';
import { Button, Card, Empty, Field, Loading, Modal, Notice, Page, SearchableSelect, Select } from '../../ui/components.js';
import { getCompanyEmployees, type CompanyEmployee } from '../../company/api/companyApi.js';
import { createLegalHold, downloadAuditExport, getAuditEntries, getAuditEntry, getAuditIntegrity, getLegalHoldTargets, getLegalHolds, releaseLegalHold, type AuditEntry, type AuditIntegrityReport, type LegalHold, type LegalHoldTarget } from '../api/auditApi.js';

export function AuditLogPage({ canManageHolds = false, canExport = false }: { canManageHolds?: boolean; canExport?: boolean }): React.JSX.Element {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([]);
  const [stream, setStream] = useState<'access' | 'activity' | ''>('');
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [integrity, setIntegrity] = useState<AuditIntegrityReport | null>(null);
  const [holds, setHolds] = useState<LegalHold[]>([]);
  const [holdType, setHoldType] = useState<'user' | 'client' | 'date-range'>('user');
  const [holdTargetId, setHoldTargetId] = useState('');
  const [holdStartsAt, setHoldStartsAt] = useState('');
  const [holdEndsAt, setHoldEndsAt] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [holdError, setHoldError] = useState('');
  const [exportError, setExportError] = useState('');
  const [people, setPeople] = useState<CompanyEmployee[]>([]);
  const [holdTargets, setHoldTargets] = useState<LegalHoldTarget[]>([]);

  const resetPagination = () => {
    setCursor(undefined);
    setCursorHistory([]);
  };

  const exportAudit = (format: 'csv' | 'json') => {
    setExportError('');
    void downloadAuditExport({
      ...(stream ? { stream } : {}), ...(action ? { action } : {}),
      ...(actorId ? { actorId } : {}), ...(targetId ? { targetId } : {}),
      ...(from ? { from: new Date(from).toISOString() } : {}), ...(to ? { to: new Date(to).toISOString() } : {}),
    }, format).then((blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `tapcrm-audit.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    }).catch((cause) => setExportError(cause instanceof Error ? cause.message : 'Unable to export audit entries.'));
  };

  const load = (requestedCursor = cursor) => {
    setLoading(true);
    setError('');
    void getAuditEntries({
      ...(stream ? { stream } : {}),
      ...(action ? { action } : {}),
      ...(actorId ? { actorId } : {}),
      ...(targetId ? { targetId } : {}),
      ...(from ? { from: new Date(from).toISOString() } : {}),
      ...(to ? { to: new Date(to).toISOString() } : {}),
      limit: 25,
      ...(requestedCursor ? { cursor: requestedCursor } : {}),
    })
      .then((result) => {
        setEntries(result.entries);
        setNextCursor(result.nextCursor);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load audit entries.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [cursor]); // filters are applied explicitly by Search.
  useEffect(() => {
    void getCompanyEmployees().then(setPeople).catch(() => setPeople([]));
  }, []);
  useEffect(() => {
    void getAuditIntegrity().then(setIntegrity).catch(() => setIntegrity(null));
  }, []);
  useEffect(() => {
    if (!canManageHolds) return;
    void Promise.all([getLegalHolds(), getLegalHoldTargets()])
      .then(([holdResult, targetResult]) => { setHolds(holdResult.holds); setHoldTargets(targetResult.targets); })
      .catch((cause) => setHoldError(cause instanceof Error ? cause.message : 'Unable to load legal holds.'));
  }, [canManageHolds]);

  const submitHold = () => {
    setHoldError('');
    void createLegalHold({
      holdType,
      ...(holdType === 'date-range' ? { startsAt: new Date(holdStartsAt).toISOString(), endsAt: new Date(holdEndsAt).toISOString() } : { targetId: holdTargetId }),
      reason: holdReason,
    }).then((hold) => { setHolds((current) => [hold, ...current]); setHoldReason(''); }).catch((cause) => setHoldError(cause instanceof Error ? cause.message : 'Unable to place legal hold.'));
  };

  return (
    <Page
      eyebrow="Audit"
      title="Audit Log"
      description="Read-only access and activity history for this organization. Audit entries cannot be edited or deleted."
    >
      <Card className="mt-6">
        <div className="grid gap-4 md:grid-cols-6">
          <Select label="Stream" value={stream} onChange={(value) => { setStream(value as typeof stream); resetPagination(); }} options={[{ value: 'access', label: 'Access' }, { value: 'activity', label: 'Activity' }]} />
          <Select label="Action" value={action} onChange={(value) => { setAction(value); resetPagination(); }} options={ACTIONS.map((item) => ({ value: item, label: `${actionTitle(item)} (${item})` }))} />
          <Select label="Actor" value={actorId} onChange={(value) => { setActorId(value); resetPagination(); }} options={people.map((person) => ({ value: person.id, label: `${person.fullName}${person.positionName ? ` · ${person.positionName}` : ''}` }))} />
          <Select label="Target employee" value={targetId} onChange={(value) => { setTargetId(value); resetPagination(); }} options={people.map((person) => ({ value: person.id, label: `${person.fullName}${person.departmentName ? ` · ${person.departmentName}` : ''}` }))} />
          <Field label="From" value={from} onChange={(value) => { setFrom(value); resetPagination(); }} type="datetime-local" />
          <Field label="To" value={to} onChange={(value) => { setTo(value); resetPagination(); }} type="datetime-local" />
        </div>
        <div className="mt-4 flex justify-end gap-3">
          <Button kind="secondary" onClick={() => { setStream(''); setAction(''); setActorId(''); setTargetId(''); setFrom(''); setTo(''); resetPagination(); load(undefined); }}>Clear</Button>
          <Button onClick={() => { resetPagination(); load(undefined); }}>Search</Button>
        </div>
        {canExport && <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-app-border pt-4">
          {exportError && <p className="mr-auto text-sm text-app-danger">{exportError}</p>}
          <span className="text-xs text-app-muted">Export current filters</span>
          <Button kind="secondary" onClick={() => exportAudit('csv')}>Download CSV</Button>
          <Button kind="secondary" onClick={() => exportAudit('json')}>Download JSON</Button>
        </div>}
      </Card>
      {integrity && <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-app-muted">Integrity verification</p>
            <p className={`mt-1 font-semibold ${integrity.outcome === 'success' ? 'text-app-accent' : 'text-app-danger'}`}>
              {integrity.outcome === 'success' ? 'Verified' : `${integrity.errorCount} integrity issue(s) detected`}
            </p>
          </div>
          <p className="text-xs text-app-muted">{new Date(integrity.checkedAt).toLocaleString()} · {integrity.entriesChecked} entries checked</p>
        </div>
        {integrity.outcome === 'failure' && <ul className="mt-4 space-y-2 text-sm text-app-danger">
          {integrity.streams.flatMap((stream) => stream.failures).slice(0, 10).map((item) => <li key={`${item.stream}-${item.sequence}-${item.reason}`}>{item.stream} sequence {item.sequence}: {item.reason}</li>)}
        </ul>}
      </Card>}
      {integrity?.retention && <Card className="mt-6">
        <p className="text-xs font-bold uppercase tracking-wide text-app-muted">Archive &amp; retention</p>
        <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
          <div><p className="text-app-muted">Last retention run</p><p>{integrity.retention.lastRunAt ? new Date(integrity.retention.lastRunAt).toLocaleString() : 'Not run yet'}</p></div>
          <div><p className="text-app-muted">Status</p><p>{integrity.retention.lastOutcome ?? 'Not run yet'}</p></div>
          <div><p className="text-app-muted">Archived data</p><p>{integrity.retention.archivedRanges} range(s) · {integrity.retention.archivedEntries} entries</p></div>
        </div>
      </Card>}
      {canManageHolds && <Card className="mt-6">
        <p className="text-xs font-bold uppercase tracking-wide text-app-muted">Legal holds</p>
        <p className="mt-1 text-sm text-app-muted">Active holds protect matching audit entries from future retention removal. Releasing one hold does not release overlapping holds.</p>
        {holdError && <div className="mt-4"><Notice error>{holdError}</Notice></div>}
        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <Select label="Hold type" value={holdType} onChange={(value) => setHoldType(value as typeof holdType)} options={[{ value: 'user', label: 'User' }, { value: 'client', label: 'Client' }, { value: 'date-range', label: 'Date range' }]} />
          {holdType === 'date-range' ? <>
            <Field label="Starts at" value={holdStartsAt} onChange={setHoldStartsAt} type="datetime-local" />
            <Field label="Ends at" value={holdEndsAt} onChange={setHoldEndsAt} type="datetime-local" />
          </> : <SearchableSelect
            label={holdType === 'user' ? 'User' : 'Client'}
            value={holdTargetId}
            onChange={setHoldTargetId}
            options={holdTargets.filter((target) => target.kind === holdType).map((target) => ({ value: target.id, label: `${target.name}${target.code ? ` — ${target.code}` : ''}` }))}
            placeholder={`Search ${holdType === 'user' ? 'users' : 'clients'}…`}
          />}
          <Field label="Reason" value={holdReason} onChange={setHoldReason} />
        </div>
        <div className="mt-4 flex justify-end"><Button onClick={submitHold} disabled={!holdReason || (holdType !== 'date-range' && !holdTargetId) || (holdType === 'date-range' && (!holdStartsAt || !holdEndsAt))}>Place hold</Button></div>
        <div className="mt-6 space-y-2">
          {holds.map((hold) => <div key={hold.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-app-border p-3 text-sm">
            <div><p className="font-semibold">{hold.holdType} · {hold.targetId ?? `${hold.startsAt ?? ''} to ${hold.endsAt ?? ''}`}</p><p className="text-xs text-app-muted">{hold.reason} · placed {new Date(hold.placedAt).toLocaleString()}</p></div>
            <Button kind="danger" onClick={() => void releaseLegalHold(hold.id).then((released) => setHolds((current) => current.map((item) => item.id === released.id ? released : item))).catch((cause) => setHoldError(cause instanceof Error ? cause.message : 'Unable to release legal hold.'))}>Release</Button>
          </div>)}
          {holds.length === 0 && <p className="text-sm text-app-muted">No active legal holds.</p>}
        </div>
      </Card>}
      {error && <div className="mt-6"><Notice error>{error}</Notice></div>}
      {loading ? <Loading /> : entries.length === 0 ? <div className="mt-6"><Empty>No audit entries match these filters.</Empty></div> : (
        <Card className="mt-6 overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-app-border text-xs uppercase tracking-wide text-app-muted">
              <tr><th className="px-5 py-4">When</th><th className="px-5 py-4">Stream</th><th className="px-5 py-4">Action</th><th className="px-5 py-4">Target</th><th className="px-5 py-4">Effect</th></tr>
            </thead>
            <tbody>
              {entries.map((entry) => <tr key={entry.id} className="border-b border-app-border/60 last:border-0">
                <td className="whitespace-nowrap px-5 py-4 text-app-muted">{new Date(entry.occurredAt).toLocaleString()}</td>
                <td className="px-5 py-4 font-semibold capitalize">{entry.stream}</td>
                <td className="px-5 py-4">{actionTitle(entry.action)}</td>
                <td className="px-5 py-4">{entry.targetType}{entry.targetId ? ` · ${people.find((person) => person.id === entry.targetId)?.fullName ?? 'record'}` : ''}</td>
                <td className="px-5 py-4"><Button kind="secondary" onClick={() => void getAuditEntry(entry.id).then(setSelected).catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load audit entry.'))}>Details</Button></td>
              </tr>)}
            </tbody>
          </table>
        </Card>
      )}
      <div className="mt-5 flex justify-end gap-3">
        <Button kind="secondary" disabled={cursorHistory.length === 0 || loading} onClick={() => {
          const previous = cursorHistory[cursorHistory.length - 1];
          setCursorHistory((history) => history.slice(0, -1));
          setCursor(previous);
        }}>Previous</Button>
        <Button disabled={!nextCursor || loading} onClick={() => {
          setCursorHistory((history) => [...history, cursor]);
          setCursor(nextCursor ?? undefined);
        }}>Next</Button>
      </div>
      {selected && <Modal title="Audit entry details" onClose={() => setSelected(null)}>
        <dl className="grid gap-3 text-sm md:grid-cols-2">
          <div><dt className="text-app-muted">Actor</dt><dd>{selected.actorId ? people.find((person) => person.id === selected.actorId)?.fullName ?? selected.actorType : selected.actorType}</dd></div>
          <div><dt className="text-app-muted">Source address</dt><dd className="font-mono text-xs">{selected.sourceIp ?? '—'}</dd></div>
          <div><dt className="text-app-muted">Target</dt><dd>{selected.targetType}{selected.targetId ? ` · ${people.find((person) => person.id === selected.targetId)?.fullName ?? 'record'}` : ''}</dd></div>
          <div><dt className="text-app-muted">Action / stream</dt><dd>{actionTitle(selected.action)} · {selected.stream}</dd></div>
          <div><dt className="text-app-muted">Request ID</dt><dd className="font-mono text-xs">{selected.requestId ?? '—'}</dd></div>
          <div><dt className="text-app-muted">Reason</dt><dd>{selected.reason ?? '—'}</dd></div>
          <div><dt className="text-app-muted">Hash</dt><dd className="break-all font-mono text-xs">{selected.hash}</dd></div>
        </dl>
        <details className="mt-4 text-xs text-app-muted"><summary className="cursor-pointer">Technical identifiers</summary><pre className="mt-2 overflow-auto rounded-lg bg-app-background p-3">{JSON.stringify({ id: selected.id, actorId: selected.actorId, targetId: selected.targetId, sequence: selected.sequence }, null, 2)}</pre></details>
        <pre className="mt-5 max-h-72 overflow-auto rounded-lg bg-app-background p-3 text-xs">{JSON.stringify({ before: selected.beforeData, after: selected.afterData }, null, 2)}</pre>
      </Modal>}
    </Page>
  );
}

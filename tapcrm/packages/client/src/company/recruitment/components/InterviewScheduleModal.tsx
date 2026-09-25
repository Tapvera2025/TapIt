import { useEffect, useState } from 'react';
import { Button, Field, Modal, Notice, Select } from '../../../ui/components.js';
import {
  getCompanyEmployees,
  type CompanyEmployee,
} from '../../api/companyApi.js';
import { scheduleInterview } from '../api/recruitmentApi.js';
import type {
  Candidate,
  Interview,
  InterviewStage,
  InterviewType,
  JobRequisition,
} from '../types/index.js';

export function InterviewScheduleModal({
  candidates,
  requisitions,
  preselectedCandidate,
  onClose,
  onScheduled,
}: {
  readonly candidates: Candidate[];
  readonly requisitions: JobRequisition[];
  readonly preselectedCandidate?: Candidate | undefined;
  readonly onClose: () => void;
  readonly onScheduled: (interview: Interview) => void;
}): React.JSX.Element {
  const [candidateId, setCandidateId] = useState(
    preselectedCandidate?.id ?? (candidates.length > 0 && candidates[0] ? candidates[0].id : ''),
  );
  const [requisitionId, setRequisitionId] = useState(
    preselectedCandidate?.requisitionId ?? (requisitions.length > 0 && requisitions[0] ? requisitions[0].id : ''),
  );

  const [stage, setStage] = useState<InterviewStage>('technical');
  const [round, setRound] = useState('1');
  const [interviewType, setInterviewType] = useState<InterviewType>('video');
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date(Date.now() + 24 * 3600000);
    d.setMinutes(0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [locationOrLink, setLocationOrLink] = useState('https://meet.google.com/');
  const [selectedInterviewerId, setSelectedInterviewerId] = useState('');
  const [notes, setNotes] = useState('');

  const [employees, setEmployees] = useState<CompanyEmployee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getCompanyEmployees()
      .then((emps) => {
        if (!cancelled) {
          setEmployees(emps);
          if (emps.length > 0 && emps[0]) {
            setSelectedInterviewerId(emps[0].id);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load company employee directory');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingEmployees(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleCandidateChange(id: string) {
    setCandidateId(id);
    const cand = candidates.find((c) => c.id === id);
    if (cand?.requisitionId) {
      setRequisitionId(cand.requisitionId);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!candidateId) {
      setError('Please select a candidate');
      return;
    }
    if (!requisitionId) {
      setError('Please select a job requisition');
      return;
    }
    if (!scheduledAt) {
      setError('Please select interview date and time');
      return;
    }

    const roundNum = parseInt(round, 10);
    const durationNum = parseInt(durationMinutes, 10);
    if (isNaN(roundNum) || roundNum < 1) {
      setError('Interview round must be at least 1');
      return;
    }
    if (isNaN(durationNum) || durationNum < 15) {
      setError('Duration must be at least 15 minutes');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const scheduled = await scheduleInterview({
        candidateId,
        requisitionId,
        stage,
        round: roundNum,
        interviewType,
        scheduledAt: new Date(scheduledAt).toISOString(),
        durationMinutes: durationNum,
        locationOrLink: locationOrLink.trim() || undefined,
        interviewerIds: selectedInterviewerId ? [selectedInterviewerId] : [],
        notes: notes.trim() || undefined,
      });

      onScheduled(scheduled);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to schedule interview');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Schedule Interview Round" onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {error && <Notice error>{error}</Notice>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Candidate"
            value={candidateId}
            onChange={handleCandidateChange}
            disabled={Boolean(preselectedCandidate) || submitting}
            options={candidates.map((c) => ({
              value: c.id,
              label: `${c.fullName ?? `${c.firstName} ${c.lastName}`} (${c.status})`,
            }))}
            required
          />

          <Select
            label="Job Requisition"
            value={requisitionId}
            onChange={setRequisitionId}
            disabled={submitting}
            options={requisitions.map((r) => ({
              value: r.id,
              label: `${r.requisitionNumber} - ${r.title}`,
            }))}
            required
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="Interview Stage"
            value={stage}
            onChange={(val) => setStage(val as InterviewStage)}
            disabled={submitting}
            options={[
              { value: 'screening', label: 'Screening Round' },
              { value: 'technical', label: 'Technical Assessment' },
              { value: 'managerial', label: 'Managerial Round' },
              { value: 'hr', label: 'HR Culture Fit' },
              { value: 'final', label: 'Final Leadership' },
            ]}
          />

          <Field
            label="Round #"
            type="number"
            value={round}
            onChange={setRound}
            required
            disabled={submitting}
          />

          <Select
            label="Format / Type"
            value={interviewType}
            onChange={(val) => setInterviewType(val as InterviewType)}
            disabled={submitting}
            options={[
              { value: 'video', label: 'Video Call' },
              { value: 'in_person', label: 'In Person' },
              { value: 'phone', label: 'Phone Call' },
            ]}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Date &amp; Time"
            type="datetime-local"
            value={scheduledAt}
            onChange={setScheduledAt}
            required
            disabled={submitting}
          />

          <Field
            label="Duration (Minutes)"
            type="number"
            value={durationMinutes}
            onChange={setDurationMinutes}
            required
            disabled={submitting}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Lead Evaluator / Panelist"
            value={selectedInterviewerId}
            onChange={setSelectedInterviewerId}
            disabled={loadingEmployees || submitting}
            options={employees.map((e) => ({
              value: e.id,
              label: `${e.fullName} (${e.departmentName ?? 'Team'})`,
            }))}
          />

          <Field
            label="Location or Meeting Link"
            value={locationOrLink}
            onChange={setLocationOrLink}
            placeholder="Google Meet / Room Name"
            disabled={submitting}
          />
        </div>

        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Preparation &amp; Panel Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            disabled={submitting}
            placeholder="Competencies to evaluate, coding topics, panel instructions..."
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
          />
        </label>

        <div className="mt-6 flex justify-end gap-3 border-t border-app-border pt-4">
          <Button type="button" kind="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" kind="primary" disabled={submitting}>
            {submitting ? 'Scheduling...' : 'Schedule Interview'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

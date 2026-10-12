import { useEffect, useState } from 'react';
import { Button, Modal, Notice } from '../../../ui/components.js';
import { listEmailTemplates, sendJoiningEmail } from '../api/recruitmentApi.js';
import type { CandidateJoining, RecruitmentEmailTemplate, SendJoiningEmailInput } from '../types/index.js';

const VARIABLE_HINTS = [
  '{{candidate_name}}',
  '{{position_title}}',
  '{{joining_date}}',
  '{{company_name}}',
  '{{manager_name}}',
  '{{acknowledge_link}}',
];

export function SendJoiningEmailModal({
  joining,
  onClose,
  onSent,
}: {
  readonly joining: CandidateJoining;
  readonly onClose: () => void;
  readonly onSent: (updated: { sent: boolean; acknowledgeToken: string }) => void;
}): React.JSX.Element {
  const [templates, setTemplates] = useState<RecruitmentEmailTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listEmailTemplates()
      .then((data) => {
        if (cancelled) return;
        setTemplates(data);
        const defaultTemplate = data.find((t) => t.isDefault) ?? data[0];
        if (defaultTemplate) {
          setSelectedTemplateId(defaultTemplate.id);
          setSubject(defaultTemplate.subject);
          setBody(defaultTemplate.body);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingTemplates(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleTemplateChange(id: string) {
    setSelectedTemplateId(id);
    if (!id) {
      setSubject('');
      setBody('');
      return;
    }
    const tmpl = templates.find((t) => t.id === id);
    if (tmpl) {
      setSubject(tmpl.subject);
      setBody(tmpl.body);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim()) {
      setError('Email subject is required.');
      return;
    }
    if (!body.trim()) {
      setError('Email body is required.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const input: SendJoiningEmailInput = {
        templateId: selectedTemplateId || null,
        subject: subject.trim(),
        body: body.trim(),
      };
      const result = await sendJoiningEmail(joining.id, input);
      onSent(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send joining email');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={`Send Joining Email — ${joining.candidateName ?? 'Candidate'}`}
      onClose={onClose}
    >
      <form onSubmit={(e) => void handleSend(e)} className="space-y-4">
        {error && <Notice error>{error}</Notice>}

        <div className="rounded-xl border border-app-border bg-app-surface px-4 py-3 text-xs space-y-1.5">
          <div className="flex justify-between">
            <span className="text-app-muted">Sending to:</span>
            <span className="font-mono text-app-foreground">{joining.candidateEmail ?? 'Candidate Email'}</span>
          </div>
          {joining.expectedJoiningDate && (
            <div className="flex justify-between">
              <span className="text-app-muted">Expected joining:</span>
              <span className="font-medium text-app-foreground">{joining.expectedJoiningDate}</span>
            </div>
          )}
          {joining.joiningEmailSentAt && (
            <div className="flex justify-between">
              <span className="text-app-muted">Previously sent:</span>
              <span className="text-amber-600">
                {new Date(joining.joiningEmailSentAt).toLocaleString()} (resend)
              </span>
            </div>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-app-muted">Template</label>
          {loadingTemplates ? (
            <p className="text-xs text-app-muted">Loading templates...</p>
          ) : (
            <select
              value={selectedTemplateId}
              onChange={(e) => handleTemplateChange(e.target.value)}
              disabled={submitting}
              className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent"
            >
              <option value="">Custom (no template)</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.isDefault ? ' (Default)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-app-muted">Subject *</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            disabled={submitting}
            placeholder="Joining confirmation details — Company Name"
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent"
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-semibold text-app-muted">Body (HTML) *</label>
            <div className="flex flex-wrap gap-1">
              {VARIABLE_HINTS.map((v) => (
                <button
                  key={v}
                  type="button"
                  disabled={submitting}
                  onClick={() => setBody((prev) => prev + v)}
                  className="rounded border border-app-accent/30 bg-app-accent/5 px-1.5 py-0.5 font-mono text-xs text-app-accent hover:bg-app-accent/10"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            disabled={submitting}
            rows={8}
            placeholder="<p>Dear {{candidate_name}}, ...</p>"
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 font-mono text-xs text-app-foreground outline-none focus:border-app-accent"
          />
          <p className="mt-1 text-xs text-app-muted">
            Include <span className="font-mono text-app-accent">{'{{acknowledge_link}}'}</span> to embed a trackable joining confirmation button.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-app-border pt-4">
          <Button kind="secondary" type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button kind="primary" type="submit" disabled={submitting}>
            {submitting ? 'Sending...' : 'Send Joining Email'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

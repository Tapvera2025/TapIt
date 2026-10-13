import { useEffect, useState } from 'react';
import { Button, Empty, Loading, Modal, Notice, Page } from '../../../ui/components.js';
import {
  createEmailTemplate,
  deleteEmailTemplate,
  listEmailTemplates,
  updateEmailTemplate,
} from '../api/recruitmentApi.js';
import type { CreateEmailTemplateInput, RecruitmentEmailTemplate, UpdateEmailTemplateInput } from '../types/index.js';

const VARIABLE_HINTS = [
  { variable: '{{candidate_name}}', description: "Candidate's full name" },
  { variable: '{{position_title}}', description: 'Job position title' },
  { variable: '{{joining_date}}', description: 'Expected joining date' },
  { variable: '{{company_name}}', description: 'Your company name' },
  { variable: '{{manager_name}}', description: "Reporting manager's name" },
  { variable: '{{acknowledge_link}}', description: 'Joining confirmation link (required for tracking)' },
];

function TemplateEditorModal({
  template,
  onClose,
  onSaved,
}: {
  readonly template?: RecruitmentEmailTemplate | undefined;
  readonly onClose: () => void;
  readonly onSaved: (t: RecruitmentEmailTemplate) => void;
}): React.JSX.Element {
  const [name, setName] = useState(template?.name ?? '');
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBodyHtml] = useState(template?.body ?? '');
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);

  function buildPreview() {
    return body
      .replace(/\{\{candidate_name\}\}/g, 'Rahul Sharma')
      .replace(/\{\{position_title\}\}/g, 'Senior Backend Engineer')
      .replace(/\{\{joining_date\}\}/g, '01 November 2026')
      .replace(/\{\{company_name\}\}/g, 'Tapvera Technologies')
      .replace(/\{\{manager_name\}\}/g, 'Priya Nair')
      .replace(/\{\{acknowledge_link\}\}/g, '#preview-link');
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Template name is required.');
      return;
    }
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
      if (template) {
        const input: UpdateEmailTemplateInput = {
          name: name.trim(),
          subject: subject.trim(),
          body: body.trim(),
          isDefault,
        };
        const updated = await updateEmailTemplate(template.id, input);
        onSaved(updated);
      } else {
        const input: CreateEmailTemplateInput = {
          name: name.trim(),
          subject: subject.trim(),
          body: body.trim(),
          isDefault,
        };
        const created = await createEmailTemplate(input);
        onSaved(created);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={template ? `Edit Template — ${template.name}` : 'Create Email Template'}
      onClose={onClose}
    >
      <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
        {error && <Notice error>{error}</Notice>}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-app-muted">Template Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={submitting}
              placeholder="e.g. Standard Joining Letter"
              className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-app-muted">Email Subject *</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              disabled={submitting}
              placeholder="e.g. Your Joining Details — {{company_name}}"
              className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent"
            />
          </div>
        </div>

        <div className="rounded-lg border border-app-border bg-app-background p-3">
          <p className="mb-2 text-xs font-semibold text-app-muted">Available Variables</p>
          <div className="flex flex-wrap gap-2">
            {VARIABLE_HINTS.map(({ variable, description }) => (
              <button
                key={variable}
                type="button"
                title={description}
                disabled={submitting}
                onClick={() => setBodyHtml((prev) => prev + variable)}
                className="rounded border border-app-accent/30 bg-app-accent/5 px-2 py-0.5 font-mono text-xs text-app-accent hover:bg-app-accent/10"
              >
                {variable}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-semibold text-app-muted">Email Body (HTML) *</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPreviewMode(false)}
                className={`rounded px-2 py-0.5 text-xs font-semibold transition ${!previewMode ? 'bg-app-accent text-app-on-accent' : 'text-app-muted hover:text-app-foreground'}`}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode(true)}
                className={`rounded px-2 py-0.5 text-xs font-semibold transition ${previewMode ? 'bg-app-accent text-app-on-accent' : 'text-app-muted hover:text-app-foreground'}`}
              >
                Preview
              </button>
            </div>
          </div>
          {previewMode ? (
            <div
              className="min-h-[220px] w-full overflow-auto rounded-lg border border-app-border bg-white p-4 text-sm"
              dangerouslySetInnerHTML={{ __html: buildPreview() }}
            />
          ) : (
            <textarea
              value={body}
              onChange={(e) => setBodyHtml(e.target.value)}
              required
              disabled={submitting}
              rows={10}
              placeholder={`<p>Dear {{candidate_name}},</p>\n<p>We are pleased to invite you to join {{company_name}} as <strong>{{position_title}}</strong>...</p>\n<p>Your joining date is <strong>{{joining_date}}</strong>.</p>\n<p>Please confirm your joining by clicking: <a href="{{acknowledge_link}}">Confirm Joining</a></p>`}
              className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 font-mono text-xs text-app-foreground outline-none focus:border-app-accent"
            />
          )}
        </div>

        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            disabled={submitting}
            className="rounded border-app-border"
          />
          <span className="font-semibold text-app-foreground">Set as default joining email template</span>
          <span className="text-app-muted">(automatically selected when sending joining emails)</span>
        </label>

        <div className="flex justify-end gap-2 border-t border-app-border pt-4">
          <Button kind="secondary" type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button kind="primary" type="submit" disabled={submitting}>
            {submitting ? 'Saving...' : template ? 'Update Template' : 'Create Template'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function EmailTemplatesPage(): React.JSX.Element {
  const [templates, setTemplates] = useState<RecruitmentEmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorTarget, setEditorTarget] = useState<RecruitmentEmailTemplate | null | 'new'>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await listEmailTemplates();
      setTemplates(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load email templates');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleDelete(t: RecruitmentEmailTemplate) {
    if (!confirm('Delete template "' + t.name + '"? This action cannot be undone.')) return;
    setDeleting(t.id);
    try {
      await deleteEmailTemplate(t.id);
      setTemplates((prev) => prev.filter((tmpl) => tmpl.id !== t.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete template');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Page
      eyebrow="People / HR"
      title="Email Templates"
      description="Manage joining email templates. Use {{variables}} for dynamic candidate details. The {{acknowledge_link}} variable embeds a trackable confirmation button."
      action={
        <button
          type="button"
          onClick={() => setEditorTarget('new')}
          className="w-full rounded-xl bg-app-accent px-5 py-2.5 text-center text-sm font-semibold text-app-on-accent shadow-xs transition hover:opacity-90 sm:w-auto"
        >
          + New Template
        </button>
      }
    >
      {error && (
        <div className="mt-6">
          <Notice error>{error}</Notice>
        </div>
      )}

      {loading ? (
        <div className="mt-6">
          <Loading />
        </div>
      ) : templates.length === 0 ? (
        <Empty>
          No email templates yet. Create your first joining email template to get started.
        </Empty>
      ) : (
        <section className="mt-6 rounded-2xl border border-app-border bg-app-surface">
          <div className="hidden border-b border-app-border bg-app-surface-raised px-5 py-3 text-xs font-bold uppercase tracking-wider text-app-muted sm:grid sm:grid-cols-[1fr_2fr_auto_auto] sm:items-center sm:gap-4">
            <span>Template</span>
            <span>Subject</span>
            <span>Default</span>
            <span className="text-right">Actions</span>
          </div>

          <div className="divide-y divide-app-border">
            {templates.map((t) => (
              <div
                key={t.id}
                className={`grid gap-3 px-5 py-4 text-sm sm:grid-cols-[1fr_2fr_auto_auto] sm:items-center sm:gap-4 ${
                  deleting === t.id ? 'pointer-events-none opacity-50' : ''
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-app-foreground">{t.name}</p>
                  <p className="text-xs text-app-muted">
                    Updated {new Date(t.updatedAt).toLocaleDateString()}
                  </p>
                </div>

                <p className="min-w-0 truncate text-xs text-app-muted">{t.subject}</p>

                <div>
                  {t.isDefault ? (
                    <span className="inline-flex items-center rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      ● Default
                    </span>
                  ) : (
                    <span className="text-xs text-app-muted">—</span>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditorTarget(t)}
                    className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-semibold text-app-foreground hover:border-app-accent hover:text-app-accent transition-colors"
                  >
                    Edit
                  </button>
                  {!t.isDefault && (
                    <button
                      type="button"
                      onClick={() => void handleDelete(t)}
                      disabled={deleting === t.id}
                      className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:hover:bg-red-500/10"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {editorTarget !== null && (
        <TemplateEditorModal
          template={editorTarget === 'new' ? undefined : editorTarget}
          onClose={() => setEditorTarget(null)}
          onSaved={(saved) => {
            setTemplates((prev) => {
              const existing = prev.find((t) => t.id === saved.id);
              if (existing) {
                return prev.map((t) => {
                  if (saved.isDefault && t.id !== saved.id) return { ...t, isDefault: false };
                  return t.id === saved.id ? saved : t;
                });
              }
              if (saved.isDefault) {
                return [saved, ...prev.map((t) => ({ ...t, isDefault: false }))];
              }
              return [...prev, saved];
            });
          }}
        />
      )}
    </Page>
  );
}

import { useEffect, useMemo, useState } from 'react';
import {
  ATS_CATEGORY_LABELS,
  ATS_CATEGORY_ORDER,
  ATS_PROTECTED_CRITERION_MESSAGE,
  atsCategoryWeights,
  protectedCriterionTerm,
  type AtsCriteria,
  type AtsCriteriaSettings,
} from '@tapcrm/contracts';
import { Button, Loading, Modal, Notice } from '../../../ui/components.js';
import { getAtsCriteria, saveAtsCriteria } from '../api/recruitmentApi.js';

const MAX_PER_LIST = 30;

function sameValue(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase('en') === b.trim().toLocaleLowerCase('en');
}

/** Chips with a text box: Enter or comma adds, Backspace on an empty box removes the last. */
function CriteriaListInput({
  label,
  hint,
  values,
  onChange,
  placeholder,
  validate,
  disabled,
}: {
  readonly label: string;
  readonly hint: string;
  readonly values: readonly string[];
  readonly onChange: (values: string[]) => void;
  readonly placeholder: string;
  readonly validate: (value: string, current: readonly string[]) => string | null;
  readonly disabled: boolean;
}): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  function add(raw: string): boolean {
    const parts = raw.split(/[,\n;]/).map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
    let next = [...values];
    for (const part of parts) {
      if (next.some((value) => sameValue(value, part))) continue;
      const problem = validate(part, next);
      if (problem) {
        setError(problem);
        return false;
      }
      if (next.length >= MAX_PER_LIST) {
        setError(`Up to ${MAX_PER_LIST} entries per list.`);
        return false;
      }
      next = [...next, part.slice(0, 120)];
    }
    onChange(next);
    setError(null);
    return true;
  }

  return (
    <div>
      <p className="text-xs font-semibold text-app-muted">{label}</p>
      <p className="mt-0.5 text-[11px] text-app-muted">{hint}</p>
      <div
        className={`mt-2 flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border bg-app-background px-2 py-1.5 focus-within:border-app-accent ${error ? 'border-app-danger' : 'border-app-border'}`}
      >
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded-md border border-app-border bg-app-surface-raised px-2 py-0.5 text-xs font-medium text-app-foreground"
          >
            {value}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(values.filter((item) => item !== value))}
              className="rounded px-0.5 text-app-muted hover:text-app-danger"
              aria-label={`Remove ${value}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          disabled={disabled}
          aria-label={label}
          placeholder={values.length === 0 ? placeholder : 'Add another…'}
          onChange={(event) => {
            const next = event.target.value;
            if (/[,;]/.test(next)) {
              if (add(next)) setDraft('');
              else setDraft(next.replace(/[,;]/g, ''));
              return;
            }
            setDraft(next);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (draft.trim() && add(draft)) setDraft('');
            } else if (event.key === 'Backspace' && draft === '' && values.length > 0) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (draft.trim() && add(draft)) setDraft('');
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text');
            if (/[,\n;]/.test(text)) {
              event.preventDefault();
              if (add(text)) setDraft('');
            }
          }}
          className="min-w-[10rem] flex-1 bg-transparent px-1 py-1 text-sm text-app-foreground outline-none"
        />
      </div>
      {error && (
        <p className="mt-1 text-xs text-app-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function protectedProblem(value: string): string | null {
  const term = protectedCriterionTerm(value);
  return term ? `“${term}” describes a person, not the job. ${ATS_PROTECTED_CRITERION_MESSAGE}` : null;
}

/**
 * Edits the screening criteria of one job. Every application to the job is
 * scored against the same criteria, and each scan keeps a copy of them.
 */
export function AtsCriteriaModal({
  requisitionId,
  requisitionLabel,
  initial,
  saveLabel = 'Save criteria',
  onClose,
  onSaved,
}: {
  readonly requisitionId: string;
  readonly requisitionLabel: string;
  readonly initial?: AtsCriteriaSettings | undefined;
  readonly saveLabel?: string | undefined;
  readonly onClose: () => void;
  readonly onSaved: (settings: AtsCriteriaSettings) => void;
}): React.JSX.Element {
  const [settings, setSettings] = useState<AtsCriteriaSettings | null>(initial ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [requiredSkills, setRequiredSkills] = useState<string[]>([...(initial?.criteria.requiredSkills ?? [])]);
  const [preferredSkills, setPreferredSkills] = useState<string[]>([...(initial?.criteria.preferredSkills ?? [])]);
  const [qualifications, setQualifications] = useState<string[]>([...(initial?.criteria.requiredQualifications ?? [])]);
  const [years, setYears] = useState(initial?.criteria.minimumExperienceYears?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    let active = true;
    getAtsCriteria(requisitionId)
      .then((loaded) => {
        if (!active) return;
        setSettings(loaded);
        setRequiredSkills([...loaded.criteria.requiredSkills]);
        setPreferredSkills([...loaded.criteria.preferredSkills]);
        setQualifications([...loaded.criteria.requiredQualifications]);
        setYears(loaded.criteria.minimumExperienceYears?.toString() ?? '');
      })
      .catch((cause: unknown) => {
        if (active) setLoadError(cause instanceof Error ? cause.message : 'Unable to load the screening criteria.');
      });
    return () => {
      active = false;
    };
  }, [initial, requisitionId]);

  const parsedYears = years.trim() === '' ? null : Number(years);
  const yearsInvalid = parsedYears !== null && (!Number.isFinite(parsedYears) || parsedYears < 0 || parsedYears > 50);
  const criteria: AtsCriteria = {
    requiredSkills,
    preferredSkills,
    minimumExperienceYears: parsedYears !== null && parsedYears > 0 && !yearsInvalid ? parsedYears : null,
    requiredQualifications: qualifications,
  };
  const hasRequirement = requiredSkills.length > 0 || qualifications.length > 0 || (criteria.minimumExperienceYears ?? 0) > 0;

  const dirty = useMemo(() => {
    if (!settings) return false;
    const original = settings.criteria;
    return JSON.stringify([original.requiredSkills, original.preferredSkills, original.requiredQualifications, original.minimumExperienceYears ?? null])
      !== JSON.stringify([requiredSkills, preferredSkills, qualifications, criteria.minimumExperienceYears]);
  }, [settings, requiredSkills, preferredSkills, qualifications, criteria.minimumExperienceYears]);

  const weights = useMemo(() => {
    const used = ATS_CATEGORY_ORDER.filter((category) =>
      category === 'required_skills' ? requiredSkills.length > 0
        : category === 'experience' ? (criteria.minimumExperienceYears ?? 0) > 0
          : category === 'qualifications' ? qualifications.length > 0
            : preferredSkills.length > 0);
    const shares = atsCategoryWeights(used);
    return used.map((category) => ({ category, label: ATS_CATEGORY_LABELS[category], share: shares.get(category) ?? 0 }));
  }, [requiredSkills.length, preferredSkills.length, qualifications.length, criteria.minimumExperienceYears]);

  async function handleSave() {
    if (!hasRequirement) {
      setError('Add at least one required skill, qualification or minimum years of experience.');
      return;
    }
    if (yearsInvalid) {
      setError('Minimum experience must be a number of years between 0 and 50.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await saveAtsCriteria(requisitionId, criteria);
      onSaved(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save the screening criteria.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`ATS criteria — ${requisitionLabel}`}
      onClose={onClose}
      dirty={dirty}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button kind="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button kind="primary" onClick={() => void handleSave()} disabled={saving || !settings}>
            {saving ? 'Saving…' : saveLabel}
          </Button>
        </div>
      }
    >
      {loadError ? (
        <Notice error>{loadError}</Notice>
      ) : !settings ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          {!settings.configured && (
            <Notice>
              Suggested from the job description. Review and adjust before saving — nothing is screened until you save.
            </Notice>
          )}
          {error && <Notice error>{error}</Notice>}

          <CriteriaListInput
            label="Required skills"
            hint="Must-haves. Missing ones are flagged on every report."
            values={requiredSkills}
            onChange={setRequiredSkills}
            placeholder="e.g. React, Node.js, SQL"
            disabled={saving}
            validate={(value) => protectedProblem(value)}
          />

          <CriteriaListInput
            label="Preferred skills"
            hint="Nice-to-haves that add points but are never required."
            values={preferredSkills}
            onChange={setPreferredSkills}
            placeholder="e.g. AWS, GraphQL"
            disabled={saving}
            validate={(value) =>
              protectedProblem(value)
              ?? (requiredSkills.some((skill) => sameValue(skill, value)) ? `${value} is already a required skill.` : null)}
          />

          <div className="grid gap-5 sm:grid-cols-[1fr_2fr]">
            <label className="block text-xs font-semibold text-app-muted">
              <span className="mb-0.5 block">Minimum experience (years)</span>
              <span className="mb-2 block text-[11px] font-normal">Measured from employment dates; leave empty for none.</span>
              <input
                type="number"
                min={0}
                max={50}
                step={0.5}
                inputMode="decimal"
                value={years}
                disabled={saving}
                onChange={(event) => setYears(event.target.value)}
                placeholder="e.g. 3"
                className={`w-full rounded-lg border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent ${yearsInvalid ? 'border-app-danger' : 'border-app-border'}`}
              />
            </label>
            <CriteriaListInput
              label="Required qualifications"
              hint="Degrees or certifications, e.g. “B.Tech in Computer Science”, “MBA”, “PMP”."
              values={qualifications}
              onChange={setQualifications}
              placeholder="e.g. Bachelor's degree"
              disabled={saving}
              validate={(value) => protectedProblem(value)}
            />
          </div>

          <div className="rounded-xl border border-app-border bg-app-surface-raised p-4 text-xs text-app-muted">
            <p className="font-semibold text-app-foreground">How the score is weighted</p>
            {weights.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {weights.map((weight) => (
                  <li key={weight.category}>
                    {weight.label} <span className="font-semibold tabular-nums text-app-foreground">{weight.share}%</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2">Add criteria to see how the 100 points are shared.</p>
            )}
            <p className="mt-3">
              Use job-related requirements only. Personal characteristics — age, gender, marital status, religion,
              caste, health and similar — are refused. Every application to this job is measured against the same
              criteria, and each report keeps a copy of the criteria it used.
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}

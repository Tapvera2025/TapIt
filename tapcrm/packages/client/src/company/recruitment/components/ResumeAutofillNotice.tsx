import type { ParsedCandidateData } from '@tapcrm/contracts';
import { useEffect, useState } from 'react';
import { Icon } from '../../../ui/Icon.js';
import {
  formatYears,
  resumeHighlights,
  shortUrl,
  type AutofillField,
  type AutofillState,
} from '../resumeAutofill.js';

export type ResumeReadStatus = 'idle' | 'reading' | 'done' | 'failed';

const FIELD_NAMES: Readonly<Record<'name' | 'email' | 'phone', string>> = { name: 'name', email: 'email', phone: 'phone' };

/** Typed resumes are read in about a second; past this, it is probably a scan. */
const SLOW_READ_MS = 2500;

function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/**
 * What reading the resume did to the form: which fields it filled, what it
 * could not find, and a few facts (latest role, experience, skills, links) to
 * check the form against. Reading happens on our servers; nothing is sent to
 * an outside AI service.
 */
export function ResumeAutofillNotice({
  status,
  parsed,
  state,
}: {
  readonly status: ResumeReadStatus;
  readonly parsed: ParsedCandidateData | null;
  readonly state: AutofillState;
}): React.JSX.Element | null {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (status !== 'reading') return undefined;
    const timer = setTimeout(() => setSlow(true), SLOW_READ_MS);
    return () => clearTimeout(timer);
  }, [status]);

  if (status === 'idle') return null;
  if (status === 'reading') {
    return (
      <div role="status" className="flex items-center gap-2 rounded-lg border border-app-border bg-app-surface-raised px-3 py-2 text-xs text-app-muted">
        <span className="inline-block size-3 shrink-0 animate-spin rounded-full border-2 border-app-border border-t-app-accent" />
        {slow
          ? 'Still reading. A scanned resume is read with text recognition, which takes a few seconds per page…'
          : "Reading the resume to fill in the candidate's details…"}
      </div>
    );
  }
  if (status === 'failed' || !parsed) {
    return (
      <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
        This resume could not be read automatically. Type the candidate's details below.
      </div>
    );
  }

  const filled = new Set(Object.keys(state.filled) as AutofillField[]);
  const found: string[] = [];
  const missing: string[] = [];
  // A value that was read but not filled in (unsure, or HR typed something else) is a suggestion under its field.
  const report = (label: string, wasFilled: boolean, value: string | null) => {
    if (wasFilled) found.push(label);
    else if (!value) missing.push(label);
  };
  report(FIELD_NAMES.name, filled.has('firstName') || filled.has('lastName'), parsed.name);
  report(FIELD_NAMES.email, filled.has('email'), parsed.email);
  report(FIELD_NAMES.phone, filled.has('phone'), parsed.phone);
  const highlights = resumeHighlights(parsed);
  // For a scan the first note is the "read with OCR" one, said in the summary line instead.
  const warning = parsed.warnings?.[parsed.ocr ? 1 : 0];

  return (
    <div role="status" className="space-y-2 rounded-lg border border-app-border bg-app-surface-raised px-3 py-2.5 text-xs text-app-muted">
      {found.length > 0 ? (
        <p className="flex items-start gap-1.5 text-app-foreground">
          <Icon name="check" className="mt-px size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>
            {parsed.ocr
              ? <>Filled in the {listOf(found)} by reading the scanned resume (OCR) — check each one before you save.</>
              : <>Filled in the {listOf(found)} from the resume — check before you save.</>}
            {missing.length > 0 && <span className="text-app-muted"> No {listOf(missing)} found on it.</span>}
          </span>
        </p>
      ) : (
        <p className="text-app-foreground">
          {missing.length === 3
            ? "No contact details could be read from this resume. Type the candidate's details below."
            : 'Nothing was filled in automatically; see the suggestions under the fields.'}
          {parsed.ocr && <span className="text-app-muted"> It was read from a scanned image (OCR).</span>}
        </p>
      )}
      {warning && <p className="text-amber-700 dark:text-amber-300">{warning}</p>}
      {(highlights.role || highlights.experienceYears !== null || highlights.skills.length > 0 || highlights.links.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-app-border pt-2">
          {highlights.role && <span className="text-app-foreground">{highlights.role}</span>}
          {highlights.experienceYears !== null && highlights.experienceYears > 0 && (
            <span>{formatYears(highlights.experienceYears)} experience</span>
          )}
          {highlights.skills.length > 0 && (
            <span className="flex flex-wrap gap-1">
              {highlights.skills.map((skill) => (
                <span key={skill} className="rounded border border-app-border px-1.5 py-0.5 text-[11px] text-app-foreground">{skill}</span>
              ))}
            </span>
          )}
          {highlights.links.map((link) => (
            <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" className="text-app-accent hover:underline">
              {link.label}: {shortUrl(link.href)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The line under a form field: where its value came from, or a value the
 * resume suggests with a button to use it. Null when there is nothing to say.
 */
export function autofillHint(
  state: AutofillState,
  field: AutofillField,
  onUse: (field: AutofillField) => void,
  /** Shown instead of the bare suggestion, e.g. the whole name for a name field. */
  suggestionLabel?: string,
): React.JSX.Element | null {
  const suggestion = state.suggestions[field];
  if (suggestion !== undefined) {
    return (
      <span className="flex flex-wrap items-center gap-1 text-app-muted">
        Resume says <span className="text-app-foreground">{suggestionLabel ?? suggestion}</span>
        <button type="button" onClick={() => onUse(field)} className="font-semibold text-app-accent hover:underline">
          Use
        </button>
      </span>
    );
  }
  const confidence = state.filled[field];
  if (!confidence) return null;
  return (
    <span className={confidence === 'high' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-300'}>
      {confidence === 'high' ? 'From the resume' : 'From the resume — please check'}
    </span>
  );
}

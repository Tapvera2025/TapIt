import type { DeliveryBriefContent } from './api.js';

/**
 * Canonical section order and labels. Mirrors the shape documented in
 * the server's `DeliveryBriefContent` interface; sections not covered
 * here can still live in the jsonb and are preserved on write.
 */
export const BRIEF_SECTIONS: ReadonlyArray<{ key: string; label: string; hint: string }> = [
  {
    key: 'customerContacts',
    label: 'Customer contacts',
    hint: 'Primary contact, decision-maker, billing contact — one per line.',
  },
  {
    key: 'agreedServices',
    label: 'Agreed services',
    hint: 'Scope summary of what Sales has committed to delivering.',
  },
  {
    key: 'deliverables',
    label: 'Deliverables',
    hint: 'Concrete artefacts the customer expects by the end of the engagement.',
  },
  {
    key: 'exclusions',
    label: 'Exclusions',
    hint: 'Explicit boundaries — what is NOT in scope.',
  },
  {
    key: 'promisedDates',
    label: 'Promised dates',
    hint: 'Any date commitments Sales made (start, phase milestones, launch).',
  },
  {
    key: 'dependencies',
    label: 'Dependencies',
    hint: 'Upstream blockers (customer-side or internal) delivery must plan around.',
  },
  {
    key: 'customerAssets',
    label: 'Customer assets',
    hint: 'Materials the customer has agreed to supply (brand, access, data).',
  },
  {
    key: 'accessReadiness',
    label: 'Access readiness',
    hint: 'Credentials, environments, approvals delivery needs on day 1.',
  },
  {
    key: 'outstandingQuestions',
    label: 'Outstanding questions',
    hint: 'Open items Sales has not resolved; delivery will pick these up.',
  },
  {
    key: 'paymentReadiness',
    label: 'Payment readiness',
    hint: 'Advance status, PO numbers, invoicing cadence agreed.',
  },
  {
    key: 'notes',
    label: 'Notes',
    hint: 'Anything else delivery should know on day 1.',
  },
];

export interface BriefSectionsProps {
  readonly content: DeliveryBriefContent;
  readonly readOnly: boolean;
  readonly onChange: (next: DeliveryBriefContent) => void;
}

/**
 * Section-by-section editor. Each section is a free-form multiline text
 * field; the jsonb preserves unknown keys the caller might have added
 * out-of-band (see `extraSections` below).
 */
export function BriefSections({ content, readOnly, onChange }: BriefSectionsProps): React.JSX.Element {
  const knownKeys = new Set(BRIEF_SECTIONS.map((s) => s.key));
  const extraSections = Object.keys(content).filter((key) => !knownKeys.has(key));

  function patch(key: string, value: string): void {
    const next: DeliveryBriefContent = { ...content };
    if (value.trim() === '') {
      delete next[key];
    } else {
      next[key] = value;
    }
    onChange(next);
  }

  return (
    <div className="space-y-5">
      {BRIEF_SECTIONS.map((section) => (
        <SectionEditor
          key={section.key}
          label={section.label}
          hint={section.hint}
          value={getStringValue(content[section.key])}
          readOnly={readOnly}
          onChange={(value) => patch(section.key, value)}
        />
      ))}
      {extraSections.length > 0 && (
        <div className="rounded-lg border border-dashed border-app-border p-3 text-xs text-app-muted">
          Additional fields on this brief: {extraSections.join(', ')}
        </div>
      )}
    </div>
  );
}

function SectionEditor({
  label,
  hint,
  value,
  readOnly,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <label className="block text-xs font-semibold text-app-muted">
      <span className="mb-1 block">{label}</span>
      <span className="mb-2 block font-normal text-app-muted">{hint}</span>
      <textarea
        value={value}
        disabled={readOnly}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[80px] w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground"
      />
    </label>
  );
}

function getStringValue(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'bigint') {
    return String(raw);
  }
  // Preserve non-string values round-tripping by rendering them as JSON.
  // JSON.stringify throws only on circular refs; show a tag the UI can detect
  // rather than falling back to String(obj), which prints '[object Object]'.
  try {
    return JSON.stringify(raw, null, 2);
  } catch {
    return '[unserializable value]';
  }
}

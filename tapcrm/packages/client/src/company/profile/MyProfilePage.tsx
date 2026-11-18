import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Card, ConfirmDiscardModal, Field, Notice, Select, SkeletonCard, WorkspacePageContainer } from '../../ui/index.js';
import { Icon } from '../../ui/index.js';
import {
  getMyDocumentDownloadUrl,
  removeMyDocument,
  saveMyEducation,
  saveMyExperience,
  saveMyPersonalDetails,
  saveMySkills,
  uploadMyDocument,
  type ExperienceEntry,
  type MyProfile,
  type ProfileDocument,
  type ProfileSection,
  type QualificationEntry,
  type SkillEntry,
  type SkillProficiency,
} from '../api/myProfileApi.js';
import { DOCUMENT_TYPE_LABELS, VERIFICATION_DOCUMENT_TYPES, type VerificationDocumentType } from '../api/verificationApi.js';
import {
  PHONE_COUNTRY_OPTIONS,
  formatFullPhone,
  phoneError,
  sanitizePhoneInput,
  splitPhoneAndCountryCode,
} from '../employees/phone.js';
import { ProfileCompletionBar } from './ProfileCompletionRing.js';
import { setMyProfile, useMyProfile } from './myProfileStore.js';
import { ErrorToast } from '../../ui/ErrorToast.js';

/**
 * My Profile — where an employee completes, at their own pace, everything HR
 * did not enter when creating the account. Each section saves on its own.
 */

type Details = Extract<MyProfile, { applicable: true }>;

const SECTIONS: { key: ProfileSection; title: string; hint: string }[] = [
  { key: 'personal', title: 'Personal details', hint: 'Date of birth, gender and phone' },
  { key: 'address', title: 'Address', hint: 'Where you live now' },
  { key: 'emergency', title: 'Emergency contact', hint: 'Who to call if something happens' },
  { key: 'education', title: 'Education', hint: 'Degrees and certificates' },
  { key: 'experience', title: 'Work experience', hint: 'Previous jobs, or tell us this is your first' },
  { key: 'skills', title: 'Skills', hint: 'What you are good at' },
  { key: 'documents', title: 'Documents', hint: 'ID proofs, certificates and letters' },
];

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const ACCEPTED_DOCUMENTS = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx';

function sectionStatus(details: Details, section: ProfileSection): { done: number; total: number } {
  const items = details.completion.items.filter((item) => item.section === section);
  return { done: items.filter((item) => item.state === 'done').length, total: items.length };
}

function nextIncomplete(details: Details, after: ProfileSection | null): ProfileSection | null {
  const start = after === null ? 0 : SECTIONS.findIndex((s) => s.key === after) + 1;
  const ordered = [...SECTIONS.slice(start), ...SECTIONS.slice(0, start)];
  const found = ordered.find(({ key }) => {
    const { done, total } = sectionStatus(details, key);
    return total > 0 && done < total;
  });
  return found?.key ?? null;
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function MyProfilePage({ onNavigate }: { onNavigate: (path: string) => void }): React.JSX.Element {
  const { profile, loading, error } = useMyProfile(true);
  const [active, setActive] = useState<ProfileSection | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingSection, setPendingSection] = useState<ProfileSection | null>(null);

  useEffect(() => {
    if (active === null && profile && profile.applicable) {
      setActive(nextIncomplete(profile, null) ?? 'personal');
    }
  }, [active, profile]);

  if (loading && !profile) {
    return (
      <WorkspacePageContainer>
        <SkeletonCard className="h-40" />
        <SkeletonCard className="mt-4 h-96" />
      </WorkspacePageContainer>
    );
  }
  if (error && !profile) {
    return (
      <WorkspacePageContainer>
        <ErrorToast message={error} />
      </WorkspacePageContainer>
    );
  }
  if (!profile || !profile.applicable) {
    return (
      <WorkspacePageContainer>
        <Card>
          <p className="text-sm text-app-muted">
            There is no employee profile to complete for this account.
          </p>
        </Card>
      </WorkspacePageContainer>
    );
  }

  const details = profile;
  const current = active ?? 'personal';

  const choose = (section: ProfileSection) => {
    if (section === current) return;
    if (dirty) setPendingSection(section);
    else setActive(section);
  };

  const onSaved = (next: MyProfile, advance: boolean) => {
    setMyProfile(next);
    setDirty(false);
    toast.success('Saved');
    if (advance && next.applicable) {
      const following = nextIncomplete(next, current);
      if (following) setActive(following);
      else toast.success('Your profile is complete. Thank you!');
    }
  };

  return (
    <WorkspacePageContainer>
      <ProfileHeader details={details} onSkip={() => onNavigate('/company/dashboard')} />

      <div className="mt-4 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav aria-label="Profile sections" className="ui-card h-fit p-2">
          {SECTIONS.map((section) => {
            const { done, total } = sectionStatus(details, section.key);
            const complete = total > 0 && done === total;
            const selected = section.key === current;
            return (
              <button
                key={section.key}
                type="button"
                onClick={() => choose(section.key)}
                aria-current={selected ? 'step' : undefined}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                  selected ? 'bg-app-accent/10 text-app-foreground' : 'text-app-muted hover:bg-app-surface-raised'
                }`}
              >
                <span
                  className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                    complete ? 'bg-emerald-500 text-white' : 'border border-app-border bg-app-surface text-app-muted'
                  }`}
                >
                  {complete ? '✓' : SECTIONS.indexOf(section) + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{section.title}</span>
                  <span className="block truncate text-[11px] text-app-muted">
                    {section.key === 'documents' ? `${done} of ${total} uploaded` : complete ? 'Done' : 'To do'}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        <Card className="min-w-0">
          <div className="mb-4">
            <h2 className="font-display text-lg font-bold text-app-foreground">
              {SECTIONS.find((s) => s.key === current)?.title}
            </h2>
            <p className="text-xs text-app-muted">{SECTIONS.find((s) => s.key === current)?.hint}</p>
          </div>
          {current === 'personal' && <PersonalEditor key="personal" details={details} onDirty={setDirty} onSaved={onSaved} />}
          {current === 'address' && <AddressEditor key="address" details={details} onDirty={setDirty} onSaved={onSaved} />}
          {current === 'emergency' && <EmergencyEditor key="emergency" details={details} onDirty={setDirty} onSaved={onSaved} />}
          {current === 'education' && <EducationEditor key="education" details={details} onDirty={setDirty} onSaved={onSaved} />}
          {current === 'experience' && <ExperienceEditor key="experience" details={details} onDirty={setDirty} onSaved={onSaved} />}
          {current === 'skills' && <SkillsEditor key="skills" details={details} onDirty={setDirty} onSaved={onSaved} />}
          {current === 'documents' && <DocumentsEditor key="documents" details={details} onSaved={(next) => onSaved(next, false)} />}
        </Card>
      </div>

      <ConfirmDiscardModal
        isOpen={pendingSection !== null}
        title="Discard unsaved changes?"
        description="You changed this section but did not save it."
        discardText="Discard"
        continueText="Keep editing"
        onDiscard={() => {
          setDirty(false);
          setActive(pendingSection);
          setPendingSection(null);
        }}
        onContinue={() => setPendingSection(null)}
      />
    </WorkspacePageContainer>
  );
}

function ProfileHeader({ details, onSkip }: { details: Details; onSkip: () => void }): React.JSX.Element {
  const { work, completion } = details;
  const facts: [string, string | null][] = [
    ['Employee ID', work.employeeId],
    ['Department', work.departmentName],
    ['Position', work.positionName],
    ['Team', work.teamName],
    ['Reports to', work.reportsToName],
    ['Joining date', work.joinedOn],
    ['Work email', work.email],
  ];
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-app-accent">My profile</p>
          <h1 className="mt-1 font-display text-xl font-bold tracking-[-0.035em]">{work.fullName}</h1>
          <p className="mt-1 text-sm text-app-muted">
            {completion.percent >= 100
              ? 'Your profile is complete. HR reviews your documents in the background.'
              : 'Fill in the rest of your details. You can save a section and come back later.'}
          </p>
        </div>
        {completion.percent < 100 && (
          <Button kind="secondary" onClick={onSkip}>
            Skip for later
          </Button>
        )}
      </div>
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-xs font-semibold">
          <span className="text-app-muted">
            {completion.completedCount} of {completion.totalCount} done
          </span>
          <span className="text-app-foreground">{completion.percent}%</span>
        </div>
        <ProfileCompletionBar percent={completion.percent} />
      </div>
      <dl className="mt-4 grid gap-3 border-t border-app-border/70 pt-4 text-xs sm:grid-cols-3 lg:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="font-semibold uppercase tracking-[0.1em] text-app-muted">{label}</dt>
            <dd className="mt-0.5 truncate text-sm font-medium text-app-foreground">{value || '—'}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[11px] text-app-muted">These work details are set by HR. Ask HR if any of them is wrong.</p>
    </Card>
  );
}

interface EditorProps {
  details: Details;
  onDirty: (dirty: boolean) => void;
  onSaved: (next: MyProfile, advance: boolean) => void;
}

/** Save / Save & continue buttons with one busy state. */
function EditorFooter({
  busy,
  onSave,
}: {
  busy: boolean;
  onSave: (advance: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-app-border/70 pt-4">
      <Button kind="secondary" disabled={busy} onClick={() => onSave(false)}>
        Save
      </Button>
      <Button disabled={busy} onClick={() => onSave(true)}>
        {busy ? 'Saving…' : 'Save & continue'}
      </Button>
    </div>
  );
}

function useDirty<T>(value: T, onDirty: (dirty: boolean) => void): (baseline: T) => void {
  const baseline = useRef(JSON.stringify(value));
  const json = JSON.stringify(value);
  useEffect(() => {
    onDirty(json !== baseline.current);
  }, [json, onDirty]);
  return (next: T) => {
    baseline.current = JSON.stringify(next);
  };
}

function PhoneInput({
  id,
  label,
  countryCode,
  number,
  onChange,
  error,
}: {
  id: string;
  label: string;
  countryCode: string;
  number: string;
  onChange: (countryCode: string, number: string) => void;
  error?: string | null;
}): React.JSX.Element {
  return (
    <div className="text-xs font-semibold text-app-muted">
      <label htmlFor={id} className="mb-2 block">
        {label}
      </label>
      <div className="flex gap-2">
        <select
          aria-label={`${label} country code`}
          value={countryCode}
          onChange={(event) => onChange(event.target.value, number)}
          className="ui-form-control w-28 shrink-0 px-2 py-2.5 text-sm outline-none"
        >
          {PHONE_COUNTRY_OPTIONS.map((option) => (
            <option key={`${option.country}-${option.code}`} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          id={id}
          type="tel"
          value={number}
          onChange={(event) => {
            const value = event.target.value;
            if (value.startsWith('+')) {
              const parsed = splitPhoneAndCountryCode(value, countryCode);
              onChange(parsed.countryCode, sanitizePhoneInput(parsed.nationalNumber));
            } else {
              onChange(countryCode, sanitizePhoneInput(value));
            }
          }}
          placeholder="98765 43210"
          className="ui-form-control min-w-0 flex-1 px-3 py-2.5 text-sm outline-none"
        />
      </div>
      {error && <ErrorToast message={error} />}
    </div>
  );
}

const GENDERS = ['Male', 'Female', 'Non-Binary', 'Prefer not to say'];

function PersonalEditor({ details, onDirty, onSaved }: EditorProps): React.JSX.Element {
  const initialPhone = splitPhoneAndCountryCode(details.personal.phone ?? '');
  const [form, setForm] = useState({
    dateOfBirth: details.personal.dateOfBirth ?? '',
    gender: details.personal.gender ?? '',
    phoneCode: initialPhone.countryCode,
    phone: initialPhone.nationalNumber,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const resetDirty = useDirty(form, onDirty);

  async function save(advance: boolean): Promise<void> {
    const next: Record<string, string> = {};
    if (form.dateOfBirth) {
      const dob = new Date(`${form.dateOfBirth}T00:00:00`);
      const limit = new Date();
      limit.setFullYear(limit.getFullYear() - 16);
      if (Number.isNaN(dob.getTime())) next['dateOfBirth'] = 'Enter a valid date.';
      else if (dob > new Date()) next['dateOfBirth'] = 'Date of birth cannot be in the future.';
      else if (dob > limit) next['dateOfBirth'] = 'You must be at least 16 years old.';
    }
    const fullPhone = formatFullPhone(form.phoneCode, form.phone);
    const phoneProblem = phoneError(fullPhone, false);
    if (phoneProblem) next['phone'] = phoneProblem;
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      const saved = await saveMyPersonalDetails({
        dateOfBirth: form.dateOfBirth || null,
        gender: form.gender || null,
        phone: fullPhone || null,
      });
      resetDirty(form);
      onSaved(saved, advance);
    } catch (cause) {
      toast.error(message(cause, 'Unable to save your personal details.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Date of birth"
          type="date"
          value={form.dateOfBirth}
          onChange={(value) => setForm((f) => ({ ...f, dateOfBirth: value }))}
          error={errors['dateOfBirth']}
        />
        <Select
          label="Gender"
          value={form.gender}
          onChange={(value) => setForm((f) => ({ ...f, gender: value }))}
          options={GENDERS.map((g) => ({ value: g, label: g }))}
        />
        <PhoneInput
          id="profile-phone"
          label="Phone number"
          countryCode={form.phoneCode}
          number={form.phone}
          onChange={(phoneCode, phone) => setForm((f) => ({ ...f, phoneCode, phone }))}
          error={errors['phone'] ?? null}
        />
      </div>
      <EditorFooter busy={busy} onSave={(advance) => void save(advance)} />
    </div>
  );
}

function AddressEditor({ details, onDirty, onSaved }: EditorProps): React.JSX.Element {
  const p = details.personal;
  const [form, setForm] = useState({
    addressLine1: p.addressLine1 ?? '',
    addressLine2: p.addressLine2 ?? '',
    city: p.city ?? '',
    state: p.state ?? '',
    postalCode: p.postalCode ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const resetDirty = useDirty(form, onDirty);

  async function save(advance: boolean): Promise<void> {
    const next: Record<string, string> = {};
    if (form.postalCode.trim() && !/^[A-Za-z0-9 -]{3,20}$/.test(form.postalCode.trim())) {
      next['postalCode'] = 'Enter a valid postal code.';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      const saved = await saveMyPersonalDetails({
        addressLine1: form.addressLine1.trim() || null,
        addressLine2: form.addressLine2.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        postalCode: form.postalCode.trim() || null,
      });
      resetDirty(form);
      onSaved(saved, advance);
    } catch (cause) {
      toast.error(message(cause, 'Unable to save your address.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Address line 1" value={form.addressLine1} onChange={(v) => setForm((f) => ({ ...f, addressLine1: v }))} placeholder="House / flat, street" />
        </div>
        <div className="sm:col-span-2">
          <Field label="Address line 2 (optional)" value={form.addressLine2} onChange={(v) => setForm((f) => ({ ...f, addressLine2: v }))} placeholder="Area, landmark" />
        </div>
        <Field label="City" value={form.city} onChange={(v) => setForm((f) => ({ ...f, city: v }))} />
        <Field label="State" value={form.state} onChange={(v) => setForm((f) => ({ ...f, state: v }))} />
        <Field
          label="Postal code"
          value={form.postalCode}
          onChange={(v) => setForm((f) => ({ ...f, postalCode: v }))}
          error={errors['postalCode']}
        />
      </div>
      <p className="mt-3 text-[11px] text-app-muted">Line 1, city, state and postal code are needed for this section to count as done.</p>
      <EditorFooter busy={busy} onSave={(advance) => void save(advance)} />
    </div>
  );
}

function EmergencyEditor({ details, onDirty, onSaved }: EditorProps): React.JSX.Element {
  const p = details.personal;
  const initialPhone = splitPhoneAndCountryCode(p.emergencyContactPhone ?? '');
  const [form, setForm] = useState({
    name: p.emergencyContactName ?? '',
    relation: p.emergencyContactRelation ?? '',
    phoneCode: initialPhone.countryCode,
    phone: initialPhone.nationalNumber,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const resetDirty = useDirty(form, onDirty);

  async function save(advance: boolean): Promise<void> {
    const fullPhone = formatFullPhone(form.phoneCode, form.phone);
    const next: Record<string, string> = {};
    const phoneProblem = phoneError(fullPhone, false);
    if (phoneProblem) next['phone'] = phoneProblem;
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      const saved = await saveMyPersonalDetails({
        emergencyContactName: form.name.trim() || null,
        emergencyContactRelation: form.relation.trim() || null,
        emergencyContactPhone: fullPhone || null,
      });
      resetDirty(form);
      onSaved(saved, advance);
    } catch (cause) {
      toast.error(message(cause, 'Unable to save your emergency contact.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
        <Field label="Relationship" value={form.relation} onChange={(v) => setForm((f) => ({ ...f, relation: v }))} placeholder="e.g. Father, Spouse" />
        <PhoneInput
          id="profile-emergency-phone"
          label="Phone number"
          countryCode={form.phoneCode}
          number={form.phone}
          onChange={(phoneCode, phone) => setForm((f) => ({ ...f, phoneCode, phone }))}
          error={errors['phone'] ?? null}
        />
      </div>
      <EditorFooter busy={busy} onSave={(advance) => void save(advance)} />
    </div>
  );
}

interface QualificationDraft {
  institution: string;
  degree: string;
  fieldOfStudy: string;
  passingYear: string;
  grade: string;
}

const emptyQualification = (): QualificationDraft => ({ institution: '', degree: '', fieldOfStudy: '', passingYear: '', grade: '' });

function EducationEditor({ details, onDirty, onSaved }: EditorProps): React.JSX.Element {
  const [rows, setRows] = useState<QualificationDraft[]>(() =>
    details.qualifications.length > 0
      ? details.qualifications.map((q) => ({
          institution: q.institution,
          degree: q.degree,
          fieldOfStudy: q.fieldOfStudy ?? '',
          passingYear: q.passingYear === null ? '' : String(q.passingYear),
          grade: q.grade ?? '',
        }))
      : [emptyQualification()],
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const resetDirty = useDirty(rows, onDirty);
  const thisYear = new Date().getFullYear();

  const update = (index: number, patch: Partial<QualificationDraft>) =>
    setRows((list) => list.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  async function save(advance: boolean): Promise<void> {
    const filled = rows.filter((row) => (Object.values(row) as string[]).some((v) => v.trim() !== ''));
    for (const row of filled) {
      if (!row.institution.trim() || !row.degree.trim()) {
        setError('Each entry needs an institution and a degree. Remove the ones you do not need.');
        return;
      }
      if (row.passingYear.trim()) {
        const year = Number(row.passingYear);
        if (!/^\d{4}$/.test(row.passingYear.trim()) || year < 1950 || year > thisYear + 10) {
          setError(`Passing year must be a 4-digit year between 1950 and ${thisYear + 10}.`);
          return;
        }
      }
    }
    setError('');
    setBusy(true);
    try {
      const entries: QualificationEntry[] = filled.map((row) => ({
        institution: row.institution.trim(),
        degree: row.degree.trim(),
        fieldOfStudy: row.fieldOfStudy.trim() || null,
        passingYear: row.passingYear.trim() ? Number(row.passingYear) : null,
        grade: row.grade.trim() || null,
      }));
      const saved = await saveMyEducation(entries);
      resetDirty(rows);
      onSaved(saved, advance);
    } catch (cause) {
      toast.error(message(cause, 'Unable to save your education.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {rows.map((row, index) => (
        <div key={index} className="rounded-xl border border-app-border p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-app-muted">Qualification {index + 1}</span>
            {rows.length > 1 && (
              <button type="button" onClick={() => setRows((list) => list.filter((_, i) => i !== index))} className="text-xs font-semibold text-app-danger hover:underline">
                Remove
              </button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Degree / course" value={row.degree} onChange={(v) => update(index, { degree: v })} placeholder="e.g. B.Tech, 12th (HSC)" />
            <Field label="Institution" value={row.institution} onChange={(v) => update(index, { institution: v })} placeholder="College, school or board" />
            <Field label="Field of study (optional)" value={row.fieldOfStudy} onChange={(v) => update(index, { fieldOfStudy: v })} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Passing year" value={row.passingYear} onChange={(v) => update(index, { passingYear: v.replace(/\D/g, '').slice(0, 4) })} placeholder="2022" />
              <Field label="Grade (optional)" value={row.grade} onChange={(v) => update(index, { grade: v })} placeholder="8.2 CGPA / 78%" />
            </div>
          </div>
        </div>
      ))}
      <Button kind="secondary" onClick={() => setRows((list) => [...list, emptyQualification()])}>
        + Add another qualification
      </Button>
      {error && <ErrorToast message={error} />}
      <p className="text-[11px] text-app-muted">Upload the matching certificates or marksheets in the Documents section.</p>
      <EditorFooter busy={busy} onSave={(advance) => void save(advance)} />
    </div>
  );
}

interface ExperienceDraft {
  companyName: string;
  jobTitle: string;
  startDate: string;
  endDate: string;
  description: string;
}

const emptyExperience = (): ExperienceDraft => ({ companyName: '', jobTitle: '', startDate: '', endDate: '', description: '' });

function ExperienceEditor({ details, onDirty, onSaved }: EditorProps): React.JSX.Element {
  const [fresher, setFresher] = useState(details.noPriorExperience);
  const [rows, setRows] = useState<ExperienceDraft[]>(() =>
    details.experience.length > 0
      ? details.experience.map((e) => ({
          companyName: e.companyName,
          jobTitle: e.jobTitle,
          startDate: e.startDate,
          endDate: e.endDate ?? '',
          description: e.description ?? '',
        }))
      : [emptyExperience()],
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const resetDirty = useDirty({ fresher, rows }, onDirty);

  const update = (index: number, patch: Partial<ExperienceDraft>) =>
    setRows((list) => list.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  async function save(advance: boolean): Promise<void> {
    const filled = fresher ? [] : rows.filter((row) => (Object.values(row) as string[]).some((v) => v.trim() !== ''));
    for (const row of filled) {
      if (!row.companyName.trim() || !row.jobTitle.trim() || !row.startDate) {
        setError('Each job needs a company, a job title and a start date. Remove the ones you do not need.');
        return;
      }
      if (row.endDate && row.endDate < row.startDate) {
        setError('An end date cannot be before its start date.');
        return;
      }
    }
    setError('');
    setBusy(true);
    try {
      const entries: ExperienceEntry[] = filled.map((row) => ({
        companyName: row.companyName.trim(),
        jobTitle: row.jobTitle.trim(),
        startDate: row.startDate,
        endDate: row.endDate || null,
        description: row.description.trim() || null,
      }));
      const saved = await saveMyExperience(fresher, entries);
      resetDirty({ fresher, rows });
      onSaved(saved, advance);
    } catch (cause) {
      toast.error(message(cause, 'Unable to save your work experience.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3 rounded-xl border border-app-border p-4 text-sm">
        <input
          type="checkbox"
          checked={fresher}
          onChange={(event) => setFresher(event.target.checked)}
          className="mt-0.5 size-4"
        />
        <span>
          <span className="block font-semibold text-app-foreground">This is my first job</span>
          <span className="block text-xs text-app-muted">
            You have no previous employer, so you will not be asked for payslips or an experience letter.
          </span>
        </span>
      </label>

      {!fresher && (
        <>
          {rows.map((row, index) => (
            <div key={index} className="rounded-xl border border-app-border p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-app-muted">Job {index + 1}</span>
                {rows.length > 1 && (
                  <button type="button" onClick={() => setRows((list) => list.filter((_, i) => i !== index))} className="text-xs font-semibold text-app-danger hover:underline">
                    Remove
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Company" value={row.companyName} onChange={(v) => update(index, { companyName: v })} />
                <Field label="Job title" value={row.jobTitle} onChange={(v) => update(index, { jobTitle: v })} />
                <Field label="Start date" type="date" value={row.startDate} onChange={(v) => update(index, { startDate: v })} />
                <Field
                  label="End date (empty if you still work there)"
                  type="date"
                  value={row.endDate}
                  onChange={(v) => update(index, { endDate: v })}
                  {...(row.startDate ? { min: row.startDate } : {})}
                />
                <div className="sm:col-span-2">
                  <Field label="What you did there (optional)" value={row.description} onChange={(v) => update(index, { description: v })} />
                </div>
              </div>
            </div>
          ))}
          <Button kind="secondary" onClick={() => setRows((list) => [...list, emptyExperience()])}>
            + Add another job
          </Button>
        </>
      )}
      {error && <ErrorToast message={error} />}
      <EditorFooter busy={busy} onSave={(advance) => void save(advance)} />
    </div>
  );
}

const PROFICIENCIES: { value: SkillProficiency; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'expert', label: 'Expert' },
];

function SkillsEditor({ details, onDirty, onSaved }: EditorProps): React.JSX.Element {
  const [skills, setSkills] = useState<SkillEntry[]>(() =>
    details.skills.map((s) => ({ skillName: s.skillName, proficiency: s.proficiency })),
  );
  const [name, setName] = useState('');
  const [level, setLevel] = useState<SkillProficiency>('intermediate');
  const [busy, setBusy] = useState(false);
  const resetDirty = useDirty(skills, onDirty);

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (skills.some((s) => s.skillName.toLowerCase() === trimmed.toLowerCase())) {
      toast.error('That skill is already in your list.');
      return;
    }
    setSkills((list) => [...list, { skillName: trimmed.slice(0, 100), proficiency: level }]);
    setName('');
  };

  async function save(advance: boolean): Promise<void> {
    // A skill typed but not added yet is almost always meant to be kept.
    const pendingName = name.trim();
    const list =
      pendingName && !skills.some((s) => s.skillName.toLowerCase() === pendingName.toLowerCase())
        ? [...skills, { skillName: pendingName.slice(0, 100), proficiency: level }]
        : skills;
    setBusy(true);
    try {
      const saved = await saveMySkills(list);
      setSkills(list);
      setName('');
      resetDirty(list);
      onSaved(saved, advance);
    } catch (cause) {
      toast.error(message(cause, 'Unable to save your skills.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[180px] flex-1">
          <Field label="Skill" value={name} onChange={setName} placeholder="e.g. Excel, Sales, React" />
        </div>
        <div className="w-40">
          <Select
            label="Level"
            value={level}
            onChange={(v) => setLevel((v || 'intermediate') as SkillProficiency)}
            options={PROFICIENCIES}
          />
        </div>
        <Button kind="secondary" onClick={add}>
          Add
        </Button>
      </div>
      {skills.length === 0 ? (
        <p className="text-sm text-app-muted">No skills added yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {skills.map((skill) => (
            <li key={skill.skillName} className="flex items-center gap-2 rounded-full border border-app-border bg-app-background px-3 py-1.5 text-xs">
              <span className="font-semibold text-app-foreground">{skill.skillName}</span>
              {skill.proficiency && <span className="text-app-muted">· {skill.proficiency}</span>}
              <button
                type="button"
                aria-label={`Remove ${skill.skillName}`}
                onClick={() => setSkills((list) => list.filter((s) => s !== skill))}
                className="text-app-muted hover:text-app-danger"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <EditorFooter busy={busy} onSave={(advance) => void save(advance)} />
    </div>
  );
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

const STATUS_BADGE: Record<ProfileDocument['status'], { text: string; className: string }> = {
  PENDING: { text: 'Waiting for HR', className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  APPROVED: { text: 'Approved', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  REJECTED: { text: 'Rejected', className: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400' },
};

function DocumentsEditor({
  details,
  onSaved,
}: {
  details: Details;
  onSaved: (next: MyProfile) => void;
}): React.JSX.Element {
  const [busyType, setBusyType] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const verified = details.verificationStatus === 'VERIFIED';

  // Required documents first, then anything else already uploaded.
  const types = useMemo(() => {
    const required = details.requiredDocumentTypes;
    const extra = VERIFICATION_DOCUMENT_TYPES.filter(
      (type) => !required.includes(type) && details.documents.some((doc) => doc.documentType === type),
    );
    return [...required, ...extra];
  }, [details]);

  async function upload(type: VerificationDocumentType, file: File): Promise<void> {
    if (file.size === 0) {
      toast.error('That file is empty.');
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      toast.error('Files can be at most 10 MB.');
      return;
    }
    setBusyType(type);
    try {
      const saved = await uploadMyDocument({
        documentType: type,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileBase64: await readAsBase64(file),
      });
      onSaved(saved);
    } catch (cause) {
      toast.error(message(cause, 'Unable to upload the document.'));
    } finally {
      setBusyType(null);
      const input = inputs.current[type];
      if (input) input.value = '';
    }
  }

  async function remove(doc: ProfileDocument): Promise<void> {
    setBusyType(doc.documentType);
    try {
      onSaved(await removeMyDocument(doc.id));
    } catch (cause) {
      toast.error(message(cause, 'Unable to remove the document.'));
    } finally {
      setBusyType(null);
    }
  }

  async function view(doc: ProfileDocument): Promise<void> {
    try {
      const { downloadUrl } = await getMyDocumentDownloadUrl(doc.id);
      if (downloadUrl.startsWith('data:')) {
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = doc.fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        window.open(downloadUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (cause) {
      toast.error(message(cause, 'Unable to open the document.'));
    }
  }

  return (
    <div className="space-y-3">
      {verified && (
        <Notice>HR has verified your documents. Ask HR if something needs to change.</Notice>
      )}
      <p className="text-xs text-app-muted">PDF, JPG, PNG, WEBP or Word files, up to 10 MB each. HR reviews every upload.</p>
      {types.map((type) => {
        const docs = details.documents.filter((doc) => doc.documentType === type);
        const meta = DOCUMENT_TYPE_LABELS[type];
        const multiple = type === 'MARKSHEET';
        const approved = docs.some((doc) => doc.status === 'APPROVED');
        const canUpload = !verified && (multiple || !approved);
        const busy = busyType === type;
        return (
          <div key={type} className="rounded-xl border border-app-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-app-foreground">{meta.label}</p>
                <p className="text-[11px] text-app-muted">
                  {meta.description}
                  {multiple ? ' — you can upload more than one.' : ''}
                </p>
              </div>
              {canUpload && (
                <>
                  <input
                    ref={(element) => {
                      inputs.current[type] = element;
                    }}
                    type="file"
                    accept={ACCEPTED_DOCUMENTS}
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void upload(type, file);
                    }}
                  />
                  <Button kind="secondary" disabled={busy} onClick={() => inputs.current[type]?.click()} className="!py-2 text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="upload" className="size-4" />
                      {busy ? 'Uploading…' : docs.length === 0 ? 'Upload' : multiple ? 'Add another' : 'Replace'}
                    </span>
                  </Button>
                </>
              )}
            </div>
            {docs.length === 0 ? (
              <p className="mt-2 text-xs font-semibold text-app-muted">Not uploaded yet</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {docs.map((doc) => (
                  <li key={doc.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-app-background px-3 py-2 text-xs">
                    <span className="min-w-0 flex-1 truncate font-medium text-app-foreground" title={doc.fileName}>
                      {doc.fileName}
                    </span>
                    <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[doc.status].className}`}>
                      {STATUS_BADGE[doc.status].text}
                    </span>
                    <button type="button" onClick={() => void view(doc)} className="font-semibold text-app-accent hover:underline">
                      View
                    </button>
                    {doc.status === 'PENDING' && doc.uploadedBySelf && !verified && (
                      <button type="button" disabled={busy} onClick={() => void remove(doc)} className="font-semibold text-app-danger hover:underline disabled:opacity-50">
                        Remove
                      </button>
                    )}
                    {doc.status === 'REJECTED' && doc.rejectionReason && (
                      <p className="w-full text-[11px] text-rose-600 dark:text-rose-400">
                        HR's note: {doc.rejectionReason}. Please upload a new copy.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

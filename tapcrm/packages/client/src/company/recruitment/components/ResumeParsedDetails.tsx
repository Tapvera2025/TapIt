import type { ParsedResumeData } from '@tapcrm/contracts';
import { formatYears, safeHttpUrl, shortUrl } from '../resumeAutofill.js';

function joined(parts: readonly (string | null | undefined)[], separator = ' · '): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(separator);
}

/**
 * What the resume parser read from an application's resume: role, skills,
 * work history and education as structured entries. Applications parsed by
 * the first parser version carry only some fields; they show what they have.
 */
export function ResumeParsedDetails({ parsed }: { readonly parsed: ParsedResumeData | null | undefined }): React.JSX.Element {
  const skills = parsed?.skills ?? [];
  const experience = parsed?.experience ?? [];
  const education = parsed?.education ?? [];
  const projects = parsed?.projects ?? [];
  const current = Boolean(parsed?.parserVersion);
  const links = ([
    ['LinkedIn', parsed?.links?.linkedin],
    ['GitHub', parsed?.links?.github],
    ['Portfolio', parsed?.links?.portfolio],
  ] as const).flatMap(([label, value]) => {
    const href = safeHttpUrl(value);
    return href ? [{ label, href }] : [];
  });
  const otherContacts = [...(parsed?.otherPhones ?? []), ...(parsed?.otherEmails ?? [])];
  const years = typeof parsed?.experienceYears === 'number' && parsed.experienceYears > 0 ? parsed.experienceYears : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="font-semibold text-app-foreground">Resume Details</h4>
          <span className="rounded-full bg-app-accent/10 px-2 py-0.5 text-[10px] font-bold text-app-accent">
            Read on our servers · no AI service
          </span>
        </div>
        <p className="text-[11px] text-app-muted">
          {!current
            ? 'Read by an earlier version — details may be incomplete'
            : parsed?.ocr
              ? 'Read from a scanned image (OCR) — check against the resume'
              : 'Read automatically — check against the resume'}
        </p>
      </div>

      {parsed?.warnings && parsed.warnings.length > 0 && (
        <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {parsed.warnings.join(' ')}
        </div>
      )}

      {(parsed?.headline || years !== null || links.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-app-border bg-app-surface px-4 py-3 text-xs">
          {parsed?.headline && <span className="font-semibold text-app-foreground">{parsed.headline}</span>}
          {years !== null && <span className="text-app-muted">{formatYears(years)} of dated experience</span>}
          {links.map((link) => (
            <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" className="text-app-accent hover:underline">
              {link.label}: {shortUrl(link.href)}
            </a>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-app-border bg-app-surface p-4">
        <h5 className="text-xs font-bold uppercase tracking-wider text-app-muted">Skills</h5>
        {skills.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {skills.map((skill) => (
              <span key={skill} className="rounded-md border border-app-border bg-app-surface-raised px-2.5 py-1 text-xs font-medium text-app-foreground">
                {skill}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-app-muted">No skills section or known skills found in the resume text.</p>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-app-border bg-app-surface p-4">
          <h5 className="text-xs font-bold uppercase tracking-wider text-app-muted">Work Experience</h5>
          {experience.length > 0 ? (
            <ol className="mt-2 space-y-2">
              {experience.map((job, index) => (
                <li key={index} className="rounded-lg bg-app-background p-2 text-xs">
                  <p className="font-semibold text-app-foreground">{job.title ?? job.company ?? 'Role'}</p>
                  {job.title && (job.company || job.location) && (
                    <p className="text-app-muted">{joined([job.company, job.location])}</p>
                  )}
                  {job.duration && <p className="text-[11px] text-app-accent">{job.duration}</p>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-xs text-app-muted">No dated jobs found in the resume text.</p>
          )}
        </div>

        <div className="rounded-xl border border-app-border bg-app-surface p-4">
          <h5 className="text-xs font-bold uppercase tracking-wider text-app-muted">Education</h5>
          {education.length > 0 ? (
            <ol className="mt-2 space-y-2">
              {education.map((entry, index) => (
                <li key={index} className="rounded-lg bg-app-background p-2 text-xs">
                  <p className="font-semibold text-app-foreground">{joined([entry.degree, entry.field], ', ') || 'Qualification'}</p>
                  {entry.institution && <p className="text-app-muted">{entry.institution}</p>}
                  {(entry.year || entry.grade) && <p className="text-[11px] text-app-accent">{joined([entry.year, entry.grade])}</p>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-xs text-app-muted">No degree found in the resume text.</p>
          )}
        </div>
      </div>

      {projects.length > 0 && (
        <div className="rounded-xl border border-app-border bg-app-surface p-4">
          <h5 className="text-xs font-bold uppercase tracking-wider text-app-muted">Projects</h5>
          <ul className="mt-2 space-y-1.5 text-xs">
            {projects.map((project, index) => (
              <li key={index}>
                <span className="font-semibold text-app-foreground">{project.title}</span>
                {project.description && <span className="text-app-muted"> — {project.description}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {current && parsed?.summary && (
        <div className="rounded-xl border border-app-border bg-app-surface p-4">
          <h5 className="text-xs font-bold uppercase tracking-wider text-app-muted">Summary</h5>
          <p className="mt-2 text-xs text-app-foreground">{parsed.summary}</p>
        </div>
      )}

      {otherContacts.length > 0 && (
        <p className="text-[11px] text-app-muted">Also on the resume: {otherContacts.join(' · ')}</p>
      )}

      {parsed?.rawTextPreview && (
        <details className="rounded-xl border border-app-border bg-app-surface p-4">
          <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-app-muted">Resume Text Excerpt</summary>
          <pre className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap rounded-lg bg-app-background p-2.5 font-mono text-[11px] text-app-muted">
            {parsed.rawTextPreview}
          </pre>
        </details>
      )}
    </div>
  );
}

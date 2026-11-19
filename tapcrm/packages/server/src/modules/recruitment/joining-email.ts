import { escapeHtml } from '../identity/facade.js';

/**
 * Builds a joining email from an HR-written template.
 *
 * Templates are HTML (the template editor previews them as HTML) and use
 * `{{variables}}`. Both the names the screens advertise and the older names
 * the server used are accepted. Every value is HTML-escaped before it is put
 * into the body, so a candidate named `<script>` stays text.
 *
 * A template is refused, not sent, when it uses a variable that does not
 * exist (a typo would reach the candidate as literal braces) or one with no
 * value for this candidate (e.g. "You will report to ." when the role has no
 * manager): HR edits the text and sends again.
 */

export interface JoiningEmailValues {
  readonly candidateName: string;
  readonly positionTitle: string;
  readonly department: string;
  readonly joiningDate: string;
  readonly companyName: string;
  readonly managerName: string;
}

const VARIABLES: Record<string, keyof JoiningEmailValues> = {
  candidate_name: 'candidateName',
  position_title: 'positionTitle',
  role: 'positionTitle',
  department: 'department',
  joining_date: 'joiningDate',
  company_name: 'companyName',
  manager_name: 'managerName',
  reporting_manager: 'managerName',
};

const MISSING_REASON: Record<keyof JoiningEmailValues, string> = {
  candidateName: 'the candidate has no name on record',
  positionTitle: 'the offer has no position',
  department: 'the requisition has no department',
  joiningDate: 'no joining date is set',
  companyName: 'the company has no name',
  managerName: 'nobody holds the position this role reports to',
};

const ACKNOWLEDGE = 'acknowledge_link';
const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

export interface JoiningEmailProblem {
  readonly variable: string;
  readonly problem: string;
}

/** What stops this subject/body from being sent, or an empty list. */
export function joiningEmailProblems(subject: string, body: string, values: JoiningEmailValues): JoiningEmailProblem[] {
  const problems = new Map<string, string>();
  for (const [text, where] of [[subject, 'subject'], [body, 'body']] as const) {
    for (const match of text.matchAll(PLACEHOLDER)) {
      const name = match[1] ?? '';
      if (name === ACKNOWLEDGE) {
        if (where === 'subject') problems.set(name, 'the confirmation link can only go in the body');
        continue;
      }
      const key = VARIABLES[name];
      if (!key) problems.set(name, 'is not a known variable');
      else if (values[key].trim() === '') problems.set(name, `has no value: ${MISSING_REASON[key]}`);
    }
  }
  return [...problems].map(([variable, problem]) => ({ variable: `{{${variable}}}`, problem }));
}

function fill(text: string, values: JoiningEmailValues, encode: (value: string) => string, link: string): string {
  return text.replace(PLACEHOLDER, (whole, name: string) => {
    if (name === ACKNOWLEDGE) return encode(link);
    const key = VARIABLES[name];
    return key ? encode(values[key]) : whole;
  });
}

const looksLikeHtml = (text: string): boolean => /<\/?[a-z][\s\S]*?>/i.test(text);

/** Plain text typed into the HTML body keeps its line breaks. */
function asHtml(body: string): string {
  return looksLikeHtml(body) ? body : escapeHtml(body).replace(/\r?\n/g, '<br>\n');
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

/** A readable plain-text part for mail clients that do not show HTML. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\s[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => `${label} (${href})`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface RenderedJoiningEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/** Call after `joiningEmailProblems` returned nothing. */
export function renderJoiningEmail(
  template: { subject: string; body: string },
  values: JoiningEmailValues,
  acknowledgeUrl: string,
): RenderedJoiningEmail {
  const subject = fill(template.subject, values, (value) => value.replace(/[\r\n]+/g, ' '), acknowledgeUrl);
  let html = fill(asHtml(template.body), values, escapeHtml, acknowledgeUrl);
  if (!template.body.match(/\{\{\s*acknowledge_link\s*\}\}/)) {
    const href = escapeHtml(acknowledgeUrl);
    html += `\n<p style="margin-top:24px"><a href="${href}" style="display:inline-block;padding:10px 18px;border-radius:6px;background:#111827;color:#ffffff;text-decoration:none">Confirm your joining</a></p>`
      + `\n<p style="color:#6b7280;font-size:12px">If the button does not work, open this link: ${href}</p>`;
  }
  return { subject, html, text: htmlToText(html) };
}

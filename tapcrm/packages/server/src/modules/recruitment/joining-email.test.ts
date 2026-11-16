import { describe, expect, it } from 'vitest';
import { htmlToText, joiningEmailProblems, renderJoiningEmail, type JoiningEmailValues } from './joining-email.js';

const values: JoiningEmailValues = {
  candidateName: 'Rahul <b>Sharma</b>',
  positionTitle: 'Backend Engineer',
  department: 'Engineering',
  joiningDate: '1 December 2026',
  companyName: 'Acme & Sons',
  managerName: 'Priya Nair',
};
const LINK = 'https://crm.example.com/api/public/recruitment/acknowledge/abc';

describe('joining email', () => {
  it('fills the variables the screens advertise and the older names', () => {
    const email = renderJoiningEmail(
      { subject: 'Welcome to {{company_name}}', body: '<p>{{position_title}} / {{role}}, reporting to {{manager_name}} ({{reporting_manager}}) in {{department}} from {{joining_date}}</p>' },
      values,
      LINK,
    );
    expect(email.subject).toBe('Welcome to Acme & Sons');
    expect(email.html).toContain('Backend Engineer / Backend Engineer, reporting to Priya Nair (Priya Nair) in Engineering from 1 December 2026');
  });

  it('escapes values in the HTML body, so a name cannot inject markup', () => {
    const email = renderJoiningEmail({ subject: 'Hi', body: '<p>Dear {{candidate_name}}, welcome to {{company_name}}</p>' }, values, LINK);
    expect(email.html).toContain('Dear Rahul &lt;b&gt;Sharma&lt;/b&gt;, welcome to Acme &amp; Sons');
    expect(email.text).toContain('Dear Rahul <b>Sharma</b>, welcome to Acme & Sons');
  });

  it('puts the confirmation link where {{acknowledge_link}} is, and nowhere else', () => {
    const email = renderJoiningEmail({ subject: 'Hi', body: '<p><a href="{{acknowledge_link}}">Confirm</a></p>' }, values, LINK);
    expect(email.html).toBe(`<p><a href="${LINK}">Confirm</a></p>`);
    expect(email.text).toBe(`Confirm (${LINK})`);
  });

  it('adds a confirmation button when the template has no link', () => {
    const email = renderJoiningEmail({ subject: 'Hi', body: 'Dear {{candidate_name}},\nSee you soon.' }, values, LINK);
    expect(email.html).toContain('Dear Rahul &lt;b&gt;Sharma&lt;/b&gt;,<br>');
    expect(email.html).toContain(`<a href="${LINK}"`);
    expect(email.text).toContain(`Confirm your joining (${LINK})`);
  });

  it('refuses unknown variables and variables with no value', () => {
    expect(joiningEmailProblems('Hi {{candidate_nme}}', 'You report to {{manager_name}}', { ...values, managerName: '' })).toEqual([
      { variable: '{{candidate_nme}}', problem: 'is not a known variable' },
      { variable: '{{manager_name}}', problem: 'has no value: nobody holds the position this role reports to' },
    ]);
    expect(joiningEmailProblems('Confirm: {{acknowledge_link}}', '<p>Hi</p>', values)).toEqual([
      { variable: '{{acknowledge_link}}', problem: 'the confirmation link can only go in the body' },
    ]);
    expect(joiningEmailProblems('Welcome to {{company_name}}', '<p>{{acknowledge_link}}</p>', values)).toEqual([]);
  });

  it('makes readable plain text from HTML', () => {
    expect(htmlToText('<p>One</p><p>Two<br>Three &amp; four</p><style>p{}</style>')).toBe('One\nTwo\nThree & four');
  });
});

import { escapeHtml, sendEmail } from '../identity/facade.js';

export interface InterviewEmailInput {
  readonly to: string;
  readonly candidateName: string;
  readonly requisitionTitle: string;
  readonly stage: string;
  readonly round: number;
  readonly scheduledAt: string;
  readonly durationMinutes: number;
  readonly locationOrLink: string | null;
  readonly notes: string | null;
}

export interface InterviewRescheduledEmailInput {
  readonly to: string;
  readonly candidateName: string;
  readonly requisitionTitle: string;
  readonly stage: string;
  readonly round: number;
  readonly newScheduledAt: string;
  readonly durationMinutes: number;
  readonly locationOrLink: string | null;
  readonly notes?: string | null | undefined;
}

export interface CandidateRejectionEmailInput {
  readonly to: string;
  readonly candidateName: string;
  readonly requisitionTitle: string;
  readonly reason?: string | null | undefined;
}

export interface OnboardingEmailInput {
  readonly to: string;
  readonly employeeName: string;
  readonly jobTitle: string;
  readonly departmentName?: string | null | undefined;
  readonly joiningDate: string;
}

/**
 * Sends an email notification when an interview is scheduled.
 * Catches errors to ensure database transaction success never depends on SMTP.
 */
export async function notifyInterviewScheduled(input: InterviewEmailInput): Promise<void> {
  try {
    const formattedDate = new Date(input.scheduledAt).toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'short',
    });

    const text = [
      `Hello ${input.candidateName},`,
      '',
      `Your interview for "${input.requisitionTitle}" has been scheduled.`,
      '',
      `Stage: ${input.stage.toUpperCase()} (Round ${input.round})`,
      `Date & Time: ${formattedDate}`,
      `Duration: ${input.durationMinutes} minutes`,
      input.locationOrLink ? `Meeting Link / Location: ${input.locationOrLink}` : '',
      input.notes ? `Notes: ${input.notes}` : '',
      '',
      'Please be prepared and join on time.',
      'Best regards,',
      'The Recruitment Team',
    ].filter(Boolean).join('\n');

    const html = `
      <p>Hello <strong>${escapeHtml(input.candidateName)}</strong>,</p>
      <p>Your interview for <strong>${escapeHtml(input.requisitionTitle)}</strong> has been scheduled.</p>
      <ul>
        <li><strong>Stage:</strong> ${escapeHtml(input.stage.toUpperCase())} (Round ${input.round})</li>
        <li><strong>Date & Time:</strong> ${escapeHtml(formattedDate)}</li>
        <li><strong>Duration:</strong> ${input.durationMinutes} minutes</li>
        ${input.locationOrLink ? `<li><strong>Meeting Link / Location:</strong> <a href="${escapeHtml(input.locationOrLink)}">${escapeHtml(input.locationOrLink)}</a></li>` : ''}
        ${input.notes ? `<li><strong>Notes:</strong> ${escapeHtml(input.notes)}</li>` : ''}
      </ul>
      <p>Please be prepared and join on time.</p>
      <p>Best regards,<br/>The Recruitment Team</p>
    `;

    await sendEmail({
      to: input.to,
      subject: `Interview Scheduled: ${input.requisitionTitle} (${input.stage.toUpperCase()})`,
      text,
      html,
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'Failed to send interview scheduled email',
        error: (error as Error).message,
        candidateEmail: input.to,
      }),
    );
  }
}

/**
 * Sends an email notification when an interview is rescheduled.
 */
export async function notifyInterviewRescheduled(input: InterviewRescheduledEmailInput): Promise<void> {
  try {
    const formattedDate = new Date(input.newScheduledAt).toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'short',
    });

    const text = [
      `Hello ${input.candidateName},`,
      '',
      `Your interview for "${input.requisitionTitle}" has been rescheduled to a new time.`,
      '',
      `Stage: ${input.stage.toUpperCase()} (Round ${input.round})`,
      `New Date & Time: ${formattedDate}`,
      `Duration: ${input.durationMinutes} minutes`,
      input.locationOrLink ? `Meeting Link / Location: ${input.locationOrLink}` : '',
      input.notes ? `Notes: ${input.notes}` : '',
      '',
      'We apologize for any inconvenience.',
      'Best regards,',
      'The Recruitment Team',
    ].filter(Boolean).join('\n');

    const html = `
      <p>Hello <strong>${escapeHtml(input.candidateName)}</strong>,</p>
      <p>Your interview for <strong>${escapeHtml(input.requisitionTitle)}</strong> has been rescheduled to a new time.</p>
      <ul>
        <li><strong>Stage:</strong> ${escapeHtml(input.stage.toUpperCase())} (Round ${input.round})</li>
        <li><strong>New Date & Time:</strong> ${escapeHtml(formattedDate)}</li>
        <li><strong>Duration:</strong> ${input.durationMinutes} minutes</li>
        ${input.locationOrLink ? `<li><strong>Meeting Link / Location:</strong> <a href="${escapeHtml(input.locationOrLink)}">${escapeHtml(input.locationOrLink)}</a></li>` : ''}
        ${input.notes ? `<li><strong>Notes:</strong> ${escapeHtml(input.notes)}</li>` : ''}
      </ul>
      <p>We apologize for any inconvenience.</p>
      <p>Best regards,<br/>The Recruitment Team</p>
    `;

    await sendEmail({
      to: input.to,
      subject: `Interview Rescheduled: ${input.requisitionTitle}`,
      text,
      html,
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'Failed to send interview rescheduled email',
        error: (error as Error).message,
        candidateEmail: input.to,
      }),
    );
  }
}

/**
 * Sends candidate rejection notification.
 */
export async function notifyCandidateRejection(input: CandidateRejectionEmailInput): Promise<void> {
  try {
    const text = [
      `Hello ${input.candidateName},`,
      '',
      `Thank you for taking the time to speak with us regarding the "${input.requisitionTitle}" position.`,
      '',
      'After careful consideration, we have decided to move forward with other candidates whose qualifications more closely align with our current needs.',
      input.reason ? `Feedback: ${input.reason}` : '',
      '',
      'We wish you the best in your job search and future professional endeavors.',
      'Sincerely,',
      'The Recruitment Team',
    ].filter(Boolean).join('\n');

    const html = `
      <p>Hello <strong>${escapeHtml(input.candidateName)}</strong>,</p>
      <p>Thank you for taking the time to speak with us regarding the <strong>${escapeHtml(input.requisitionTitle)}</strong> position.</p>
      <p>After careful consideration, we have decided to move forward with other candidates whose qualifications more closely align with our current needs.</p>
      ${input.reason ? `<p><strong>Feedback:</strong> ${escapeHtml(input.reason)}</p>` : ''}
      <p>We wish you the best in your job search and future professional endeavors.</p>
      <p>Sincerely,<br/>The Recruitment Team</p>
    `;

    await sendEmail({
      to: input.to,
      subject: `Application Status: ${input.requisitionTitle}`,
      text,
      html,
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'Failed to send candidate rejection email',
        error: (error as Error).message,
        candidateEmail: input.to,
      }),
    );
  }
}

/**
 * Sends onboarding welcome email after hiring as employee.
 */
export async function notifyOnboardingWelcome(input: OnboardingEmailInput): Promise<void> {
  try {
    const text = [
      `Welcome to the team, ${input.employeeName}!`,
      '',
      `We are thrilled to welcome you as our new ${input.jobTitle}${input.departmentName ? ` in ${input.departmentName}` : ''}.`,
      `Your official joining date is ${input.joiningDate}.`,
      '',
      'Your manager and team are eager to work with you. You will receive your system access credentials and onboarding schedule shortly.',
      '',
      'Welcome aboard!',
      'The HR & People Team',
    ].join('\n');

    const html = `
      <h2>Welcome to the team, ${escapeHtml(input.employeeName)}!</h2>
      <p>We are thrilled to welcome you as our new <strong>${escapeHtml(input.jobTitle)}</strong>${input.departmentName ? ` in <strong>${escapeHtml(input.departmentName)}</strong>` : ''}.</p>
      <p>Your official joining date is <strong>${escapeHtml(input.joiningDate)}</strong>.</p>
      <p>Your manager and team are eager to work with you. You will receive your system access credentials and onboarding schedule shortly.</p>
      <p>Welcome aboard!<br/><strong>The HR &amp; People Team</strong></p>
    `;

    await sendEmail({
      to: input.to,
      subject: `Welcome to TapCRM! - Onboarding & Next Steps`,
      text,
      html,
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'Failed to send onboarding welcome email',
        error: (error as Error).message,
        employeeEmail: input.to,
      }),
    );
  }
}

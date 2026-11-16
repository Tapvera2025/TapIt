import { useState } from 'react';
import { Button, Modal } from '../../ui/index.js';
import { ProfileCompletionBar } from './ProfileCompletionRing.js';
import { dismissPrompt, isPromptDismissed, useMyProfile } from './myProfileStore.js';

export const MY_PROFILE_PATH = '/company/my-profile';

/**
 * After signing in, an employee whose profile is not complete is asked to
 * finish it. "Skip for later" hides the prompt until the next sign-in; the
 * percentage stays on the avatar and in the account menu meanwhile.
 */
export function CompleteProfilePrompt({
  accountType,
  pathname,
  onNavigate,
}: {
  accountType: string;
  pathname: string;
  onNavigate: (path: string) => void;
}): React.JSX.Element | null {
  const isEmployee = accountType === 'employee';
  const { profile } = useMyProfile(isEmployee);
  const [dismissed, setDismissed] = useState(isPromptDismissed);

  if (!isEmployee || dismissed || pathname === MY_PROFILE_PATH) return null;
  if (!profile || !profile.applicable || profile.completion.percent >= 100) return null;

  const { completion } = profile;
  const pending = completion.items.filter((item) => item.state !== 'done');
  const firstName = profile.work.fullName.trim().split(/\s+/)[0] ?? '';
  const isNew = completion.percent === 0 || completion.completedCount <= 1;

  const skip = () => {
    dismissPrompt();
    setDismissed(true);
  };

  return (
    <Modal
      title={isNew ? `Welcome${firstName ? `, ${firstName}` : ''}! Let's complete your profile` : 'Your profile is not complete yet'}
      onClose={skip}
      dirty={false}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button kind="secondary" onClick={skip}>
            Skip for later
          </Button>
          <Button
            onClick={() => {
              dismissPrompt();
              setDismissed(true);
              onNavigate(MY_PROFILE_PATH);
            }}
          >
            Complete my profile
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-app-muted">
          HR has set up your account. Add your personal details, education, experience and documents so HR can
          finish your onboarding. You can do it in parts — everything you save is kept.
        </p>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs font-semibold">
            <span className="text-app-muted">
              {completion.completedCount} of {completion.totalCount} done
            </span>
            <span className="text-app-foreground">{completion.percent}%</span>
          </div>
          <ProfileCompletionBar percent={completion.percent} />
        </div>
        {pending.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-app-muted">Still to add</p>
            <ul className="flex flex-wrap gap-1.5">
              {pending.slice(0, 12).map((item) => (
                <li
                  key={item.key}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                    item.state === 'rejected'
                      ? 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                      : 'border-app-border bg-app-background text-app-muted'
                  }`}
                >
                  {item.label}
                  {item.state === 'rejected' ? ' · re-upload' : ''}
                </li>
              ))}
              {pending.length > 12 && (
                <li className="px-1 py-1 text-[11px] text-app-muted">+{pending.length - 12} more</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

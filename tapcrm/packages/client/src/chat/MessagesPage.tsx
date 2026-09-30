import { useState } from 'react';
import { DirectMessagesPage } from './DirectMessagesPage.js';
import { InternalGroupsPage } from './InternalGroupsPage.js';

type Tab = 'direct' | 'group';

/**
 * The Messages module. Two tabs today — Direct Messages (Phase 2) and
 * Internal Groups (Phase 3); Project Group is Phase 4, added here once a
 * project's second-step group-creation flow exists.
 */
export function MessagesPage({ currentUserId, isSuperAdmin }: { currentUserId: string; isSuperAdmin: boolean }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('direct');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-1 border-b border-app-border px-4 pt-3">
        {([['direct', 'Direct Messages'], ['group', 'Internal Groups']] as const).map(([value, tabLabel]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`rounded-t-lg px-3 py-2 text-sm font-semibold ${tab === value ? 'border-b-2 border-app-accent text-app-accent' : 'text-app-muted hover:text-app-foreground'}`}
          >
            {tabLabel}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'direct' ? (
          <DirectMessagesPage currentUserId={currentUserId} />
        ) : (
          <InternalGroupsPage currentUserId={currentUserId} isSuperAdmin={isSuperAdmin} />
        )}
      </div>
    </div>
  );
}

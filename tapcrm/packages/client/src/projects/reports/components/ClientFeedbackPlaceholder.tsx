import { useState } from 'react';
import { Card } from '../../../ui/components.js';

export function ClientFeedbackPlaceholder({ area, description }: { area: string; description: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return <Card><button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpen((current) => !current)}><span><span className="block font-display font-bold">Client feedback · {area}</span><span className="mt-1 block text-xs text-app-muted">{description}</span></span><span className="text-app-muted" aria-hidden="true">{open ? '−' : '+'}</span></button>{open && <div className="mt-4 rounded-lg border border-dashed border-app-border p-4 text-sm text-app-muted">No feedback messages yet. Client comments and replies for {area.toLowerCase()} will appear here when the client portal is available.</div>}</Card>;
}

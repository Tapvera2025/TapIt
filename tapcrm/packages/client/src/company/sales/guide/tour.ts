import type { Guidance } from './guidance.js';
import { salesGuideKey, type SalesPageViewer } from './page-guidance.js';

export interface TourStop {
  readonly id: string;
  /** A selector can match the desktop and mobile copies of a control. */
  readonly target?: string;
  readonly title: string;
  readonly detail: string;
  readonly contextual?: boolean;
}

/** Page explanations never perform work. Only the contextual actions do. */
export function salesTour(path: string, guidance: Guidance, viewer: SalesPageViewer): TourStop[] {
  const next: TourStop = { id: 'next', title: guidance.title, detail: guidance.detail, contextual: true };
  switch (salesGuideKey(path)) {
    case 'handovers':
      return [
        { id: 'view', target: '[data-guide="handover-views"]', title: 'Choose a view', detail: 'Switch between all handovers you can see, incoming offers, and handovers you sent or received.' },
        { id: 'browse', target: '#handover-list', title: 'Browse handovers', detail: 'Each row is a handover record. After this tour, select one to review the call and the people involved. An empty list means there are no handovers in this view.' },
        { id: 'status', target: '#handover-list [data-guide="handover-status"]', title: 'Understand the status', detail: 'Pending offers need a receiver. Accepted calls may still need an outcome. Callback, Rejected and Expired tell you how the handover ended.' },
        { ...next, id: 'review', target: '#handover-detail', title: 'Review and act', detail: 'Select a handover to see its details. A pending recipient can accept or decline; an unclaimed team offer can be claimed by an eligible team member. The receiver records the outcome after accepting. Availability and company policies are checked when you act.' },
      ];
    case 'leads':
      return [
        { id: 'browse', target: '#guide-leads-list', title: 'Find a lead to work', detail: 'These are the leads your account can see. Open a row to review the contact, ownership and the next step.' },
        { id: 'status', target: '#guide-leads-list [data-guide="lead-status"]', title: 'Read the status and next step', detail: 'The status shows where the lead is in the flow. The line below tells you whether to call, follow up, assign an owner, or wait for a colleague.' },
        ...(viewer.canAddLeads ? [{ id: 'add', target: '[data-guide="add-lead"]', title: 'Add an enquiry', detail: 'Choose an active source when you add a lead. Outbound leads stay with the person adding them; inbound leads follow company routing and availability.' }] : []),
        { ...next, target: '#guide-leads-list' },
      ];
    case 'lead':
      return [
        { id: 'progress', target: '#guide-lead-progress', title: 'Follow this lead’s progress', detail: 'Follow the lead from ownership and first contact to understanding the need and creating a deal. Closed and converted leads keep their history.' },
        { id: 'owner', target: '#guide-lead-contact', title: 'Check who is working it', detail: 'The owner and current holder can differ after a handover. The current holder works the lead; your granted powers determine which actions you can use.' },
        { ...next, target: guidance.actions.find((a) => a.emphasis === 'primary' && a.do.kind === 'focus')?.do.kind === 'focus' ? `#${(guidance.actions.find((a) => a.emphasis === 'primary' && a.do.kind === 'focus')!.do as { target: string }).target}` : '#lead-status' },
      ];
    case 'my-work': {
      const target = guidance.actions.find((a) => a.do.kind === 'focus');
      return [{ ...next, ...(target?.do.kind === 'focus' ? { target: `#${target.do.target}` } : {}) }];
    }
    default:
      return [next];
  }
}

export interface TourRect { x: number; y: number; width: number; height: number }

/** Keep the card in view, preferring a side that leaves the target visible. */
export function placeTourCard(target: TourRect | null, width: number, height: number, viewport: { width: number; height: number }): { x: number; y: number } {
  const margin = 16;
  const bottom = Math.max(margin, viewport.height - height - 100);
  const clampX = (x: number): number => Math.max(margin, Math.min(x, viewport.width - width - margin));
  const clampY = (y: number): number => Math.max(margin, Math.min(y, bottom));
  if (!target || viewport.width < 640) return { x: clampX((viewport.width - width) / 2), y: clampY(viewport.height - height - 112) };
  const gap = 48;
  const positions = [
    { x: target.x + target.width + gap, y: target.y },
    { x: target.x - width - gap, y: target.y },
    { x: target.x + (target.width - width) / 2, y: target.y + target.height + gap },
    { x: target.x + (target.width - width) / 2, y: target.y - height - gap },
  ];
  const fits = positions.find((p) => p.x >= margin && p.x + width <= viewport.width - margin && p.y >= margin && p.y <= bottom);
  if (fits) return fits;
  // Large panels: put the explanation at the opposite edge of their centre.
  return { x: clampX(target.x + target.width / 2 < viewport.width / 2 ? viewport.width - width - margin : margin), y: clampY(target.y > viewport.height / 2 ? margin + 32 : bottom) };
}

/** Only links to accessible pages are offered; modules and scopes come from the workspace. */
export function accessibleGuidance(guidance: Guidance, viewer: SalesPageViewer): Guidance {
  return { ...guidance, actions: guidance.actions.filter((action) => action.do.kind !== 'navigate' || !viewer.canVisit || viewer.canVisit(action.do.to)) };
}

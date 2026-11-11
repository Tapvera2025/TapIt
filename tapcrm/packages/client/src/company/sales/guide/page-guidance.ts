/**
 * What each Sales list or queue page is for, and the next thing to do there.
 *
 * Lead and deal pages get item-specific guidance (lead-guidance.ts,
 * deal-guidance.ts); every other Sales page gets one of these, with the
 * page's place in the funnel so people can see how the pieces fit.
 */
import { focus, go, primary, run, secondary, type GuideAction, type GuideStep, type Guidance } from './guidance.js';

export type SalesPageKey =
  | 'overview'
  | 'my-work'
  | 'leads'
  | 'bid-pool'
  | 'triage'
  | 'callbacks'
  | 'handovers'
  | 'stalled'
  | 're-engagement'
  | 'imported'
  | 'deals'
  | 'approvals'
  | 'wins'
  | 'proposal'
  | 'delivery'
  | 'reports'
  | 'calls'
  | 'territories'
  | 'setup';

export interface SalesPageViewer {
  /** Sales Head, sales manager or admin: sees the whole team's work. */
  readonly isManager: boolean;
  readonly canAddLeads: boolean;
  readonly canRecordWin: boolean;
  readonly canDecideApprovals: boolean;
}

type FunnelStage = 'in' | 'owner' | 'qualify' | 'proposal' | 'close' | 'won';

const FUNNEL: ReadonlyArray<{ key: FunnelStage; label: string }> = [
  { key: 'in', label: 'A lead comes in' },
  { key: 'owner', label: 'It gets an owner' },
  { key: 'qualify', label: 'Call and qualify it' },
  { key: 'proposal', label: 'Deal: proposal and approval' },
  { key: 'close', label: 'Advance and delivery brief' },
  { key: 'won', label: 'Win recorded' },
];

/** The whole funnel with this page's stages marked as "you are here". */
export function funnelMap(here: readonly FunnelStage[]): GuideStep[] {
  return FUNNEL.map(({ key, label }) => ({ key, label, state: here.includes(key) ? 'current' : 'upcoming' }));
}

const PAGE_STAGES: Record<SalesPageKey, readonly FunnelStage[]> = {
  overview: [],
  'my-work': ['owner', 'qualify'],
  leads: ['in', 'qualify'],
  'bid-pool': ['owner'],
  triage: ['owner'],
  callbacks: ['qualify'],
  handovers: ['qualify'],
  stalled: ['qualify'],
  're-engagement': ['in'],
  imported: ['in', 'owner'],
  deals: ['proposal', 'close'],
  approvals: ['proposal'],
  wins: ['won'],
  proposal: ['proposal'],
  delivery: ['close'],
  reports: [],
  calls: ['qualify'],
  territories: ['owner'],
  setup: ['in', 'owner'],
};

const PAGE_CONTEXT: Record<SalesPageKey, string> = {
  overview: 'Sales Overview',
  'my-work': 'My Work',
  leads: 'Leads',
  'bid-pool': 'Bid Pool',
  triage: 'Lead Triage',
  callbacks: 'Callbacks',
  handovers: 'Handovers',
  stalled: 'Stalled leads',
  're-engagement': 'Re-engagement',
  imported: 'Imported leads',
  deals: 'Deals',
  approvals: 'Approvals',
  wins: 'Wins to record',
  proposal: 'Proposal',
  delivery: 'Delivery brief',
  reports: 'Reports',
  calls: 'Calls',
  territories: 'Territories',
  setup: 'Sales Setup',
};

type Body = Pick<Guidance, 'tone' | 'title' | 'detail'> & Partial<Pick<Guidance, 'short' | 'badge' | 'waitingOn' | 'tips'>> & { actions?: readonly GuideAction[] };

function page(key: SalesPageKey, body: Body): Guidance {
  return {
    context: PAGE_CONTEXT[key],
    steps: funnelMap(PAGE_STAGES[key]),
    stepsKind: 'map',
    actions: [],
    ...body,
  };
}

const addLead = run({ type: 'add-lead' });

/** The guide for a Sales page that has no counts of its own. */
export function pageGuidance(key: SalesPageKey, viewer: SalesPageViewer): Guidance {
  switch (key) {
    case 'overview':
      return page(key, viewer.isManager
        ? {
          tone: 'info',
          title: 'Check where leads are waiting',
          detail: 'Start with Triage (leads nobody took), then overdue follow-ups. Pool health shows how quickly agents claim new enquiries.',
          actions: [
            primary('Open Triage', go('/company/sales/triage')),
            ...(viewer.canDecideApprovals ? [secondary('Approvals', go('/company/sales/approvals'))] : []),
            ...(viewer.canRecordWin ? [secondary('Wins to record', go('/company/sales/wins'))] : []),
          ],
          tips: ['Every lead and deal page shows its own next step, so you can see at a glance what each one is waiting on.'],
        }
        : {
          tone: 'info',
          title: 'Start your day in My Work',
          detail: 'It lists what needs you, most urgent first: live calls handed to you, overdue callbacks, new leads and the Bid Pool.',
          actions: [primary('Open My Work', go('/company/sales/my-work'))],
        });
    case 'my-work':
      return myWorkGuidance({ handovers: 0, overdue: 0, newlyAssigned: 0, bidPool: 0, upcoming: 0 }, viewer);
    case 'leads':
      return leadsListGuidance({ firstCall: 0, unowned: 0 }, viewer);
    case 'bid-pool':
      return page(key, {
        tone: 'info',
        title: 'Claim the leads you can call right now',
        detail: 'New enquiries wait here for up to 10 minutes. Claim one and it is yours: call within 10 minutes. Pass if you cannot take it and it hides from you for 5 minutes.',
        tips: ['You need to be punched in to claim.', 'Leads nobody claims go to the free agent with the fewest open leads, or to Triage if nobody is free.'],
      });
    case 'triage':
      return page(key, {
        tone: 'info',
        title: 'Give each lead an owner',
        detail: 'These leads were not claimed in the Bid Pool and no agent was free to take them. Assign each one, send it back to the pool, or close it if it is junk.',
      });
    case 'callbacks':
      return page(key, {
        tone: 'info',
        title: 'Call people back on time',
        detail: 'Each callback reminds its owner an hour before and 15 minutes before. One not done within 30 minutes of its time is marked missed.',
        tips: ['Book a callback from the lead’s page. After the call, record how it went there or here.'],
      });
    case 'handovers':
      return page(key, {
        tone: 'info',
        title: 'Pass a live call to someone senior',
        detail: 'From a lead’s page, offer the call to a supervisor or team lead who is punched in. They have 5 minutes to accept. If nobody is free, queue it for the sales team.',
        tips: ['Whoever takes the call records the outcome: accepted, callback, or rejected.'],
      });
    case 'stalled':
      return page(key, {
        tone: 'info',
        title: 'Revive leads that went quiet',
        detail: 'A lead lands here after a week (or your company’s setting) with no activity, or after a missed callback. Call it, give it to someone who can work it, or mark it lost.',
      });
    case 're-engagement':
      return page(key, {
        tone: 'info',
        title: 'Win back lost leads',
        detail: 'Lost leads grouped by source, reason and month. A group lost to bad timing is a good start for a new campaign.',
      });
    case 'imported':
      return page(key, {
        tone: 'info',
        title: 'Work through imported lists',
        detail: 'Leads from files and Google Sheets. Assign each list to agents, then follow the calls made against it.',
      });
    case 'deals':
      return page(key, {
        tone: 'info',
        title: 'Open a deal to see what it is waiting on',
        detail: 'Every deal goes through the same checks before it can be won: a published proposal, approval if needed, the advance payment, and a delivery brief.',
        actions: viewer.canRecordWin ? [secondary('Wins to record', go('/company/sales/wins'))] : [],
        tips: ['A deal starts from a qualified lead: open the lead and choose “Qualify into a deal”.'],
      });
    case 'approvals':
      return page(key, {
        tone: 'info',
        title: 'Decide each request quickly',
        detail: 'A proposal lands here when its price, discount, advance or terms go beyond the salesperson’s limits. Approve it, send it back for changes, or reject it.',
        tips: ['A request not decided within 4 business hours moves up to the approver’s manager.', 'Nobody can approve their own proposal.'],
      });
    case 'wins':
      return page(key, {
        tone: 'info',
        title: 'Record the wins that are ready',
        detail: 'Each deal here has its proposal, approval and advance in place. Open it, check the delivery brief, and record the win.',
      });
    case 'proposal':
      return page(key, {
        tone: 'info',
        title: 'Build it, publish it, share it',
        detail: 'Add the items, price, advance and terms, then publish. If anything goes beyond your limits, request approval first. Once published, share the link so the client can accept.',
        tips: ['Publishing locks a version. To change it later, create a new version.'],
      });
    case 'delivery':
      return page(key, {
        tone: 'info',
        title: 'Tell delivery what was sold',
        detail: 'Fill in each section and submit. The delivery team reviews it, asks for changes if something is missing, and starts the project.',
        tips: ['The deal cannot be recorded as won until a delivery brief exists.'],
      });
    case 'reports':
      return page(key, {
        tone: 'info',
        title: 'See what is working',
        detail: 'Compare sources, people and stages to find where leads drop out of the funnel.',
      });
    case 'calls':
      return page(key, {
        tone: 'info',
        title: 'Calls sync from your phone system',
        detail: 'Each synced call also shows on the matching lead’s timeline, matched by phone number.',
      });
    case 'territories':
      return page(key, {
        tone: 'info',
        title: 'Territories decide who gets inbound leads',
        detail: 'Each territory points to a sales team, so inbound leads from that area go to that team. Leads someone adds from an outbound source stay with them.',
      });
    case 'setup':
      return page(key, {
        tone: 'info',
        title: 'Finish setup so leads can flow',
        detail: 'Work down the checklist: lead sources, sales teams and pools, territories, then call integrations.',
      });
    default:
      return page('overview', { tone: 'info', title: 'Sales', detail: 'Open a lead or a deal to see its next step.' });
  }
}

export interface MyWorkCounts {
  readonly handovers: number;
  readonly overdue: number;
  readonly newlyAssigned: number;
  readonly bidPool: number;
  readonly upcoming: number;
}

/** The anchors MyWorkPage gives its sections. */
export const MY_WORK_ANCHORS = {
  bidPool: 'my-work-bid-pool',
  callbacks: 'my-work-callbacks',
  handovers: 'my-work-handovers',
  newlyAssigned: 'my-work-new-leads',
} as const;

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** My Work's guide: the most urgent kind of work first. */
export function myWorkGuidance(counts: MyWorkCounts, _viewer: SalesPageViewer): Guidance {
  const also: string[] = [];
  if (counts.overdue) also.push(plural(counts.overdue, 'overdue callback', 'overdue callbacks'));
  if (counts.newlyAssigned) also.push(plural(counts.newlyAssigned, 'new lead to call', 'new leads to call'));
  if (counts.bidPool) also.push(plural(counts.bidPool, 'lead in the Bid Pool', 'leads in the Bid Pool'));
  const tipsAfter = (first: string): string[] | undefined => {
    const rest = also.filter((item) => !item.includes(first));
    return rest.length ? [`After that: ${rest.join(', ')}.`] : undefined;
  };

  if (counts.handovers) {
    return page('my-work', {
      tone: 'act',
      title: counts.handovers === 1 ? 'Answer the live call waiting for you' : `Answer the ${counts.handovers} live calls waiting for you`,
      short: 'Live call waiting',
      badge: 'Live call',
      detail: 'A colleague is on the phone with a customer and wants you to take over. Accept or decline before the offer lapses (5 minutes).',
      waitingOn: 'You',
      actions: [primary('Go to handover offers', focus(MY_WORK_ANCHORS.handovers))],
      tips: tipsAfter('live'),
    });
  }
  if (counts.overdue) {
    return page('my-work', {
      tone: 'act',
      title: counts.overdue === 1 ? 'Make your overdue callback' : `Make your ${counts.overdue} overdue callbacks`,
      short: 'Callbacks overdue',
      badge: 'Overdue',
      detail: 'These were due already. Call now and record how each one went. A callback not done within 30 minutes of its time is marked missed.',
      waitingOn: 'You',
      actions: [primary('Go to callbacks', focus(MY_WORK_ANCHORS.callbacks))],
      tips: tipsAfter('overdue'),
    });
  }
  if (counts.newlyAssigned) {
    return page('my-work', {
      tone: 'act',
      title: counts.newlyAssigned === 1 ? 'Call your new lead' : `Call your ${counts.newlyAssigned} new leads`,
      short: 'New leads to call',
      detail: 'The sooner you make the first call, the better your chances. Open each lead: its page tells you what to do after the call.',
      waitingOn: 'You',
      actions: [primary('Go to new leads', focus(MY_WORK_ANCHORS.newlyAssigned))],
      tips: tipsAfter('new lead'),
    });
  }
  if (counts.bidPool) {
    return page('my-work', {
      tone: 'act',
      title: counts.bidPool === 1 ? 'A new enquiry is waiting in the Bid Pool' : `${counts.bidPool} new enquiries are waiting in the Bid Pool`,
      short: 'Leads to claim',
      detail: 'Claim the ones you can call now. Anything nobody claims within 10 minutes goes to the free agent with the fewest open leads.',
      waitingOn: 'An agent to claim them',
      actions: [primary('Go to the Bid Pool', focus(MY_WORK_ANCHORS.bidPool))],
    });
  }
  if (counts.upcoming) {
    return page('my-work', {
      tone: 'wait',
      title: 'You are on top of things',
      short: 'All caught up',
      detail: `${plural(counts.upcoming, 'callback is', 'callbacks are')} coming up in the next 24 hours. TapIt reminds you before each one.`,
      actions: [secondary('Open your leads', go('/company/sales/leads'))],
    });
  }
  return page('my-work', {
    tone: 'done',
    title: 'You are all caught up',
    short: 'All caught up',
    detail: 'Nothing needs you right now. Live calls handed to you, callbacks, new leads and Bid Pool enquiries show up here as they arrive.',
    actions: [secondary('Open your leads', go('/company/sales/leads'))],
  });
}

export interface LeadListCounts {
  /** The viewer's own leads still waiting for a first call. */
  readonly firstCall: number;
  /** Leads with no owner yet (visible to managers). */
  readonly unowned: number;
}

/** The Leads page's guide. */
export function leadsListGuidance(counts: LeadListCounts, viewer: SalesPageViewer): Guidance {
  const add = viewer.canAddLeads ? [secondary('Add a lead', addLead)] : [];
  if (viewer.isManager && counts.unowned) {
    return page('leads', {
      tone: 'act',
      title: counts.unowned === 1 ? 'A lead has no owner yet' : `${counts.unowned} leads have no owner yet`,
      short: 'Leads need owners',
      detail: 'They are waiting in the Bid Pool or in Triage. Open Triage to give each one an owner.',
      actions: [primary('Open Triage', go('/company/sales/triage')), ...add],
    });
  }
  if (counts.firstCall) {
    return page('leads', {
      tone: 'act',
      title: counts.firstCall === 1 ? 'One of your leads is waiting for a first call' : `${counts.firstCall} of your leads are waiting for a first call`,
      short: 'Leads to call',
      detail: 'They are marked “Call them” in the list. Open one: its page shows the number, and what to do after the call.',
      waitingOn: 'You',
      actions: add,
    });
  }
  return page('leads', {
    tone: 'info',
    title: 'Open a lead to see its next step',
    detail: viewer.canAddLeads
      ? 'Every lead’s page says what to do next. Add a lead when you find a customer yourself: from an outbound source it stays with you; from an inbound source TapIt routes it.'
      : 'Every lead’s page says what to do next.',
    actions: [
      ...(viewer.canAddLeads ? [primary('Add a lead', addLead)] : []),
      ...(viewer.isManager ? [secondary('Stalled leads', go('/company/sales/leads/stalled'))] : []),
    ],
  });
}

/** Which guide a Sales path gets: a page key, a lead or deal page (which bring their own), or none. */
export function salesGuideKey(pathname: string): SalesPageKey | 'lead' | 'deal' | null {
  const path = pathname.split('?')[0]!.replace(/\/+$/, '');
  if (path !== '/company/sales' && !path.startsWith('/company/sales/')) return null;
  const exact: Readonly<Record<string, SalesPageKey>> = {
    '/company/sales': 'overview',
    '/company/sales/supervisor': 'overview',
    '/company/sales/setup': 'setup',
    '/company/sales/my-work': 'my-work',
    '/company/sales/bid-pool': 'bid-pool',
    '/company/sales/triage': 'triage',
    '/company/sales/leads': 'leads',
    '/company/sales/leads/stalled': 'stalled',
    '/company/sales/leads/re-engagement': 're-engagement',
    '/company/sales/leads/imported': 'imported',
    '/company/sales/deals': 'deals',
    '/company/sales/approvals': 'approvals',
    '/company/sales/wins': 'wins',
    '/company/sales/reports': 'reports',
    '/company/sales/territories': 'territories',
    '/company/sales/call-integrations': 'calls',
  };
  const known = exact[path];
  if (known) return known;
  if (path.startsWith('/company/sales/callbacks')) return 'callbacks';
  if (path.startsWith('/company/sales/handovers')) return 'handovers';
  if (path.startsWith('/company/sales/calls')) return 'calls';
  if (path.startsWith('/company/sales/territories/')) return 'territories';
  if (/^\/company\/sales\/deals\/[^/]+\/proposals$/.test(path)) return 'proposal';
  if (/^\/company\/sales\/deals\/[^/]+\/delivery$/.test(path)) return 'delivery';
  if (/^\/company\/sales\/deals\/[^/]+$/.test(path)) return 'deal';
  if (/^\/company\/sales\/leads\/[^/]+$/.test(path)) return 'lead';
  return null;
}

/** The guide shown until a page shows its own (lead and deal pages always do once loaded). */
export function guideForPath(key: SalesPageKey | 'lead' | 'deal', viewer: SalesPageViewer): Guidance {
  if (key === 'lead' || key === 'deal') {
    return { context: key === 'lead' ? 'Lead' : 'Deal', tone: 'info', title: 'Working out the next step…', detail: `Loading the ${key}.`, actions: [] };
  }
  return pageGuidance(key, viewer);
}

import { describe, expect, it } from 'vitest';
import { guideForPath, leadsListGuidance, myWorkGuidance, pageGuidance, salesGuideKey, type SalesPageKey, type SalesPageViewer } from './page-guidance.js';

const AGENT: SalesPageViewer = { isManager: false, canAddLeads: true, canRecordWin: false, canDecideApprovals: false };
const HEAD: SalesPageViewer = { isManager: true, canAddLeads: true, canRecordWin: true, canDecideApprovals: true };
const NONE = { handovers: 0, overdue: 0, newlyAssigned: 0, bidPool: 0, upcoming: 0 };

describe('page guidance', () => {
  it('gives every Sales page a title, an explanation and its place in the funnel', () => {
    const pages: SalesPageKey[] = ['overview', 'my-work', 'leads', 'bid-pool', 'triage', 'callbacks', 'handovers', 'stalled', 're-engagement', 'imported', 'deals', 'approvals', 'wins', 'proposal', 'delivery', 'reports', 'calls', 'territories', 'setup'];
    for (const key of pages) {
      const g = pageGuidance(key, AGENT);
      expect(g.title.length, key).toBeGreaterThan(5);
      expect(g.detail.length, key).toBeGreaterThan(20);
      expect(g.stepsKind, key).toBe('map');
      expect(g.steps?.length, key).toBe(6);
    }
    expect(pageGuidance('approvals', AGENT).steps?.filter((step) => step.state === 'current').map((step) => step.key)).toEqual(['proposal']);
  });

  it('sends managers to Triage from the overview and agents to My Work', () => {
    expect(pageGuidance('overview', HEAD).actions[0]?.do).toEqual({ kind: 'navigate', to: '/company/sales/triage' });
    expect(pageGuidance('overview', AGENT).actions[0]?.do).toEqual({ kind: 'navigate', to: '/company/sales/my-work' });
  });
});

describe('My Work guidance', () => {
  it('puts live calls first, then overdue callbacks, new leads and the Bid Pool', () => {
    expect(myWorkGuidance({ ...NONE, handovers: 1, overdue: 2, newlyAssigned: 3 }, AGENT).title).toBe('Answer the live call waiting for you');
    expect(myWorkGuidance({ ...NONE, overdue: 2, newlyAssigned: 3 }, AGENT).title).toBe('Make your 2 overdue callbacks');
    expect(myWorkGuidance({ ...NONE, newlyAssigned: 1, bidPool: 4 }, AGENT).title).toBe('Call your new lead');
    expect(myWorkGuidance({ ...NONE, bidPool: 4 }, AGENT).title).toBe('4 new enquiries are waiting in the Bid Pool');
  });

  it('lists what comes after the first job', () => {
    const g = myWorkGuidance({ ...NONE, overdue: 1, newlyAssigned: 2, bidPool: 1 }, AGENT);
    expect(g.tips).toEqual(['After that: 2 new leads to call, 1 lead in the Bid Pool.']);
  });

  it('says so when there is nothing to do', () => {
    expect(myWorkGuidance(NONE, AGENT).tone).toBe('done');
    expect(myWorkGuidance({ ...NONE, upcoming: 2 }, AGENT).detail).toBe('2 callbacks are coming up in the next 24 hours. TapIt reminds you before each one.');
  });
});

describe('Leads list guidance', () => {
  it('asks managers to give unowned leads an owner', () => {
    expect(leadsListGuidance({ firstCall: 0, unowned: 3 }, HEAD).title).toBe('3 leads have no owner yet');
    expect(leadsListGuidance({ firstCall: 0, unowned: 3 }, AGENT).title).toBe('Open a lead to see its next step');
  });

  it('counts the viewer’s leads waiting for a first call', () => {
    expect(leadsListGuidance({ firstCall: 1, unowned: 0 }, AGENT).title).toBe('One of your leads is waiting for a first call');
  });
});

describe('which guide a path gets', () => {
  it('maps Sales paths to their guide', () => {
    expect(salesGuideKey('/company/sales')).toBe('overview');
    expect(salesGuideKey('/company/sales/leads/')).toBe('leads');
    expect(salesGuideKey('/company/sales/leads/stalled')).toBe('stalled');
    expect(salesGuideKey('/company/sales/leads/9f2c')).toBe('lead');
    expect(salesGuideKey('/company/sales/deals/9f2c')).toBe('deal');
    expect(salesGuideKey('/company/sales/deals/9f2c/proposals')).toBe('proposal');
    expect(salesGuideKey('/company/sales/callbacks/board')).toBe('callbacks');
    expect(salesGuideKey('/company/sales/leads/imported?import=1')).toBe('imported');
  });

  it('leaves the rest of TapIt alone', () => {
    expect(salesGuideKey('/company/messages')).toBeNull();
    expect(salesGuideKey('/company/salesforce')).toBeNull();
  });

  it('holds a loading guide for lead and deal pages', () => {
    expect(guideForPath('lead', AGENT).title).toBe('Working out the next step…');
  });
});

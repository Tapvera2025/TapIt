import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useCompanyPageMetadata } from '../../layout/CompanyNavbarContext.js';
import { RecruitmentTabs } from '../components/RecruitmentTabs.js';
import { RecruitmentHeroActionsProvider } from '../components/RecruitmentHeroActionsContext.js';
import { RecruitmentOverviewPage } from './RecruitmentOverviewPage.js';
import { RequisitionsPage } from './RequisitionsPage.js';
import { ResumeInboxPage } from './ResumeInboxPage.js';
import { CandidatesPage } from './CandidatesPage.js';
import { InterviewsPage } from './InterviewsPage.js';
import { OffersPage } from './OffersPage.js';
import { JoiningPage } from './JoiningPage.js';
import { MyInterviewsPage } from './MyInterviewsPage.js';
import { EmailTemplatesPage } from './EmailTemplatesPage.js';
import { RequisitionFormModal } from '../components/RequisitionFormModal.js';
import { CandidateFormModal } from '../components/CandidateFormModal.js';
import { InterviewScheduleModal } from '../components/InterviewScheduleModal.js';
import { OfferFormModal } from '../components/OfferFormModal.js';
import { listRequisitions } from '../api/recruitmentApi.js';
import type { Candidate, JobRequisition, RecruitmentTab } from '../types/index.js';

export function RecruitmentWorkspace({
  pathname,
  onNavigate,
}: {
  readonly pathname: string;
  readonly onNavigate: (path: string) => void;
}): React.JSX.Element {
  // Global modal shortcuts
  const [globalCreateReqOpen, setGlobalCreateReqOpen] = useState(false);
  const [globalAddCandOpen, setGlobalAddCandOpen] = useState(false);
  const [defaultRequisitionId, setDefaultRequisitionId] = useState<string | undefined>(undefined);
  const [requisitions, setRequisitions] = useState<JobRequisition[]>([]);
  const [scheduleInterviewCandidate, setScheduleInterviewCandidate] = useState<Candidate | null>(null);
  const [createOfferCandidate, setCreateOfferCandidate] = useState<Candidate | null>(null);
  const [tabHeroActions, setTabHeroActions] = useState<ReactNode | null>(null);

  // Active tab derivation
  const activeTab: RecruitmentTab = pathname.startsWith('/company/recruitment/requisitions')
    ? 'requisitions'
    : pathname.startsWith('/company/recruitment/resumes')
      ? 'resumes'
      : pathname.startsWith('/company/recruitment/candidates')
        ? 'candidates'
        : pathname.startsWith('/company/recruitment/interviews')
          ? 'interviews'
          : pathname.startsWith('/company/recruitment/offers')
            ? 'offers'
            : pathname.startsWith('/company/recruitment/joining')
              ? 'joining'
              : pathname.startsWith('/company/recruitment/my-interviews')
                ? 'my-interviews'
                : pathname.startsWith('/company/recruitment/email-templates')
                  ? 'email-templates'
                  : 'overview';

  async function loadRequisitions() {
    try {
      const data = await listRequisitions();
      setRequisitions(data);
    } catch {
      // Gracefully handled by child pages/api
    }
  }

  useEffect(() => {
    void loadRequisitions();
  }, [activeTab, globalAddCandOpen]);

  const handleNavigate = useCallback((path: string) => {
    onNavigate(path);
  }, [onNavigate]);

  const navigateToCandidates = useCallback(() => {
    onNavigate('/company/recruitment/candidates');
  }, [onNavigate]);

  const navigateToJoining = useCallback(() => {
    onNavigate('/company/recruitment/joining');
  }, [onNavigate]);

  const navigateToEmployees = useCallback(() => {
    onNavigate('/company/employees');
  }, [onNavigate]);

  const openCreateRequisition = useCallback(() => {
    setGlobalCreateReqOpen(true);
  }, []);

  const openAddCandidate = useCallback(() => {
    setDefaultRequisitionId(undefined);
    setGlobalAddCandOpen(true);
  }, []);

  const recruitmentActions = useMemo(() => (
    <div className="company-page-hero-actions">
      <button
        type="button"
        onClick={openAddCandidate}
        className="inline-flex items-center gap-1.5 rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs font-semibold text-app-foreground transition hover:border-app-accent hover:text-app-accent"
      >
        + Add Candidate
      </button>
      <button
        type="button"
        onClick={openCreateRequisition}
        className="ui-primary inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
      >
        + Create Requisition
      </button>
    </div>
  ), [openAddCandidate, openCreateRequisition]);

  const pageMetadata = useMemo(() => ({
    eyebrow: 'Human resources',
    title: 'Recruitment',
    description: 'Manage recruitment, candidates and employee onboarding.',
    // Only Overview owns the two global shortcuts. Every other recruitment
    // screen publishes its own action(s) to the utility capsule.
    extension: activeTab === 'overview' ? recruitmentActions : tabHeroActions,
  }), [activeTab, recruitmentActions, tabHeroActions]);

  useCompanyPageMetadata(pageMetadata);

  function handleScheduleInterview(candidate: Candidate) {
    setScheduleInterviewCandidate(candidate);
  }

  function handleCreateOffer(candidate: Candidate) {
    setCreateOfferCandidate(candidate);
  }

  return (
    <RecruitmentHeroActionsProvider setActions={setTabHeroActions}>
      <div className="w-full max-w-full overflow-x-hidden">
      {/* Top Section Navigation Tabs */}
      <div className="w-full max-w-full px-4 pt-8 md:px-8 md:pt-10">
        <div className="mx-auto max-w-7xl">
          <RecruitmentTabs
            activeTab={activeTab}
            onNavigate={handleNavigate}
          />
        </div>
      </div>

      {/* Active Tab Screen */}
      <div key={activeTab} className="recruitment-route-transition mt-4 md:mt-6">
      {activeTab === 'requisitions' ? (
        <RequisitionsPage
          onAddCandidateForRequisition={(req) => {
            setDefaultRequisitionId(req.id);
            setGlobalAddCandOpen(true);
          }}
        />
      ) : activeTab === 'resumes' ? (
        <ResumeInboxPage
          onNavigateToCandidate={navigateToCandidates}
        />
      ) : activeTab === 'candidates' ? (
        <CandidatesPage
          onScheduleInterview={handleScheduleInterview}
          onCreateOffer={handleCreateOffer}
        />
      ) : activeTab === 'interviews' ? (
        <InterviewsPage
          preselectedCandidate={scheduleInterviewCandidate ?? undefined}
        />
      ) : activeTab === 'offers' ? (
        <OffersPage
          preselectedCandidate={createOfferCandidate ?? undefined}
          onNavigateToJoining={navigateToJoining}
        />
      ) : activeTab === 'joining' ? (
        <JoiningPage
          onNavigateToEmployees={navigateToEmployees}
        />
      ) : activeTab === 'my-interviews' ? (
        <MyInterviewsPage />
      ) : activeTab === 'email-templates' ? (
        <EmailTemplatesPage />
      ) : (
        <RecruitmentOverviewPage
          onNavigate={handleNavigate}
          onOpenCreateRequisition={openCreateRequisition}
          onOpenAddCandidate={openAddCandidate}
        />
      )}
      </div>

      {/* Global Quick Action Modals */}
      {globalCreateReqOpen && (
        <RequisitionFormModal
          onClose={() => setGlobalCreateReqOpen(false)}
          onCreated={() => {
            void loadRequisitions();
            handleNavigate('/company/recruitment/requisitions');
          }}
        />
      )}

      {globalAddCandOpen && (
        <CandidateFormModal
          requisitions={requisitions}
          defaultRequisitionId={defaultRequisitionId}
          onClose={() => {
            setGlobalAddCandOpen(false);
            setDefaultRequisitionId(undefined);
          }}
          onCreated={() => {
            setGlobalAddCandOpen(false);
            setDefaultRequisitionId(undefined);
            handleNavigate('/company/recruitment/candidates');
          }}
        />
      )}

      {scheduleInterviewCandidate && (
        <InterviewScheduleModal
          candidates={[scheduleInterviewCandidate]}
          requisitions={requisitions}
          preselectedCandidate={scheduleInterviewCandidate}
          onClose={() => setScheduleInterviewCandidate(null)}
          onScheduled={() => {
            setScheduleInterviewCandidate(null);
            handleNavigate('/company/recruitment/interviews');
          }}
        />
      )}

      {createOfferCandidate && (
        <OfferFormModal
          candidates={[createOfferCandidate]}
          requisitions={requisitions}
          preselectedCandidate={createOfferCandidate}
          onClose={() => setCreateOfferCandidate(null)}
          onCreated={() => {
            setCreateOfferCandidate(null);
            handleNavigate('/company/recruitment/offers');
          }}
        />
      )}
      </div>
    </RecruitmentHeroActionsProvider>
  );
}

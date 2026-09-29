import { useEffect, useState } from 'react';
import { RecruitmentTabs } from '../components/RecruitmentTabs.js';
import { RecruitmentOverviewPage } from './RecruitmentOverviewPage.js';
import { RequisitionsPage } from './RequisitionsPage.js';
import { ResumeInboxPage } from './ResumeInboxPage.js';
import { CandidatesPage } from './CandidatesPage.js';
import { InterviewsPage } from './InterviewsPage.js';
import { OffersPage } from './OffersPage.js';
import { JoiningPage } from './JoiningPage.js';
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

  function handleNavigate(path: string) {
    onNavigate(path);
  }

  function handleScheduleInterview(candidate: Candidate) {
    setScheduleInterviewCandidate(candidate);
  }

  function handleCreateOffer(candidate: Candidate) {
    setCreateOfferCandidate(candidate);
  }

  return (
    <div>
      {/* Top Section Navigation Tabs */}
      <div className="px-5 pt-4 md:px-8">
        <div className="mx-auto max-w-7xl">
          <RecruitmentTabs
            activeTab={activeTab}
            onNavigate={handleNavigate}
          />
        </div>
      </div>

      {/* Active Tab Screen */}
      {activeTab === 'requisitions' ? (
        <RequisitionsPage
          onAddCandidateForRequisition={(req) => {
            setDefaultRequisitionId(req.id);
            setGlobalAddCandOpen(true);
          }}
        />
      ) : activeTab === 'resumes' ? (
        <ResumeInboxPage
          onNavigateToCandidate={() => handleNavigate('/company/recruitment/candidates')}
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
          onNavigateToJoining={() => handleNavigate('/company/recruitment/joining')}
        />
      ) : activeTab === 'joining' ? (
        <JoiningPage
          onNavigateToEmployees={() => handleNavigate('/company/employees')}
        />
      ) : (
        <RecruitmentOverviewPage
          onNavigate={handleNavigate}
          onOpenCreateRequisition={() => setGlobalCreateReqOpen(true)}
          onOpenAddCandidate={() => {
            setDefaultRequisitionId(undefined);
            setGlobalAddCandOpen(true);
          }}
        />
      )}

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
  );
}

import type {
  ApplicationLinkStatus,
  CandidateStatus,
  InterviewStage,
  InterviewStatus,
  JoiningStatus,
  OfferStatus,
  RequisitionStatus,
  ResumeSubmissionStatus,
} from '../types/index.js';

interface StatusConfig {
  readonly label: string;
  readonly symbol: string;
  readonly textColor: string;
  readonly badgeBg: string;
}

// ---------------------------------------------------------------------
// 1. Requisition Status Badge
// ---------------------------------------------------------------------

const REQ_STATUS_CONFIGS: Record<RequisitionStatus, StatusConfig> = {
  draft: {
    label: 'Draft',
    symbol: '○',
    textColor: 'text-neutral-500 dark:text-neutral-400',
    badgeBg: 'bg-neutral-500/10 border-neutral-500/20',
  },
  open: {
    label: 'Open',
    symbol: '●',
    textColor: 'text-emerald-700 dark:text-emerald-300',
    badgeBg: 'bg-emerald-500/10 border-emerald-500/20',
  },
  on_hold: {
    label: 'On Hold',
    symbol: '⏸',
    textColor: 'text-amber-700 dark:text-amber-300',
    badgeBg: 'bg-amber-500/10 border-amber-500/20',
  },
  filled: {
    label: 'Filled',
    symbol: '✓',
    textColor: 'text-sky-700 dark:text-sky-300',
    badgeBg: 'bg-sky-500/10 border-sky-500/20',
  },
  closed: {
    label: 'Closed',
    symbol: '✕',
    textColor: 'text-neutral-600 dark:text-neutral-400',
    badgeBg: 'bg-neutral-500/10 border-neutral-500/20',
  },
  cancelled: {
    label: 'Cancelled',
    symbol: '✕',
    textColor: 'text-rose-700 dark:text-rose-300',
    badgeBg: 'bg-rose-500/10 border-rose-500/20',
  },
};

export function RequisitionStatusBadge({
  status,
  className = '',
}: {
  readonly status: RequisitionStatus;
  readonly className?: string | undefined;
}): React.JSX.Element {
  const config = REQ_STATUS_CONFIGS[status] ?? {
    label: status,
    symbol: '•',
    textColor: 'text-app-muted',
    badgeBg: 'bg-app-surface border-app-border',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${config.badgeBg} ${config.textColor} ${className}`}
      role="status"
    >
      <span className="text-[10px] leading-none" aria-hidden="true">
        {config.symbol}
      </span>
      <span>{config.label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------
// 2. Candidate Status Badge
// ---------------------------------------------------------------------

const CANDIDATE_STATUS_CONFIGS: Record<CandidateStatus, StatusConfig> = {
  applied: {
    label: 'Applied',
    symbol: '○',
    textColor: 'text-neutral-600 dark:text-neutral-300',
    badgeBg: 'bg-neutral-500/10 border-neutral-500/20',
  },
  screening: {
    label: 'Screening',
    symbol: '🔍',
    textColor: 'text-purple-700 dark:text-purple-300',
    badgeBg: 'bg-purple-500/10 border-purple-500/20',
  },
  interview: {
    label: 'Interviewing',
    symbol: '●',
    textColor: 'text-sky-700 dark:text-sky-300',
    badgeBg: 'bg-sky-500/10 border-sky-500/20',
  },
  selected: {
    label: 'Selected',
    symbol: '★',
    textColor: 'text-emerald-700 dark:text-emerald-300',
    badgeBg: 'bg-emerald-500/10 border-emerald-500/20',
  },
  rejected: {
    label: 'Rejected',
    symbol: '✕',
    textColor: 'text-rose-700 dark:text-rose-300',
    badgeBg: 'bg-rose-500/10 border-rose-500/20',
  },
  withdrawn: {
    label: 'Withdrawn',
    symbol: '↩',
    textColor: 'text-amber-700 dark:text-amber-300',
    badgeBg: 'bg-amber-500/10 border-amber-500/20',
  },
};

export function CandidateStatusBadge({
  status,
  className = '',
}: {
  readonly status: CandidateStatus;
  readonly className?: string | undefined;
}): React.JSX.Element {
  const config = CANDIDATE_STATUS_CONFIGS[status] ?? {
    label: status,
    symbol: '•',
    textColor: 'text-app-muted',
    badgeBg: 'bg-app-surface border-app-border',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${config.badgeBg} ${config.textColor} ${className}`}
      role="status"
    >
      <span className="text-[10px] leading-none" aria-hidden="true">
        {config.symbol}
      </span>
      <span>{config.label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------
// 3. Interview Status & Stage Badges
// ---------------------------------------------------------------------

const INTERVIEW_STATUS_CONFIGS: Record<InterviewStatus, StatusConfig> = {
  scheduled: {
    label: 'Scheduled',
    symbol: '📅',
    textColor: 'text-sky-700 dark:text-sky-300',
    badgeBg: 'bg-sky-500/10 border-sky-500/20',
  },
  completed: {
    label: 'Completed',
    symbol: '✓',
    textColor: 'text-emerald-700 dark:text-emerald-300',
    badgeBg: 'bg-emerald-500/10 border-emerald-500/20',
  },
  cancelled: {
    label: 'Cancelled',
    symbol: '✕',
    textColor: 'text-neutral-500 dark:text-neutral-400',
    badgeBg: 'bg-neutral-500/10 border-neutral-500/20',
  },
  rescheduled: {
    label: 'Rescheduled',
    symbol: '↻',
    textColor: 'text-amber-700 dark:text-amber-300',
    badgeBg: 'bg-amber-500/10 border-amber-500/20',
  },
  no_show: {
    label: 'No Show',
    symbol: '⚠',
    textColor: 'text-rose-700 dark:text-rose-300',
    badgeBg: 'bg-rose-500/10 border-rose-500/20',
  },
};

export function InterviewStatusBadge({
  status,
  className = '',
}: {
  readonly status: InterviewStatus;
  readonly className?: string | undefined;
}): React.JSX.Element {
  const config = INTERVIEW_STATUS_CONFIGS[status] ?? {
    label: status,
    symbol: '•',
    textColor: 'text-app-muted',
    badgeBg: 'bg-app-surface border-app-border',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${config.badgeBg} ${config.textColor} ${className}`}
      role="status"
    >
      <span className="text-[10px] leading-none" aria-hidden="true">
        {config.symbol}
      </span>
      <span>{config.label}</span>
    </span>
  );
}

export function InterviewStageBadge({
  stage,
  className = '',
}: {
  readonly stage: InterviewStage;
  readonly className?: string | undefined;
}): React.JSX.Element {
  const stageLabels: Record<InterviewStage, string> = {
    screening: 'Screening',
    technical: 'Technical',
    managerial: 'Managerial',
    hr: 'HR Round',
    final: 'Final Round',
  };

  return (
    <span
      className={`inline-flex items-center rounded border border-app-border bg-app-surface px-2 py-0.5 text-xs font-medium text-app-foreground ${className}`}
    >
      {stageLabels[stage] ?? stage}
    </span>
  );
}

// ---------------------------------------------------------------------
// 4. Offer Status Badge
// ---------------------------------------------------------------------

const OFFER_STATUS_CONFIGS: Record<OfferStatus, StatusConfig> = {
  draft: {
    label: 'Draft',
    symbol: '○',
    textColor: 'text-neutral-500 dark:text-neutral-400',
    badgeBg: 'bg-neutral-500/10 border-neutral-500/20',
  },
  sent: {
    label: 'Sent',
    symbol: '✉',
    textColor: 'text-sky-700 dark:text-sky-300',
    badgeBg: 'bg-sky-500/10 border-sky-500/20',
  },
  accepted: {
    label: 'Accepted',
    symbol: '✓',
    textColor: 'text-emerald-700 dark:text-emerald-300',
    badgeBg: 'bg-emerald-500/10 border-emerald-500/20',
  },
  rejected: {
    label: 'Declined',
    symbol: '✕',
    textColor: 'text-rose-700 dark:text-rose-300',
    badgeBg: 'bg-rose-500/10 border-rose-500/20',
  },
  expired: {
    label: 'Expired',
    symbol: '⌛',
    textColor: 'text-amber-700 dark:text-amber-300',
    badgeBg: 'bg-amber-500/10 border-amber-500/20',
  },
  withdrawn: {
    label: 'Withdrawn',
    symbol: '↩',
    textColor: 'text-neutral-600 dark:text-neutral-400',
    badgeBg: 'bg-neutral-500/10 border-neutral-500/20',
  },
};

export function OfferStatusBadge({
  status,
  className = '',
}: {
  readonly status: OfferStatus;
  readonly className?: string | undefined;
}): React.JSX.Element {
  const config = OFFER_STATUS_CONFIGS[status] ?? {
    label: status,
    symbol: '•',
    textColor: 'text-app-muted',
    badgeBg: 'bg-app-surface border-app-border',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${config.badgeBg} ${config.textColor} ${className}`}
      role="status"
    >
      <span className="text-[10px] leading-none" aria-hidden="true">
        {config.symbol}
      </span>
      <span>{config.label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------
// 5. Joining Status Badge
// ---------------------------------------------------------------------

const JOINING_STATUS_CONFIGS: Record<JoiningStatus, StatusConfig> = {
  pending: {
    label: 'Pending',
    symbol: '⏳',
    textColor: 'text-amber-700 dark:text-amber-300',
    badgeBg: 'bg-amber-500/10 border-amber-500/20',
  },
  confirmed: {
    label: 'Confirmed',
    symbol: '●',
    textColor: 'text-sky-700 dark:text-sky-300',
    badgeBg: 'bg-sky-500/10 border-sky-500/20',
  },
  joined: {
    label: 'Joined',
    symbol: '✓',
    textColor: 'text-emerald-700 dark:text-emerald-300',
    badgeBg: 'bg-emerald-500/10 border-emerald-500/20',
  },
  cancelled: {
    label: 'Cancelled',
    symbol: '✕',
    textColor: 'text-rose-700 dark:text-rose-300',
    badgeBg: 'bg-rose-500/10 border-rose-500/20',
  },
};

export function JoiningStatusBadge({
  status,
  className = '',
}: {
  readonly status: JoiningStatus;
  readonly className?: string | undefined;
}): React.JSX.Element {
  const config = JOINING_STATUS_CONFIGS[status] ?? {
    label: status,
    symbol: '•',
    textColor: 'text-app-muted',
    badgeBg: 'bg-app-surface border-app-border',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${config.badgeBg} ${config.textColor} ${className}`}
      role="status"
    >
      <span className="text-[10px] leading-none" aria-hidden="true">
        {config.symbol}
      </span>
      <span>{config.label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------
// 7. Resume Submission Status Badge
// ---------------------------------------------------------------------

const RESUME_SUBMISSION_STATUS_CONFIGS: Record<ResumeSubmissionStatus, StatusConfig> = {
  submitted: {
    label: 'New Submitted',
    symbol: '●',
    textColor: 'text-sky-700 dark:text-sky-300',
    badgeBg: 'bg-sky-500/10 border-sky-500/20',
  },
  reviewed: {
    label: 'Reviewed',
    symbol: '🔍',
    textColor: 'text-amber-700 dark:text-amber-300',
    badgeBg: 'bg-amber-500/10 border-amber-500/20',
  },
  converted: {
    label: 'Added as Candidate',
    symbol: '✓',
    textColor: 'text-emerald-700 dark:text-emerald-300',
    badgeBg: 'bg-emerald-500/10 border-emerald-500/20',
  },
  rejected: {
    label: 'Rejected',
    symbol: '✕',
    textColor: 'text-rose-700 dark:text-rose-300',
    badgeBg: 'bg-rose-500/10 border-rose-500/20',
  },
};

export function ResumeSubmissionStatusBadge({
  status,
  className = '',
}: {
  readonly status: ResumeSubmissionStatus;
  readonly className?: string | undefined;
}): React.JSX.Element {
  const config = RESUME_SUBMISSION_STATUS_CONFIGS[status] ?? {
    label: status,
    symbol: '•',
    textColor: 'text-app-muted',
    badgeBg: 'bg-app-surface border-app-border',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${config.badgeBg} ${config.textColor} ${className}`}
      role="status"
    >
      <span className="text-[10px] leading-none" aria-hidden="true">
        {config.symbol}
      </span>
      <span>{config.label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------
// 8. Application Link Status Badge
// ---------------------------------------------------------------------

const APP_LINK_STATUS_CONFIGS: Record<ApplicationLinkStatus, StatusConfig> = {
  active: {
    label: 'Active Link',
    symbol: '●',
    textColor: 'text-emerald-700 dark:text-emerald-300',
    badgeBg: 'bg-emerald-500/10 border-emerald-500/20',
  },
  disabled: {
    label: 'Disabled',
    symbol: '⏸',
    textColor: 'text-neutral-600 dark:text-neutral-400',
    badgeBg: 'bg-neutral-500/10 border-neutral-500/20',
  },
  expired: {
    label: 'Expired',
    symbol: '✕',
    textColor: 'text-rose-700 dark:text-rose-300',
    badgeBg: 'bg-rose-500/10 border-rose-500/20',
  },
};

export function ApplicationLinkStatusBadge({
  status,
  className = '',
}: {
  readonly status: ApplicationLinkStatus;
  readonly className?: string | undefined;
}): React.JSX.Element {
  const config = APP_LINK_STATUS_CONFIGS[status] ?? {
    label: status,
    symbol: '•',
    textColor: 'text-app-muted',
    badgeBg: 'bg-app-surface border-app-border',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${config.badgeBg} ${config.textColor} ${className}`}
      role="status"
    >
      <span className="text-[10px] leading-none" aria-hidden="true">
        {config.symbol}
      </span>
      <span>{config.label}</span>
    </span>
  );
}

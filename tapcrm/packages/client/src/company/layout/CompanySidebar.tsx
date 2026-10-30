import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Icon } from '../../ui/Icon.js';
import { useTheme, type AccentColor } from '../../theme/ThemeContext.js';
import { SidebarPet, useAiPet } from './AiPet.js';
import { myNotepadNavItem, myTodoNavItem, type CompanyNavGroup } from './navigation.js';
import { useChatUnread } from '../../chat/ChatUnreadContext.js';

function ThemePromoIllustration({ accent }: { accent: AccentColor }): React.JSX.Element {
  const common = {
    className: 'sidebar-decoration-symbol size-14',
    viewBox: '0 0 64 64',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (accent === 'green') {
    return (
      <svg {...common}>
        <path d="M32 52V26" />
        <path
          d="M32 35c-9 0-15-5-16-14 9 0 15 5 16 14Z"
          fill="currentColor"
          fillOpacity=".18"
        />
        <path
          d="M32 29c1-9 7-14 16-14-1 9-7 14-16 14Z"
          fill="currentColor"
          fillOpacity=".28"
        />
        <path d="M25 52h14" />
      </svg>
    );
  }
  if (accent === 'blue') {
    return (
      <svg {...common}>
        <path
          d="M32 10c-5 8-12 14-12 23a12 12 0 0 0 24 0c0-9-7-15-12-23Z"
          fill="currentColor"
          fillOpacity=".18"
        />
        <path d="M14 47c5-4 10-4 15 0s10 4 15 0 7-4 10-2" />
      </svg>
    );
  }
  if (accent === 'orange') {
    return (
      <svg {...common}>
        <path
          d="M34 53c-10 0-16-6-16-15 0-7 5-11 10-17 3-4 4-8 4-12 8 6 13 13 13 22 0 4-1 7-3 9 1-7-2-12-6-15 1 8-9 11-9 18 0 6 3 9 7 10Z"
          fill="currentColor"
          fillOpacity=".22"
        />
        <path d="M27 52c-3-2-5-5-5-9 0-4 2-7 5-10-1 7 2 9 5 12 2 2 2 5 1 7" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="m32 9 10 16-10 30-10-30L32 9Z" fill="currentColor" fillOpacity=".2" />
      <path d="m32 9 10 16-10 30-10-30L32 9Z" />
      <path d="m22 25 10 5 10-5M32 30v25" />
      <path d="M49 10v9M44.5 14.5h9" strokeWidth="2" />
    </svg>
  );
}

export function CompanySidebar({
  variant = 'company',
  pathname,
  identity: _identity,
  organizationName: _organizationName,
  accountType,
  canRequestRoleChange = false,
  canViewAudit = false,
  canManageLeaveTypes = false,
  canViewLeaveBalances = false,
  canUseLeaveQueue = false,
  canViewEmployees = false,
  canViewTerritories = false,
  canViewLeads = false,
  canViewCallbacks = false,
  canViewHandovers = false,
  canViewDeals = false,
  canRecordWin = false,
  canDecideApprovals = false,
  canForecast = false,
  canViewChat = false,
  canViewClients = false,
  canViewProjects = false,
  canViewLiveBoard = false,
  canViewAttendanceReports = false,
  canReviewCorrections = false,
  canReviewBreaches = false,
  canManageBreakPolicies = false,
  canManageShifts = false,
  canManagePayroll = false,
  canManagePayrollConfig = false,
  canViewAccounting = false,
  canViewFinanceFoundation = false,
  canViewBillingTerms = false,
  canViewTa = false,
  canManageTa = false,
  canManageBiometric = false,
  canViewAdvances = false,
  canManageAdvances = false,
  canViewPenalties = false,
  canManagePenalties = false,
  canViewExpenses = false,
  canApproveExpenses = false,
  isHr = false,
  hasRecruitment = false,
  hasInterviews = false,
  onNavigate,
  onLogout,
  open,
  onClose,
  collapsed = false,
  onToggleCollapsed: _onToggleCollapsed,
  width = 256,
  onResize,
}: {
  variant?: 'company' | 'client';
  pathname: string;
  identity: {
    fullName: string;
    email: string;
    accountType?: string;
    departmentCode?: string | null;
    departmentName?: string | null;
    positionCode?: string | null;
  };
  organizationName: string | null;
  accountType: string;
  canRequestRoleChange?: boolean;
  canViewAudit?: boolean;
  canManageLeaveTypes?: boolean;
  canViewLeaveBalances?: boolean;
  canUseLeaveQueue?: boolean;
  canViewEmployees?: boolean;
  canViewTerritories?: boolean;
  canViewLeads?: boolean;
  canViewCallbacks?: boolean;
  canViewHandovers?: boolean;
  canViewDeals?: boolean;
  canRecordWin?: boolean;
  canDecideApprovals?: boolean;
  canForecast?: boolean;
  canViewChat?: boolean;
  canViewClients?: boolean;
  canViewProjects?: boolean;
  canViewLiveBoard?: boolean;
  canViewAttendanceReports?: boolean;
  canReviewCorrections?: boolean;
  canReviewBreaches?: boolean;
  canManageBreakPolicies?: boolean;
  canManageShifts?: boolean;
  canManagePayroll?: boolean;
  canManagePayrollConfig?: boolean;
  canViewAccounting?: boolean;
  canViewFinanceFoundation?: boolean;
  canViewBillingTerms?: boolean;
  canViewTa?: boolean;
  canManageTa?: boolean;
  canManageBiometric?: boolean;
  canViewAdvances?: boolean;
  canManageAdvances?: boolean;
  canViewPenalties?: boolean;
  canManagePenalties?: boolean;
  canViewExpenses?: boolean;
  canApproveExpenses?: boolean;
  isHr?: boolean;
  hasRecruitment?: boolean;
  /** Shown only while this user has interviews (assigned rounds or panels). */
  hasInterviews?: boolean;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  open: boolean;
  onClose: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  width?: number;
  onResize?: (width: number) => void;
}): React.JSX.Element {
  const [organizationOpen, setOrganizationOpen] = useState(
    pathname.startsWith('/company/organization'),
  );
  const [recruitmentOpen, setRecruitmentOpen] = useState(
    pathname.startsWith('/company/recruitment'),
  );
  const prevPathnameRef = useRef(pathname);
  const navigationRef = useRef<HTMLElement>(null);
  const activeNavIndicatorRef = useRef<HTMLDivElement>(null);
  const navItemRefs = useRef(
    new Map<string, { button: HTMLButtonElement; label: string }>(),
  );
  const previousActiveTopRef = useRef<number | null>(null);
  const activeNavMoveTimerRef = useRef<number | undefined>(undefined);
  const sidebarPillDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null>(null);
  const sidebarPillDragButtonRef = useRef<HTMLButtonElement | null>(null);
  const suppressSidebarClickRef = useRef(false);
  const [isActiveNavMoving, setIsActiveNavMoving] = useState(false);
  const [isDraggingSidebarPill, setIsDraggingSidebarPill] = useState(false);
  const resizeStartRef = useRef<{ x: number; width: number } | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const restoreActiveSidebarPill = () => {
    const navigation = navigationRef.current;
    const indicator = activeNavIndicatorRef.current;
    const activeItem = navigation?.querySelector<HTMLButtonElement>(
      '[data-company-nav-item][aria-current="page"]',
    );
    if (!navigation || !indicator || !activeItem) return;
    const navRect = navigation.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();
    indicator.style.setProperty(
      '--sidebar-pill-top',
      `${itemRect.top - navRect.top + navigation.scrollTop}px`,
    );
    indicator.style.setProperty(
      '--sidebar-pill-left',
      `${itemRect.left - navRect.left + navigation.scrollLeft}px`,
    );
    indicator.style.setProperty('--sidebar-pill-width', `${itemRect.width}px`);
    indicator.style.setProperty('--sidebar-pill-height', `${itemRect.height}px`);
  };

  const syncActiveSidebarPill = () => {
    // Wait until route state commits, then position the shared pill from the
    // active item itself so it cannot remain at its previous route position.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const navigation = navigationRef.current;
      const indicator = activeNavIndicatorRef.current;
      const activeItem = navigation?.querySelector<HTMLButtonElement>(
        '[data-company-nav-item][aria-current="page"]',
      );
      if (!navigation || !indicator || !activeItem) return;
      const navRect = navigation.getBoundingClientRect();
      const itemRect = activeItem.getBoundingClientRect();
      indicator.style.setProperty('--sidebar-pill-top', `${itemRect.top - navRect.top + navigation.scrollTop}px`);
      indicator.style.setProperty('--sidebar-pill-left', `${itemRect.left - navRect.left + navigation.scrollLeft}px`);
      indicator.style.setProperty('--sidebar-pill-width', `${itemRect.width}px`);
      indicator.style.setProperty('--sidebar-pill-height', `${itemRect.height}px`);
      indicator.style.opacity = '1';
      setIsActiveNavMoving(true);
      if (activeNavMoveTimerRef.current !== undefined) window.clearTimeout(activeNavMoveTimerRef.current);
      activeNavMoveTimerRef.current = window.setTimeout(() => setIsActiveNavMoving(false), 480);
    }));
  };

  const startSidebarPillDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.matches('[aria-current="page"]') || !window.matchMedia('(min-width: 1280px)').matches || event.button !== 0 || event.pointerType === 'touch') return;
    const indicatorRect = activeNavIndicatorRef.current?.getBoundingClientRect();
    if (!indicatorRect) return;
    sidebarPillDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - indicatorRect.left,
      offsetY: event.clientY - indicatorRect.top,
      moved: false,
    };
    sidebarPillDragButtonRef.current = event.currentTarget;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveSidebarPillDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = sidebarPillDragRef.current;
    const navigation = navigationRef.current;
    const indicator = activeNavIndicatorRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !navigation || !indicator) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.hypot(deltaX, deltaY) > 5) drag.moved = true;
    if (!drag.moved) return;

    setIsDraggingSidebarPill(true);
    const navRect = navigation.getBoundingClientRect();
    const pillRect = indicator.getBoundingClientRect();
    const pillWidth =
      Number.parseFloat(indicator.style.getPropertyValue('--sidebar-pill-width')) ||
      pillRect.width;
    const pillHeight =
      Number.parseFloat(indicator.style.getPropertyValue('--sidebar-pill-height')) ||
      pillRect.height;
    const maxLeft = Math.max(0, navigation.scrollWidth - pillWidth);
    const maxTop = Math.max(0, navigation.scrollHeight - pillHeight);
    const left = Math.max(
      0,
      Math.min(
        maxLeft,
        event.clientX - navRect.left + navigation.scrollLeft - drag.offsetX,
      ),
    );
    const top = Math.max(
      0,
      Math.min(maxTop, event.clientY - navRect.top + navigation.scrollTop - drag.offsetY),
    );
    indicator.style.setProperty('--sidebar-pill-left', `${left}px`);
    indicator.style.setProperty('--sidebar-pill-top', `${top}px`);
    const stretch = 1 + Math.min(0.12, Math.abs(deltaY) * 0.003);
    const squash = 1 - Math.min(0.035, Math.abs(deltaY) * 0.0009);
    indicator.style.setProperty('--sidebar-pill-stretch', stretch.toFixed(3));
    indicator.style.setProperty('--sidebar-pill-squash', squash.toFixed(3));
    indicator.style.setProperty(
      '--sidebar-pill-origin',
      deltaY >= 0 ? 'top center' : 'bottom center',
    );
  };

  const finishSidebarPillDrag = (
    event: React.PointerEvent<HTMLElement>,
    commit = true,
  ) => {
    const drag = sidebarPillDragRef.current;
    const navigation = navigationRef.current;
    const indicator = activeNavIndicatorRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    let shouldRestore = !drag.moved || !commit;

    if (drag.moved && commit && indicator && navigation) {
      // Resolve the destination from the actual release point. The animated
      // indicator can still be mid-transition on pointer-up, so using its
      // visual center can incorrectly select the old item (often Dashboard).
      const centerX = event.clientX;
      const centerY = event.clientY;
      const nearest = [...navItemRefs.current.entries()]
        .map(([path, entry]) => {
          const rect = entry.button.getBoundingClientRect();
          const dx = centerX - (rect.left + rect.width / 2);
          const dy = centerY - (rect.top + rect.height / 2);
          return { path, label: entry.label, distance: dx * dx + dy * dy };
        })
        .sort((a, b) => a.distance - b.distance)[0];

      if (nearest) {
        suppressSidebarClickRef.current = true;
        window.setTimeout(() => {
          suppressSidebarClickRef.current = false;
        }, 600);
        if (nearest.label === 'Recruitment') setRecruitmentOpen(true);
        onNavigate(nearest.path);
        onClose();
        syncActiveSidebarPill();
        if (nearest.path === pathname) shouldRestore = true;
      } else {
        shouldRestore = true;
      }
    }

    const captureButton = sidebarPillDragButtonRef.current;
    if (captureButton?.hasPointerCapture(event.pointerId))
      captureButton.releasePointerCapture(event.pointerId);
    sidebarPillDragRef.current = null;
    sidebarPillDragButtonRef.current = null;
    setIsDraggingSidebarPill(false);
    if (indicator) {
      window.requestAnimationFrame(() => {
        indicator.style.removeProperty('--sidebar-pill-stretch');
        indicator.style.removeProperty('--sidebar-pill-squash');
        if (shouldRestore) restoreActiveSidebarPill();
      });
    }
  };

  useEffect(() => {
    const wasRecruitment = prevPathnameRef.current.startsWith('/company/recruitment');
    const isRecruitment = pathname.startsWith('/company/recruitment');
    if (!wasRecruitment && isRecruitment) {
      setRecruitmentOpen(true);
    }
    prevPathnameRef.current = pathname;
  }, [pathname]);

  useLayoutEffect(() => {
    const navigation = navigationRef.current;
    const indicator = activeNavIndicatorRef.current;
    if (!navigation || !indicator) return;

    const syncActiveIndicator = () => {
      const activeItem = navigation.querySelector<HTMLButtonElement>(
        '[data-company-nav-item][aria-current="page"]',
      );
      if (!activeItem) {
        indicator.style.opacity = '0';
        previousActiveTopRef.current = null;
        return;
      }

      const navRect = navigation.getBoundingClientRect();
      const itemRect = activeItem.getBoundingClientRect();
      const top = itemRect.top - navRect.top + navigation.scrollTop;
      indicator.style.setProperty('--sidebar-pill-top', `${top}px`);
      indicator.style.setProperty(
        '--sidebar-pill-left',
        `${itemRect.left - navRect.left + navigation.scrollLeft}px`,
      );
      indicator.style.setProperty('--sidebar-pill-width', `${itemRect.width}px`);
      indicator.style.setProperty('--sidebar-pill-height', `${itemRect.height}px`);
      indicator.style.opacity = '1';

      const previousTop = previousActiveTopRef.current;
      if (previousTop !== null && Math.abs(previousTop - top) > 1) {
        indicator.style.setProperty('--sidebar-pill-origin', top > previousTop ? 'top center' : 'bottom center');
        setIsActiveNavMoving(true);
        if (activeNavMoveTimerRef.current !== undefined)
          window.clearTimeout(activeNavMoveTimerRef.current);
        activeNavMoveTimerRef.current = window.setTimeout(
          () => setIsActiveNavMoving(false),
          480,
        );
      }
      previousActiveTopRef.current = top;
    };

    syncActiveIndicator();
    const observer = new ResizeObserver(syncActiveIndicator);
    observer.observe(navigation);
    const activeItem = navigation.querySelector(
      '[data-company-nav-item][aria-current="page"]',
    );
    if (activeItem) observer.observe(activeItem);
    window.addEventListener('resize', syncActiveIndicator);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncActiveIndicator);
    };
  }, [pathname, collapsed]);

  useEffect(
    () => () => {
      if (activeNavMoveTimerRef.current !== undefined)
        window.clearTimeout(activeNavMoveTimerRef.current);
    },
    [],
  );

  const isSuperAdmin = accountType === 'super-admin';
  const { activePet } = useAiPet();
  const { accent } = useTheme();
  const { total: unreadMessages } = useChatUnread();

  const clampWidth = (nextWidth: number) => Math.min(420, Math.max(220, nextWidth));

  const startResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (collapsed || !onResize) return;
    event.preventDefault();
    resizeStartRef.current = { x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    setIsResizing(true);
  };

  const resizeSidebar = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!resizeStartRef.current || !onResize) return;
    onResize(
      clampWidth(resizeStartRef.current.width + event.clientX - resizeStartRef.current.x),
    );
  };

  const stopResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resizeStartRef.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    setIsResizing(false);
  };

  const resizeWithKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!onResize) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    onResize(clampWidth(width + (event.key === 'ArrowRight' ? 16 : -16)));
  };

  const navigation: CompanyNavGroup[] = [
    {
      label: 'Overview',
      items: [
        { label: 'Dashboard', path: '/company/dashboard', icon: 'grid' },
        { label: 'Tasks', path: '/company/tasks', icon: 'check' },
        ...(hasInterviews
          ? [{ label: 'My Interviews', path: '/company/my-interviews', icon: 'calendar' }]
          : []),
        ...(canViewChat
          ? [{ label: 'Messages', path: '/company/messages', icon: 'message' }]
          : []),
        myTodoNavItem,
        myNotepadNavItem,
      ],
    },
    ...(isSuperAdmin
      ? [
          {
            label: 'Organization',
            items: [
              { label: 'Overview', path: '/company/organization', icon: 'grid' },
              {
                label: 'Departments',
                path: '/company/organization/departments',
                icon: 'building',
              },
              { label: 'Teams', path: '/company/organization/teams', icon: 'users' },
              {
                label: 'Positions',
                path: '/company/organization/positions',
                icon: 'briefcase',
              },
              {
                label: 'Designations',
                path: '/company/organization/designations',
                icon: 'briefcase',
              },
              {
                label: 'Reporting',
                path: '/company/organization/reporting',
                icon: 'users',
              },
              {
                label: 'Org Chart',
                path: '/company/organization/org-chart',
                icon: 'hierarchy',
              },
            ],
          },
        ]
      : []),
    ...(isHr || canViewEmployees || isSuperAdmin
      ? [
          {
            label: 'People',
            items: [
              { label: 'Employees', path: '/company/employees', icon: 'users' },
              ...(isSuperAdmin
                ? [
                    {
                      label: 'Employee Notes',
                      path: '/company/employee-notes',
                      icon: 'notepad',
                    },
                  ]
                : []),
              ...(isHr && hasRecruitment
                ? [
                    {
                      label: 'Recruitment',
                      path: '/company/recruitment',
                      icon: 'briefcase',
                      children: [
                        { label: 'Overview', path: '/company/recruitment' },
                        {
                          label: 'Requisitions',
                          path: '/company/recruitment/requisitions',
                        },
                        { label: 'Resume Inbox', path: '/company/recruitment/resumes' },
                        { label: 'Candidates', path: '/company/recruitment/candidates' },
                        { label: 'Interviews', path: '/company/recruitment/interviews' },
                        { label: 'Offers', path: '/company/recruitment/offers' },
                        { label: 'Joining', path: '/company/recruitment/joining' },
                      ],
                    },
                  ]
                : []),
            ],
          },
        ]
      : []),
    ...(canViewClients || canViewProjects
      ? [
          {
            label: 'Delivery',
            items: [
              ...(canViewClients
                ? [{ label: 'Clients', path: '/company/clients', icon: 'briefcase' }]
                : []),
              ...(canViewProjects
                ? [{ label: 'Projects', path: '/company/projects', icon: 'grid' }]
                : []),
            ],
          },
        ]
      : []),
    ...(canViewTerritories ||
    canViewLeads ||
    canViewCallbacks ||
    canViewHandovers ||
    canViewDeals ||
    canDecideApprovals ||
    canRecordWin ||
    canForecast
      ? [
          {
            label: 'Sales',
            items: [
              ...(canViewTerritories
                ? [
                    {
                      label: 'Territories',
                      path: '/company/sales/territories',
                      icon: 'map',
                    },
                  ]
                : []),
              ...(canViewLeads
                ? [{ label: 'Leads', path: '/company/sales/leads', icon: 'users' }]
                : []),
              ...(canViewDeals
                ? [{ label: 'Deals', path: '/company/sales/deals', icon: 'briefcase' }]
                : []),
              ...(canDecideApprovals
                ? [
                    {
                      label: 'Approvals',
                      path: '/company/sales/approvals',
                      icon: 'check',
                    },
                  ]
                : []),
              ...(canRecordWin
                ? [
                    {
                      label: 'Wins to record',
                      path: '/company/sales/wins',
                      icon: 'check',
                    },
                  ]
                : []),
              ...(canViewCallbacks
                ? [
                    {
                      label: 'Callbacks',
                      path: '/company/sales/callbacks',
                      icon: 'calendar',
                    },
                  ]
                : []),
              ...(canViewHandovers
                ? [
                    {
                      label: 'Handovers',
                      path: '/company/sales/handovers',
                      icon: 'share',
                    },
                  ]
                : []),
              ...(canForecast
                ? [{ label: 'Reports', path: '/company/sales/reports', icon: 'chart' }]
                : []),
            ],
          },
        ]
      : []),
    {
      label: 'Attendance',
      items: [
        { label: 'Today', path: '/company/attendance/today', icon: 'clock' },
        { label: 'My Attendance', path: '/company/attendance/my', icon: 'calendar' },
        ...(canViewAttendanceReports
          ? [
              {
                label: 'Employee Wise',
                path: '/company/attendance/employee-wise',
                icon: 'users',
              },
            ]
          : []),
        ...(canViewAttendanceReports
          ? [
              {
                label: 'Attendance Report',
                path: '/company/attendance/report',
                icon: 'grid',
              },
            ]
          : []),
        ...(canViewAttendanceReports
          ? [
              {
                label: 'Daily Late Report',
                path: '/company/attendance/late',
                icon: 'clock',
              },
            ]
          : []),
        ...(canViewLiveBoard
          ? [
              {
                label: 'Workforce Board',
                path: '/company/attendance/live',
                icon: 'users',
              },
            ]
          : []),
        ...(canReviewCorrections
          ? [
              {
                label: 'Corrections',
                path: '/company/attendance/corrections',
                icon: 'edit',
              },
            ]
          : []),
        ...(canReviewBreaches
          ? [
              {
                label: 'Break Queue',
                path: '/company/breaks/queue',
                icon: 'alert-circle',
              },
            ]
          : []),
        ...(canManageBreakPolicies
          ? [
              {
                label: 'Break Policies',
                path: '/company/breaks/policies',
                icon: 'settings',
              },
            ]
          : []),
        ...(canManageBiometric
          ? [{ label: 'Biometric', path: '/company/biometric', icon: 'cpu' }]
          : []),
      ],
    },
    {
      label: 'Shifts & Leave',
      items: [
        { label: 'My Leave', path: '/company/leave/my', icon: 'sun' },
        ...(canUseLeaveQueue
          ? [{ label: 'Leave Queue', path: '/company/leave/queue', icon: 'inbox' }]
          : []),
        ...(canViewLeaveBalances
          ? [{ label: 'Leave Balances', path: '/company/leave/balances', icon: 'chart' }]
          : []),
        ...(canManageLeaveTypes
          ? [{ label: 'Leave Types', path: '/company/leave/types', icon: 'settings' }]
          : []),
        { label: 'Holidays', path: '/company/holidays', icon: 'flag' },
        ...(canManageShifts
          ? [
              { label: 'Shifts', path: '/company/shifts', icon: 'layers' },
              {
                label: 'Weekday Schedules',
                path: '/company/weekday-schedules',
                icon: 'calendar',
              },
            ]
          : []),
      ],
    },
    ...(canViewAdvances ||
    canManageAdvances ||
    canViewPenalties ||
    canManagePenalties ||
    canViewExpenses ||
    canApproveExpenses ||
    canViewTa
      ? [
          {
            label: 'Advances & Penalties',
            items: [
              ...(canViewAdvances
                ? [
                    {
                      label: 'My Advances',
                      path: '/company/advance/mine',
                      icon: 'dollar-sign',
                    },
                  ]
                : []),
              ...(canManageAdvances
                ? [
                    {
                      label: 'Advance Requests',
                      path: '/company/advance/requests',
                      icon: 'inbox',
                    },
                  ]
                : []),
              ...(canManagePenalties
                ? [
                    {
                      label: 'Penalties',
                      path: '/company/penalties',
                      icon: 'alert-circle',
                    },
                  ]
                : !canManageAdvances && canViewPenalties
                  ? [
                      {
                        label: 'Penalties',
                        path: '/company/my-penalties',
                        icon: 'alert-circle',
                      },
                    ]
                  : []),
              ...(canViewExpenses
                ? [
                    {
                      label: 'My Expenses',
                      path: '/company/expenses/mine',
                      icon: 'file-text',
                    },
                  ]
                : []),
              ...(canApproveExpenses
                ? [
                    {
                      label: 'Expense Approvals',
                      path: '/company/expenses/approvals',
                      icon: 'inbox',
                    },
                  ]
                : []),
              ...(canManageTa
                ? [{ label: 'TA Management', path: '/company/ta', icon: 'map' }]
                : canViewTa
                  ? [{ label: 'My TA', path: '/company/my-ta', icon: 'map' }]
                  : []),
            ],
          },
        ]
      : []),
    {
      label: 'Payroll',
      items: [
        { label: 'My Payslips', path: '/company/payroll/my-payslips', icon: 'file-text' },
        ...(canManagePayroll
          ? [
              {
                label: 'Payroll Cycle',
                path: '/company/payroll/cycle',
                icon: 'calendar',
              },
              {
                label: 'Payroll Runs',
                path: '/company/payroll/runs',
                icon: 'dollar-sign',
              },
              {
                label: 'Salary Structures',
                path: '/company/payroll/salaries',
                icon: 'briefcase',
              },
              {
                label: 'Bonuses & Deductions',
                path: '/company/payroll/inputs',
                icon: 'chart',
              },
            ]
          : []),
        ...(canManagePayrollConfig
          ? [
              {
                label: 'Payroll Settings',
                path: '/company/payroll/settings',
                icon: 'wallet',
              },
            ]
          : []),
      ],
    },
    ...(canViewAccounting
      ? [
          {
            label: 'Finance',
            items: [
              {
                label: 'Accounting',
                path: '/company/finance/accounting',
                icon: 'wallet',
              },
              ...(canViewFinanceFoundation ? [{ label: 'Finance Settings', path: '/company/finance/settings', icon: 'settings' }] : []),
              ...(canViewBillingTerms ? [{ label: 'Billing Terms', path: '/company/finance/billing', icon: 'file-text' }] : []),
            ],
          },
        ]
      : (canViewFinanceFoundation || canViewBillingTerms) ? [{ label: 'Finance', items: [...(canViewFinanceFoundation ? [{ label: 'Finance Settings', path: '/company/finance/settings', icon: 'settings' }] : []), ...(canViewBillingTerms ? [{ label: 'Billing Terms', path: '/company/finance/billing', icon: 'file-text' }] : [])] }] : []),
    {
      label: 'Identity & Access',
      items: [
        { label: 'Sessions & Devices', path: '/company/sessions', icon: 'monitor' },
        ...(isSuperAdmin
          ? [{ label: 'Access Explorer', path: '/company/access', icon: 'shield' }]
          : []),
        ...(isSuperAdmin || canViewAudit
          ? [{ label: 'Audit Log', path: '/company/audit', icon: 'clipboard' }]
          : []),
        ...(isSuperAdmin
          ? [{ label: 'Geofencing', path: '/company/geofencing', icon: 'pin' }]
          : []),
        ...(accountType === 'employee' && canRequestRoleChange
          ? [
              {
                label: 'Request Role Change',
                path: '/company/role-change-request',
                icon: 'briefcase',
              },
            ]
          : []),
      ],
    },
    {
      label: 'Preferences',
      items: [{ label: 'Settings', path: '/company/settings', icon: 'settings' }],
    },
  ];
  const visibleNavigation: CompanyNavGroup[] = variant === 'client'
    ? [
        {
          label: 'Overview',
          items: [
            { label: 'Dashboard', path: '/client', icon: 'grid' },
            { label: 'Projects', path: '/client/projects', icon: 'briefcase' },
          ],
        },
        {
          label: 'Account',
          items: [{ label: 'Profile', path: '/client/profile', icon: 'users' }],
        },
      ]
    : navigation;

  return (
    <aside
      className={`workspace-sidebar relative fixed bottom-0 left-0 top-16 z-[60] flex min-h-0 w-72 flex-none flex-col border-r border-sidebar-border bg-sidebar-bg px-4 py-5 transition-[transform,width,margin,padding] duration-200 ease-out will-change-transform xl:static xl:my-5 xl:ml-5 xl:h-[calc(100dvh-6.5rem)] xl:self-start xl:translate-x-0 xl:rounded-2xl xl:shadow-[0_8px_24px_-24px_rgba(15,23,42,0.6)] ${open ? 'translate-x-0' : '-translate-x-full'} ${collapsed ? 'xl:w-[76px] xl:px-2' : 'sidebar-resizable'} ${isResizing ? 'select-none' : ''}`}
      style={
        collapsed
          ? undefined
          : ({ '--company-sidebar-width': `${width}px` } as React.CSSProperties)
      }
      data-sidebar-collapsed={collapsed ? 'true' : 'false'}
      data-sidebar-open={open ? 'true' : 'false'}
    >
      {!collapsed && (
        <button
          type="button"
          className={`sidebar-resize-handle hidden xl:flex ${isResizing ? 'is-resizing' : ''}`}
          onPointerDown={startResize}
          onPointerMove={resizeSidebar}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
          onKeyDown={resizeWithKeyboard}
          aria-label="Resize company sidebar"
          aria-orientation="vertical"
          aria-valuemin={220}
          aria-valuemax={420}
          aria-valuenow={width}
          role="separator"
          title="Drag to resize sidebar"
        >
          <span aria-hidden="true" />
        </button>
      )}
      <div className={`flex shrink-0 items-center px-3 ${collapsed ? 'xl:justify-center' : 'justify-between'}`}>
        <p className={`text-[10px] font-bold uppercase tracking-[0.16em] text-sidebar-muted ${collapsed ? 'xl:hidden' : ''}`}>
          {variant === 'client' ? 'Client Workspace' : 'Company Workspace'}
        </p>
        <span
          className={`hidden size-2 rounded-full bg-app-accent xl:block ${collapsed ? '' : 'xl:hidden'}`}
          aria-hidden="true"
        />
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-sidebar-muted xl:hidden"
          aria-label="Close navigation"
        >
          ×
        </button>
      </div>
      <nav
        ref={navigationRef}
        onPointerMove={moveSidebarPillDrag}
        onPointerUp={finishSidebarPillDrag}
        onPointerCancel={(event) => finishSidebarPillDrag(event, false)}
        data-lenis-prevent
        className={`company-sidebar-nav relative min-h-0 flex-1 space-y-7 overflow-y-auto overscroll-y-contain ${collapsed ? 'mt-6 xl:space-y-4' : 'mt-7'}`}
        aria-label="Company navigation"
      >
        <div
          ref={activeNavIndicatorRef}
          className="company-sidebar-active-indicator"
          data-moving={isActiveNavMoving}
          data-dragging={isDraggingSidebarPill}
          aria-hidden="true"
        />
        {visibleNavigation.map((group) => {
          const isOrganization = group.label === 'Organization';
          const activeChild = group.items.some(
            (item) => pathname === item.path || pathname.startsWith(`${item.path}/`),
          );
          return (
            <div
              key={group.label}
              className={`relative z-[1] ${group.label === 'Preferences' ? 'sidebar-preferences-group' : ''} ${collapsed ? 'xl:border-t xl:border-sidebar-border/70 xl:pt-4 first:xl:border-t-0 first:xl:pt-0' : ''}`}
            >
              {isOrganization ? (
                <button
                  type="button"
                  onClick={() => setOrganizationOpen((openState) => !openState)}
                  aria-expanded={organizationOpen}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] hover:text-sidebar-active-fg ${collapsed ? 'xl:justify-center xl:px-2' : ''} ${activeChild ? 'bg-sidebar-hover-bg text-sidebar-foreground' : 'text-sidebar-section-muted'}`}
                  title={collapsed ? 'Organization' : undefined}
                >
                  <Icon
                    name="building"
                    className={`hidden size-4 xl:block ${collapsed ? '' : 'xl:hidden'}`}
                  />
                  <span className={collapsed ? 'xl:hidden' : ''}>Organization</span>
                  <span aria-hidden="true" className={collapsed ? 'xl:hidden' : ''}>
                    {organizationOpen ? '−' : '+'}
                  </span>
                </button>
              ) : (
                <p
                  className={`px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-section-muted ${collapsed ? 'xl:hidden' : ''}`}
                >
                  {group.label}
                </p>
              )}
              {(!isOrganization || organizationOpen) && (
                <div className="mt-2 space-y-1">
                  {group.items.map((item) => {
                    const isRecruitmentItem = item.label === 'Recruitment';
                    const isRootRoute = variant === 'client'
                      ? item.path === '/client'
                      : item.path === '/company/organization';
                    const isActive = pathname === item.path ||
                      (!isRootRoute && pathname.startsWith(`${item.path}/`));
                    const showChildren = Boolean(
                      item.children && (isRecruitmentItem ? recruitmentOpen : true),
                    );
                    return (
                      <div key={item.path}>
                        <button
                          data-company-nav-item="true"
                          ref={(element) => {
                            if (element)
                              navItemRefs.current.set(item.path, {
                                button: element,
                                label: item.label,
                              });
                            else navItemRefs.current.delete(item.path);
                          }}
                          aria-current={isActive ? 'page' : undefined}
                          type="button"
                          aria-expanded={item.children ? showChildren : undefined}
                          onPointerDown={startSidebarPillDrag}
                          onClick={() => {
                            if (suppressSidebarClickRef.current) {
                              suppressSidebarClickRef.current = false;
                              return;
                            }
                            if (isRecruitmentItem) {
                              if (!pathname.startsWith(item.path)) {
                                setRecruitmentOpen(true);
                                onNavigate(item.path);
                                onClose();
                              } else {
                                setRecruitmentOpen((prev) => !prev);
                              }
                            } else {
                              onNavigate(item.path);
                              onClose();
                              syncActiveSidebarPill();
                            }
                          }}
                          className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-medium transition hover:text-sidebar-active-fg ${collapsed ? 'xl:justify-center xl:px-2' : ''} ${isActive ? 'bg-sidebar-active-bg text-sidebar-active-fg shadow-xs' : 'text-sidebar-nav-muted'}`}
                          title={collapsed ? item.label : undefined}
                        >
                          <span className="flex items-center gap-3">
                            <span
                              data-sidebar-icon={item.icon}
                              className="inline-flex shrink-0 items-center justify-center"
                            >
                              <Icon name={item.icon} />
                            </span>
                            <span className={collapsed ? 'xl:hidden' : ''}>
                              {item.label}
                            </span>
                          </span>
                          {item.label === 'Messages' && unreadMessages > 0 && (
                            <span
                              className={`inline-flex shrink-0 items-center justify-center rounded-full bg-app-accent px-1.5 py-0.5 text-[10px] font-bold leading-none text-app-on-accent ${collapsed ? 'xl:hidden' : ''}`}
                              aria-label={`${unreadMessages} unread messages`}
                            >
                              {unreadMessages > 99 ? '99+' : unreadMessages}
                            </span>
                          )}
                          {item.children && (
                            <span
                              aria-hidden="true"
                              className={`text-xs text-sidebar-muted ${collapsed ? 'xl:hidden' : ''}`}
                            >
                              {showChildren ? '▾' : '▸'}
                            </span>
                          )}
                        </button>
                        {showChildren && !collapsed && (
                          <div className="ml-7 mt-1 divide-y divide-sidebar-border/70 pl-2">
                            {item.children!.map((sub) => {
                              const active =
                                sub.path === '/company/recruitment'
                                  ? pathname === sub.path
                                  : pathname === sub.path ||
                                    pathname.startsWith(`${sub.path}/`);
                              return (
                                <button
                                  key={sub.path}
                                  type="button"
                                  aria-current={active ? 'page' : undefined}
                                  onClick={() => {
                                    onNavigate(sub.path);
                                    onClose();
                                  }}
                                  className={`w-full rounded-none px-3 py-2.5 text-left text-xs font-medium hover:text-sidebar-active-fg ${active ? 'text-sidebar-foreground font-semibold' : 'text-sidebar-nav-muted'}`}
                                >
                                  {sub.label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {variant === 'company' && (
          <div className={`sidebar-decoration ${collapsed ? 'xl:hidden' : ''}`}>
            <div className="relative z-10 max-w-[76%]">
              <p className="text-sm font-medium leading-5">
                Work smarter.
                <br />
                Grow together.
              </p>
              <div className="mt-3 h-1 w-10 rounded-full bg-app-accent" />
            </div>
            <ThemePromoIllustration accent={accent} />
          </div>
        )}
      </nav>
      {activePet && (
        <div
          className={`sidebar-pet-runway shrink-0 border-t border-sidebar-border/70 px-1 pt-1 ${collapsed ? 'xl:hidden' : ''}`}
        >
          <SidebarPet pet={activePet} />
        </div>
      )}
      <div className="shrink-0 border-t border-t-[color:var(--sidebar-border)] pt-4">
        <button
          type="button"
          onClick={onLogout}
          className={`sidebar-logout flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-rose-600 transition-colors cursor-pointer dark:text-rose-300 ${collapsed ? 'xl:justify-center xl:px-2' : ''}`}
          title={collapsed ? 'Log out' : undefined}
        >
          <Icon name="logout" className="size-3.5" />
          <span className={collapsed ? 'xl:hidden' : ''}>Log out</span>
        </button>
      </div>
    </aside>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../lib/api';
import Modal from '../../components/common/Modal';
import {
  ShieldIcon,
  KeyIcon,
  UsersIcon,
  SearchIcon,
  PlusIcon,
  TrashIcon,
  CheckIcon,
  AlertCircleIcon,
  PositionLadderIcon,
} from '../../components/common/Icons';

type Tab = 'explorer' | 'overrides' | 'role-changes' | 'registry';

type ExplorerMode = 'user' | 'action';

type PolicySource = 'position' | 'override';

type RoleRequestStatus = 'pending' | 'approved' | 'rejected';

type DecisionStatus = 'approved' | 'rejected';

type OverrideScope =
  'own' | 'participant' | 'pool' | 'team' | 'department' | 'all-people';

interface ApiSuccess<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface ApiErrorResponse {
  success?: boolean;
  message?: string;
  error?: string;
  code?: string;
}

interface UserListItem {
  id: string;
  fullName: string;
  email: string | null;
  accountType?: string;
  positionName?: string | null;
  departmentName?: string | null;
  status?: string;
}

interface EffectivePolicy {
  action: string;
  allowed: boolean;
  scope: string;
  source: PolicySource;
  overrideReason?: string | null;
  overrideExpiresAt?: string | null;
}

interface EffectiveAccessUser {
  id: string;
  fullName: string;
  email: string | null;
  accountType: string;
  positionName: string | null;
  departmentName: string | null;
  teamName: string | null;
  status: string;
}

interface EffectiveAccessData {
  user: EffectiveAccessUser;
  effectivePolicies: EffectivePolicy[];
  positionPolicies: EffectivePolicy[];
  activeOverrides: UserOverrideRecord[];
}

interface WhoCanHolder {
  userId: string;
  fullName: string;
  email: string | null;
  positionName: string | null;
  departmentName: string | null;
  source: PolicySource;
  scope: string;
  allowed: boolean;
  reason?: string | null;
  expiresAt?: string | null;
}

interface WhoCanResponse {
  holders: WhoCanHolder[];
}

interface UserOverrideRecord {
  id: string;
  userId: string;
  userName: string;
  userEmail: string | null;
  action: string;
  allowed: boolean;
  scope: string;
  reason: string;
  grantedByName: string;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  isExpired: boolean;
  ageDays: number;
}

interface PositionListItem {
  id: string;
  name: string;
  departmentName?: string | null;
}

interface RoleChangeRequestRecord {
  id: string;
  subjectUserId: string;
  subjectUserName: string;
  fromPositionName: string | null;
  toPositionName: string;
  toDepartmentName: string;
  requestedByName: string;
  requestedAt: string;
  reason: string;
  status: RoleRequestStatus;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
}

interface RegistryAction {
  action: string;
  module: string;
  resource: string | null;
  domain: string;
  sensitive: boolean;
  approvalBearing: boolean;
  description: string;
}

interface OverrideFormState {
  userId: string;
  action: string;
  allowed: boolean;
  scope: OverrideScope;
  reason: string;
  expiresAt: string;
}

interface RoleRequestFormState {
  subjectUserId: string;
  toPositionId: string;
  reason: string;
}

interface DecisionFormState {
  status: DecisionStatus;
  decisionReason: string;
}

interface ErrorLike {
  response?: {
    data?: ApiErrorResponse;
  };
  message?: string;
}

const DEFAULT_ACTION = 'deals:view';

const OVERRIDE_SCOPES: Array<{
  value: OverrideScope;
  label: string;
}> = [
  {
    value: 'own',
    label: 'own (resources owned by user)',
  },
  {
    value: 'participant',
    label: 'participant (workflow party)',
  },
  {
    value: 'pool',
    label: 'pool (supervisor pool members)',
  },
  {
    value: 'team',
    label: 'team (transitive downward)',
  },
  {
    value: 'department',
    label: 'department (whole department)',
  },
  {
    value: 'all-people',
    label: 'all-people (people domain only)',
  },
];

const getErrorMessage = (error: unknown, fallback: string): string => {
  const typedError = error as ErrorLike;

  const responseMessage = typedError.response?.data?.message;

  if (typeof responseMessage === 'string' && responseMessage.trim().length > 0) {
    return responseMessage;
  }

  const responseError = typedError.response?.data?.error;

  if (typeof responseError === 'string' && responseError.trim().length > 0) {
    return responseError;
  }

  if (typeof typedError.message === 'string' && typedError.message.trim().length > 0) {
    return typedError.message;
  }

  return fallback;
};

const getInitials = (name: string): string => {
  const normalized = name.trim();

  if (!normalized) {
    return 'U';
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  const first = parts[0];

  if (!first) {
    return 'U';
  }

  if (parts.length === 1) {
    return first.charAt(0).toUpperCase();
  }

  const last = parts[parts.length - 1];

  if (!last) {
    return first.charAt(0).toUpperCase();
  }

  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
};

const formatDate = (value: string | null | undefined): string => {
  if (!value) {
    return 'N/A';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'N/A';
  }

  return date.toLocaleDateString();
};

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) {
    return 'N/A';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'N/A';
  }

  return date.toLocaleString();
};

const isValidDateTime = (value: string): boolean => {
  if (!value) {
    return true;
  }

  const date = new Date(value);

  return !Number.isNaN(date.getTime());
};

export default function AccessManagementPage() {
  const [activeTab, setActiveTab] = useState<Tab>('explorer');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  /*
   * ------------------------------------------------------------------------
   * EXPLORER
   * ------------------------------------------------------------------------
   */

  const [explorerMode, setExplorerMode] = useState<ExplorerMode>('user');

  const [allUsers, setAllUsers] = useState<UserListItem[]>([]);

  const [selectedUserId, setSelectedUserId] = useState<string>('');

  const [userAccess, setUserAccess] = useState<EffectiveAccessData | null>(null);

  const [policySearch, setPolicySearch] = useState('');

  const [registryActions, setRegistryActions] = useState<RegistryAction[]>([]);

  const [selectedAction, setSelectedAction] = useState<string>(DEFAULT_ACTION);

  const [whoCanHolders, setWhoCanHolders] = useState<WhoCanHolder[]>([]);

  const [whoCanLoading, setWhoCanLoading] = useState(false);

  /*
   * ------------------------------------------------------------------------
   * OVERRIDES
   * ------------------------------------------------------------------------
   */

  const [overrides, setOverrides] = useState<UserOverrideRecord[]>([]);

  const [createOverrideModal, setCreateOverrideModal] = useState(false);

  const [overrideForm, setOverrideForm] = useState<OverrideFormState>({
    userId: '',
    action: DEFAULT_ACTION,
    allowed: true,
    scope: 'team',
    reason: '',
    expiresAt: '',
  });

  /*
   * ------------------------------------------------------------------------
   * ROLE CHANGE REQUESTS
   * ------------------------------------------------------------------------
   */

  const [roleRequests, setRoleRequests] = useState<RoleChangeRequestRecord[]>([]);

  const [allPositions, setAllPositions] = useState<PositionListItem[]>([]);

  const [createRoleRequestModal, setCreateRoleRequestModal] = useState(false);

  const [roleRequestForm, setRoleRequestForm] = useState<RoleRequestFormState>({
    subjectUserId: '',
    toPositionId: '',
    reason: '',
  });

  const [decideModalOpen, setDecideModalOpen] = useState(false);

  const [selectedRequest, setSelectedRequest] = useState<RoleChangeRequestRecord | null>(
    null,
  );

  const [decisionForm, setDecisionForm] = useState<DecisionFormState>({
    status: 'approved',
    decisionReason: '',
  });

  /*
   * ------------------------------------------------------------------------
   * DATA LOADERS
   * ------------------------------------------------------------------------
   */

  const loadUserEffectiveAccess = useCallback(async (userId: string): Promise<void> => {
    if (!userId) {
      setUserAccess(null);
      return;
    }

    try {
      setLoading(true);
      setError('');

      const encodedUserId = encodeURIComponent(userId);

      const response = await api.get<ApiSuccess<EffectiveAccessData>>(
        `/access/effective/${encodedUserId}`,
      );

      if (!response.data.success) {
        throw new Error(response.data.message || 'Unable to load effective permissions.');
      }

      setUserAccess(response.data.data);
    } catch (requestError: unknown) {
      setUserAccess(null);
      setError(getErrorMessage(requestError, 'Failed to load user permissions.'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadWhoCan = useCallback(async (action: string): Promise<void> => {
    if (!action) {
      setWhoCanHolders([]);
      return;
    }

    try {
      setWhoCanLoading(true);
      setError('');

      const encodedAction = encodeURIComponent(action);

      const response = await api.get<ApiSuccess<WhoCanResponse>>(
        `/access/who-can/${encodedAction}`,
      );

      if (!response.data.success) {
        throw new Error(response.data.message || 'Unable to query authorized holders.');
      }

      setWhoCanHolders(response.data.data?.holders ?? []);
    } catch (requestError: unknown) {
      setWhoCanHolders([]);

      setError(getErrorMessage(requestError, 'Failed to query action holders.'));
    } finally {
      setWhoCanLoading(false);
    }
  }, []);

  const loadOverrides = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError('');

      const response =
        await api.get<ApiSuccess<UserOverrideRecord[]>>('/access/overrides');

      if (!response.data.success) {
        throw new Error(response.data.message || 'Unable to load user overrides.');
      }

      setOverrides(response.data.data ?? []);
    } catch (requestError: unknown) {
      setOverrides([]);

      setError(getErrorMessage(requestError, 'Failed to load user overrides.'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRoleRequests = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError('');

      const response = await api.get<ApiSuccess<RoleChangeRequestRecord[]>>(
        '/access/role-change-requests',
      );

      if (!response.data.success) {
        throw new Error(response.data.message || 'Unable to load role change requests.');
      }

      setRoleRequests(response.data.data ?? []);
    } catch (requestError: unknown) {
      setRoleRequests([]);

      setError(getErrorMessage(requestError, 'Failed to load role change requests.'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPositions = useCallback(async (): Promise<void> => {
    try {
      const response = await api.get<ApiSuccess<PositionListItem[]>>('/org/ladder/sales');

      if (!response.data.success) {
        throw new Error(
          response.data.message || 'Unable to load organization positions.',
        );
      }

      setAllPositions(response.data.data ?? []);
    } catch {
      /*
       * Position loading is supplementary to the role queue.
       * Keep the queue usable even if the ladder endpoint is unavailable.
       */
      setAllPositions([]);
    }
  }, []);

  const loadRegistry = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError('');

      const response = await api.get<ApiSuccess<RegistryAction[]>>(
        '/access/registry-actions',
      );

      if (!response.data.success) {
        throw new Error(response.data.message || 'Unable to load action registry.');
      }

      setRegistryActions(response.data.data ?? []);
    } catch (requestError: unknown) {
      setRegistryActions([]);

      setError(getErrorMessage(requestError, 'Failed to load actions catalog.'));
    } finally {
      setLoading(false);
    }
  }, []);

  /*
   * ------------------------------------------------------------------------
   * INITIAL METADATA
   * ------------------------------------------------------------------------
   */

  useEffect(() => {
    let mounted = true;

   const fetchInitialData = async () => {
     try {
       setLoading(true);
       setError('');

       const [usersRes, actionsRes] = await Promise.allSettled([
         api.get('/access/users'),
         api.get('/access/registry-actions'),
       ]);

       // ------------------------------------------------------------
       // USERS
       // ------------------------------------------------------------
       let uList: Array<{
         id: string;
         fullName: string;
         email: string | null;
         accountType?: string;
         positionName?: string | null;
       }> = [];

       if (usersRes.status === 'fulfilled') {
         const responseData = usersRes.value?.data;

         /*
          * Support the possible API response shapes:
          *
          * { success: true, data: [...] }
          *
          * { success: true, data: { users: [...] } }
          *
          * { success: true, data: { items: [...] } }
          *
          * { success: true, users: [...] }
          */
         const candidate =
           responseData?.data ?? responseData?.users ?? responseData?.items ?? [];

         if (Array.isArray(candidate)) {
           uList = candidate;
         } else if (Array.isArray(candidate?.users)) {
           uList = candidate.users;
         } else if (Array.isArray(candidate?.items)) {
           uList = candidate.items;
         }
       }

       setAllUsers(uList);

       // ------------------------------------------------------------
       // REGISTRY ACTIONS
       // ------------------------------------------------------------
       let aList: RegistryAction[] = [];

       if (actionsRes.status === 'fulfilled') {
         const responseData = actionsRes.value?.data;

         const candidate =
           responseData?.data ?? responseData?.actions ?? responseData?.items ?? [];

         if (Array.isArray(candidate)) {
           aList = candidate;
         } else if (Array.isArray(candidate?.actions)) {
           aList = candidate.actions;
         } else if (Array.isArray(candidate?.items)) {
           aList = candidate.items;
         }
       }

       setRegistryActions(aList);

       // ------------------------------------------------------------
       // DEFAULT USER
       // ------------------------------------------------------------
       if (uList.length > 0 && uList[0]?.id) {
         const firstUserId = uList[0].id;

         setSelectedUserId(firstUserId);

         void loadUserEffectiveAccess(firstUserId);
       }
     } catch (err: unknown) {
       console.error('Access Management initial data error:', err);

       setError('Unable to load initial access metadata.');
       setAllUsers([]);
       setRegistryActions([]);
     } finally {
       setLoading(false);
     }
   };

    void fetchInitialData();

    return () => {
      mounted = false;
    };
  }, []);

  /*
   * ------------------------------------------------------------------------
   * TAB DATA FETCHING
   * ------------------------------------------------------------------------
   */

  useEffect(() => {
    setError('');
    setSuccessMessage('');

    if (activeTab === 'explorer') {
      if (explorerMode === 'user' && selectedUserId) {
        void loadUserEffectiveAccess(selectedUserId);
      }

      if (explorerMode === 'action' && selectedAction) {
        void loadWhoCan(selectedAction);
      }

      return;
    }

    if (activeTab === 'overrides') {
      void loadOverrides();
      return;
    }

    if (activeTab === 'role-changes') {
      void loadRoleRequests();
      void loadPositions();
      return;
    }

    if (activeTab === 'registry') {
      void loadRegistry();
    }
  }, [
    activeTab,
    explorerMode,
    selectedUserId,
    selectedAction,
    loadUserEffectiveAccess,
    loadWhoCan,
    loadOverrides,
    loadRoleRequests,
    loadPositions,
    loadRegistry,
  ]);

  /*
   * ------------------------------------------------------------------------
   * DERIVED DATA
   * ------------------------------------------------------------------------
   */

  const filteredPolicies = useMemo(() => {
    const policies = userAccess?.effectivePolicies ?? [];
    const query = policySearch.trim().toLowerCase();

    if (!query) {
      return policies;
    }

    return policies.filter((policy) => {
      return (
        policy.action.toLowerCase().includes(query) ||
        policy.scope.toLowerCase().includes(query)
      );
    });
  }, [userAccess, policySearch]);

  const pendingRoleRequestCount = useMemo(
    () => roleRequests.filter((request) => request.status === 'pending').length,
    [roleRequests],
  );

  const effectiveActionCount = useMemo(
    () => userAccess?.effectivePolicies?.filter((policy) => policy.allowed).length ?? 0,
    [userAccess],
  );

  const activeOverrideCount = useMemo(
    () => userAccess?.activeOverrides?.length ?? 0,
    [userAccess],
  );

  /*
   * ------------------------------------------------------------------------
   * ACTION HANDLERS
   * ------------------------------------------------------------------------
   */

  const handleCreateOverride = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();

    const userId = overrideForm.userId.trim();
    const action = overrideForm.action.trim();
    const reason = overrideForm.reason.trim();

    if (!userId) {
      setError('Target user is required.');
      return;
    }

    if (!action) {
      setError('An action capability is required.');
      return;
    }

    if (!reason) {
      setError('A documented business reason is required (PRD AM-6).');
      return;
    }

    if (!isValidDateTime(overrideForm.expiresAt)) {
      setError('Please provide a valid expiration date.');
      return;
    }

    const expiryDate = overrideForm.expiresAt ? new Date(overrideForm.expiresAt) : null;

    if (expiryDate && expiryDate.getTime() <= Date.now()) {
      setError('Expiration date must be in the future.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setSuccessMessage('');

      await api.post('/access/override', {
        userId,
        action,
        allowed: overrideForm.allowed,
        scope: overrideForm.scope,
        reason,
        expiresAt: expiryDate ? expiryDate.toISOString() : null,
      });

      setCreateOverrideModal(false);

      setSuccessMessage('User permission override granted successfully.');

      await loadOverrides();

      if (selectedUserId === userId) {
        await loadUserEffectiveAccess(userId);
      }
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'Failed to grant override.'));
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeOverride = async (id: string): Promise<void> => {
    const overrideId = id.trim();

    if (!overrideId) {
      setError('Invalid override identifier.');
      return;
    }

    const confirmed = window.confirm(
      'Are you sure you want to revoke this permission override?',
    );

    if (!confirmed) {
      return;
    }

    try {
      setLoading(true);
      setError('');
      setSuccessMessage('');

      await api.delete(`/access/override/${encodeURIComponent(overrideId)}`);

      setSuccessMessage('Override revoked.');

      await loadOverrides();

      if (selectedUserId) {
        await loadUserEffectiveAccess(selectedUserId);
      }
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'Failed to revoke override.'));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRoleRequest = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();

    const subjectUserId = roleRequestForm.subjectUserId.trim();

    const toPositionId = roleRequestForm.toPositionId.trim();

    const reason = roleRequestForm.reason.trim();

    if (!subjectUserId) {
      setError('Employee selection is required.');
      return;
    }

    if (!toPositionId) {
      setError('Target position is required.');
      return;
    }

    if (!reason) {
      setError('A justification reason is required.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setSuccessMessage('');

      await api.post('/access/role-change-request', {
        subjectUserId,
        toPositionId,
        reason,
      });

      setCreateRoleRequestModal(false);

      setSuccessMessage('Role change request submitted to Super Admin queue.');

      await loadRoleRequests();
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'Failed to submit role change request.'));
    } finally {
      setLoading(false);
    }
  };

  const handleDecideRequest = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();

    if (!selectedRequest) {
      setError('No role change request selected.');
      return;
    }

    const decisionReason = decisionForm.decisionReason.trim();

    try {
      setLoading(true);
      setError('');
      setSuccessMessage('');

      await api.post(
        `/access/role-change-request/${encodeURIComponent(selectedRequest.id)}/decide`,
        {
          status: decisionForm.status,
          decisionReason: decisionReason || undefined,
        },
      );

      const statusLabel = decisionForm.status === 'approved' ? 'approved' : 'rejected';

      setDecideModalOpen(false);
      setSelectedRequest(null);

      setSuccessMessage(`Role change request successfully ${statusLabel}.`);

      await loadRoleRequests();
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'Failed to decide role change request.'));
    } finally {
      setLoading(false);
    }
  };

  /*
   * ------------------------------------------------------------------------
   * MODAL OPENERS
   * ------------------------------------------------------------------------
   */

  const openCreateOverrideModal = (): void => {
    setError('');

    setOverrideForm({
      userId: selectedUserId || allUsers[0]?.id || '',
      action: selectedAction || registryActions[0]?.action || DEFAULT_ACTION,
      allowed: true,
      scope: 'team',
      reason: '',
      expiresAt: '',
    });

    setCreateOverrideModal(true);
  };

  const openCreateRoleRequestModal = (): void => {
    setError('');

    setRoleRequestForm({
      subjectUserId: selectedUserId || allUsers[0]?.id || '',
      toPositionId: allPositions[0]?.id || '',
      reason: '',
    });

    setCreateRoleRequestModal(true);
  };

  const openDecisionModal = (request: RoleChangeRequestRecord): void => {
    setSelectedRequest(request);

    setDecisionForm({
      status: 'approved',
      decisionReason: '',
    });

    setError('');
    setDecideModalOpen(true);
  };

  /*
   * ------------------------------------------------------------------------
   * RENDER
   * ------------------------------------------------------------------------
   */

  return (
    <div className="page-container">
      {/* HEADER */}
      <div className="page-header">
        <div className="page-header-title">
          <h1>Access Management</h1>

          <p>
            Inspect effective permissions, grant scope-bound overrides, manage position
            requests, and review capabilities (PRD §8.3).
          </p>
        </div>

        <div className="page-header-actions">
          {activeTab === 'overrides' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={openCreateOverrideModal}
              disabled={loading || allUsers.length === 0}
            >
              <PlusIcon size={16} />
              <span>Grant Override</span>
            </button>
          )}

          {activeTab === 'role-changes' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={openCreateRoleRequestModal}
              disabled={loading || allUsers.length === 0 || allPositions.length === 0}
            >
              <PlusIcon size={16} />
              <span>Request Role Change</span>
            </button>
          )}
        </div>
      </div>

      {/* ERROR */}
      {error && (
        <div className="alert alert-error">
          <AlertCircleIcon className="alert-icon" />

          <div>
            <strong>Error</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* SUCCESS */}
      {successMessage && (
        <div className="alert alert-success">
          <CheckIcon className="alert-icon" />

          <div>
            <strong>Success</strong>
            <p>{successMessage}</p>
          </div>
        </div>
      )}

      {/* TOP NAVIGATION */}
      <div
        className="card"
        style={{
          marginBottom: '24px',
          padding: '12px 16px',
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            className={`btn btn-sm ${
              activeTab === 'explorer' ? 'btn-primary' : 'btn-secondary'
            }`}
            onClick={() => setActiveTab('explorer')}
          >
            <SearchIcon size={14} />
            <span>Access Explorer</span>
          </button>

          <button
            type="button"
            className={`btn btn-sm ${
              activeTab === 'overrides' ? 'btn-primary' : 'btn-secondary'
            }`}
            onClick={() => setActiveTab('overrides')}
          >
            <KeyIcon size={14} />
            <span>User Overrides ({overrides.length})</span>
          </button>

          <button
            type="button"
            className={`btn btn-sm ${
              activeTab === 'role-changes' ? 'btn-primary' : 'btn-secondary'
            }`}
            onClick={() => setActiveTab('role-changes')}
          >
            <PositionLadderIcon size={14} />

            <span>Role Change Queue ({pendingRoleRequestCount} pending)</span>
          </button>

          <button
            type="button"
            className={`btn btn-sm ${
              activeTab === 'registry' ? 'btn-primary' : 'btn-secondary'
            }`}
            onClick={() => setActiveTab('registry')}
          >
            <ShieldIcon size={14} />

            <span>Registry Actions ({registryActions.length})</span>
          </button>
        </div>
      </div>

      {/* ================================================================= *
       * TAB 1: ACCESS EXPLORER
       * ================================================================= */}
      {activeTab === 'explorer' && (
        <div>
          {/* MODE SWITCHER */}
          <div
            className="card"
            style={{
              marginBottom: '20px',
              padding: '16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                gap: '16px',
                alignItems: 'center',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                  }}
                >
                  Query Mode:
                </span>

                <button
                  type="button"
                  className={`btn btn-sm ${
                    explorerMode === 'user' ? 'btn-primary' : 'btn-ghost'
                  }`}
                  onClick={() => setExplorerMode('user')}
                >
                  <UsersIcon size={14} />
                  <span>Person → Effective Permissions</span>
                </button>

                <button
                  type="button"
                  className={`btn btn-sm ${
                    explorerMode === 'action' ? 'btn-primary' : 'btn-ghost'
                  }`}
                  onClick={() => setExplorerMode('action')}
                >
                  <KeyIcon size={14} />
                  <span>Action → Authorized Holders</span>
                </button>
              </div>

              {/* USER SELECTOR */}
              {explorerMode === 'user' ? (
                <div
                  style={{
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <label
                    htmlFor="access-user-selector"
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                    }}
                  >
                    Employee:
                  </label>

                  <select
                    id="access-user-selector"
                    className="form-control"
                    style={{
                      width: '260px',
                      maxWidth: '100%',
                    }}
                    value={selectedUserId}
                    onChange={(event) => setSelectedUserId(event.target.value)}
                    disabled={allUsers.length === 0}
                  >
                    {allUsers.length === 0 ? (
                      <option value="">No users found</option>
                    ) : (
                      allUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.fullName} ({user.email || user.accountType || 'user'})
                        </option>
                      ))
                    )}
                  </select>
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <label
                    htmlFor="access-action-selector"
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                    }}
                  >
                    Action Capability:
                  </label>

                  <select
                    id="access-action-selector"
                    className="form-control"
                    style={{
                      width: '280px',
                      maxWidth: '100%',
                    }}
                    value={selectedAction}
                    onChange={(event) => setSelectedAction(event.target.value)}
                    disabled={registryActions.length === 0}
                  >
                    {registryActions.length === 0 ? (
                      <option value="">No actions found</option>
                    ) : (
                      registryActions.map((action) => (
                        <option key={action.action} value={action.action}>
                          {action.action} ({action.module})
                        </option>
                      ))
                    )}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* USER MODE */}
          {explorerMode === 'user' ? (
            loading ? (
              <div className="card">
                <div className="loading-state">
                  <div className="spinner" />

                  <span>Evaluating effective policies for selected user...</span>
                </div>
              </div>
            ) : userAccess ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '20px',
                }}
              >
                {/* PROFILE */}
                <div
                  className="card"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '16px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px',
                    }}
                  >
                    <div
                      aria-hidden="true"
                      style={{
                        width: '46px',
                        height: '46px',
                        borderRadius: 'var(--radius-full)',
                        background:
                          'linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%)',
                        color: '#fff',
                        fontSize: '17px',
                        fontWeight: 750,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {getInitials(userAccess.user?.fullName ?? '')}
                    </div>

                    <div>
                      <h2
                        style={{
                          fontSize: '17px',
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {userAccess.user?.fullName || 'User'}
                      </h2>

                      <div
                        style={{
                          fontSize: '13px',
                          color: 'var(--text-secondary)',
                          display: 'flex',
                          gap: '8px',
                          alignItems: 'center',
                          marginTop: '2px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span>{userAccess.user?.email || 'N/A'}</span>

                        <span aria-hidden="true">•</span>

                        <strong>
                          {userAccess.user?.positionName ||
                            userAccess.user?.accountType ||
                            'Super Admin'}
                        </strong>

                        <span aria-hidden="true">•</span>

                        <span>
                          {userAccess.user?.departmentName || 'Root Management'}
                        </span>

                        {userAccess.user?.teamName && (
                          <>
                            <span aria-hidden="true">•</span>

                            <span>{userAccess.user.teamName}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      gap: '20px',
                    }}
                  >
                    <div
                      style={{
                        textAlign: 'right',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          textTransform: 'uppercase',
                          fontWeight: 700,
                        }}
                      >
                        Effective Actions
                      </div>

                      <div
                        style={{
                          fontSize: '18px',
                          fontWeight: 800,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {effectiveActionCount}
                      </div>
                    </div>

                    <div
                      style={{
                        textAlign: 'right',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          textTransform: 'uppercase',
                          fontWeight: 700,
                        }}
                      >
                        Custom Overrides
                      </div>

                      <div
                        style={{
                          fontSize: '18px',
                          fontWeight: 800,
                          color: 'var(--primary)',
                        }}
                      >
                        {activeOverrideCount}
                      </div>
                    </div>
                  </div>
                </div>

                {/* POLICY TABLE */}
                <div className="card">
                  <div className="card-header">
                    <div>
                      <h2 className="card-title">Effective Permission Policies</h2>

                      <p className="card-subtitle">
                        Computed resolution: position default policies overridden by
                        active per-user grants (PRD §4.1).
                      </p>
                    </div>

                    <input
                      type="text"
                      className="form-control"
                      style={{
                        width: '220px',
                        maxWidth: '100%',
                      }}
                      placeholder="Filter policies..."
                      value={policySearch}
                      onChange={(event) => setPolicySearch(event.target.value)}
                      aria-label="Filter policies"
                    />
                  </div>

                  <div className="table-container">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Action Name</th>
                          <th>Access</th>
                          <th>Scope Reach</th>
                          <th>Source / Provenance</th>
                          <th>Details & Expiry</th>
                        </tr>
                      </thead>

                      <tbody>
                        {filteredPolicies.length === 0 ? (
                          <tr>
                            <td
                              colSpan={5}
                              style={{
                                textAlign: 'center',
                                padding: '24px',
                                color: 'var(--text-muted)',
                              }}
                            >
                              No matching policies found.
                            </td>
                          </tr>
                        ) : (
                          filteredPolicies.map((policy) => (
                            <tr key={`${policy.action}-${policy.source}-${policy.scope}`}>
                              <td>
                                <code>{policy.action}</code>
                              </td>

                              <td>
                                <span
                                  className={`badge ${
                                    policy.allowed ? 'badge-success' : 'badge-danger'
                                  }`}
                                >
                                  {policy.allowed ? 'Allowed' : 'Denied'}
                                </span>
                              </td>

                              <td>
                                <span className="badge badge-info">{policy.scope}</span>
                              </td>

                              <td>
                                {policy.source === 'override' ? (
                                  <span className="badge badge-warning">
                                    Custom Override
                                  </span>
                                ) : (
                                  <span className="badge badge-neutral">
                                    Position Ladder
                                  </span>
                                )}
                              </td>

                              <td
                                style={{
                                  fontSize: '12.5px',
                                  color: 'var(--text-secondary)',
                                }}
                              >
                                {policy.overrideReason ? (
                                  <div>
                                    <em>"{policy.overrideReason}"</em>

                                    {policy.overrideExpiresAt && (
                                      <div
                                        style={{
                                          fontSize: '11.5px',
                                          color: 'var(--warning-text)',
                                          marginTop: '2px',
                                        }}
                                      >
                                        Expires: {formatDate(policy.overrideExpiresAt)}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  'Inherited from position default'
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="card">
                <div className="empty-state">
                  <div className="empty-state-icon">
                    <UsersIcon size={28} />
                  </div>

                  <h3>Select a user to inspect permissions</h3>

                  <p>
                    Choose an employee or admin account from the dropdown above to view
                    their effective access.
                  </p>
                </div>
              </div>
            )
          ) : (
            /* ACTION MODE */
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">
                    Authorized Principals for: <code>{selectedAction || 'N/A'}</code>
                  </h2>

                  <p className="card-subtitle">
                    Reverse lookup (PRD AM-5): every employee holding capability, where it
                    came from, and their reach.
                  </p>
                </div>
              </div>

              {whoCanLoading ? (
                <div className="loading-state">
                  <div className="spinner" />

                  <span>Evaluating authorization policies...</span>
                </div>
              ) : whoCanHolders.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">
                    <ShieldIcon size={28} />
                  </div>

                  <h3>No authorized staff</h3>

                  <p>
                    No active employees or overrides currently grant capability{' '}
                    <code>{selectedAction || 'N/A'}</code>.
                  </p>
                </div>
              ) : (
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Position & Department</th>
                        <th>Scope Reach</th>
                        <th>Grant Origin</th>
                        <th>Details</th>
                      </tr>
                    </thead>

                    <tbody>
                      {whoCanHolders.map((holder) => (
                        <tr key={`${holder.userId}-${holder.source}-${holder.scope}`}>
                          <td>
                            <strong>{holder.fullName}</strong>

                            <div
                              style={{
                                fontSize: '12px',
                                color: 'var(--text-muted)',
                              }}
                            >
                              {holder.email || 'N/A'}
                            </div>
                          </td>

                          <td>
                            <div>{holder.positionName || 'Super Admin'}</div>

                            <div
                              style={{
                                fontSize: '12px',
                                color: 'var(--text-muted)',
                              }}
                            >
                              {holder.departmentName || 'Root'}
                            </div>
                          </td>

                          <td>
                            <span className="badge badge-info">{holder.scope}</span>
                          </td>

                          <td>
                            {holder.source === 'override' ? (
                              <span className="badge badge-warning">User Override</span>
                            ) : (
                              <span className="badge badge-neutral">Position Policy</span>
                            )}
                          </td>

                          <td
                            style={{
                              fontSize: '12.5px',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {holder.reason
                              ? `Reason: "${holder.reason}"`
                              : 'Default position capability'}

                            {holder.expiresAt && (
                              <div
                                style={{
                                  fontSize: '11.5px',
                                  marginTop: '3px',
                                }}
                              >
                                Expires: {formatDate(holder.expiresAt)}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================================================================= *
       * TAB 2: USER OVERRIDES
       * ================================================================= */}
      {activeTab === 'overrides' && (
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">User-Specific Permission Overrides</h2>

              <p className="card-subtitle">
                Individual exceptions carrying their own scope, documented reason, and
                expiry (PRD §4.4).
              </p>
            </div>
          </div>

          {loading ? (
            <div className="loading-state">
              <div className="spinner" />

              <span>Loading overrides...</span>
            </div>
          ) : overrides.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <KeyIcon size={28} />
              </div>

              <h3>No active overrides</h3>

              <p>
                All staff are currently governed strictly by their position default
                policies.
              </p>
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Action</th>
                    <th>Access</th>
                    <th>Scope</th>
                    <th>Documented Reason</th>
                    <th>Granted By & Age</th>
                    <th>Status / Expiry</th>
                    <th
                      style={{
                        textAlign: 'right',
                      }}
                    >
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {overrides.map((override) => (
                    <tr key={override.id}>
                      <td>
                        <strong>{override.userName}</strong>

                        <div
                          style={{
                            fontSize: '12px',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {override.userEmail || 'N/A'}
                        </div>
                      </td>

                      <td>
                        <code>{override.action}</code>
                      </td>

                      <td>
                        <span
                          className={`badge ${
                            override.allowed ? 'badge-success' : 'badge-danger'
                          }`}
                        >
                          {override.allowed ? 'Allowed' : 'Denied'}
                        </span>
                      </td>

                      <td>
                        <span className="badge badge-info">{override.scope}</span>
                      </td>

                      <td
                        style={{
                          maxWidth: '240px',
                          fontSize: '13px',
                        }}
                      >
                        "{override.reason}"
                      </td>

                      <td>
                        <div>{override.grantedByName}</div>

                        <div
                          style={{
                            fontSize: '12px',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {override.ageDays} days ago
                          {override.ageDays > 180 && (
                            <span
                              className="badge badge-danger"
                              style={{
                                marginLeft: '6px',
                              }}
                            >
                              ⚠️ &gt;180d Review (AM-9)
                            </span>
                          )}
                        </div>
                      </td>

                      <td>
                        {override.revokedAt ? (
                          <span className="badge badge-neutral">Revoked</span>
                        ) : override.isExpired ? (
                          <span className="badge badge-danger">Expired</span>
                        ) : (
                          <span className="badge badge-active">
                            Active{' '}
                            {override.expiresAt
                              ? `(until ${formatDate(override.expiresAt)})`
                              : '(No expiry)'}
                          </span>
                        )}
                      </td>

                      <td
                        style={{
                          textAlign: 'right',
                        }}
                      >
                        {!override.revokedAt && !override.isExpired && (
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => void handleRevokeOverride(override.id)}
                            disabled={loading}
                          >
                            <TrashIcon size={14} />
                            <span>Revoke</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= *
       * TAB 3: ROLE CHANGE QUEUE
       * ================================================================= */}
      {activeTab === 'role-changes' && (
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Employee Role Change Queue</h2>

              <p className="card-subtitle">
                Segregation of Duties (A1): Requests must be approved by Super Admin;
                requester cannot decide their own request.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="loading-state">
              <div className="spinner" />

              <span>Loading role change requests...</span>
            </div>
          ) : roleRequests.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <PositionLadderIcon size={28} />
              </div>

              <h3>No role change requests</h3>

              <p>
                Submit a request to change an employee's position and reporting ladder.
              </p>
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Current Position</th>
                    <th>Requested Target Position</th>
                    <th>Justification</th>
                    <th>Requested By & Date</th>
                    <th>Status</th>
                    <th
                      style={{
                        textAlign: 'right',
                      }}
                    >
                      Decision
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {roleRequests.map((request) => (
                    <tr key={request.id}>
                      <td>
                        <strong>{request.subjectUserName}</strong>
                      </td>

                      <td>{request.fromPositionName || 'Unassigned'}</td>

                      <td>
                        <strong
                          style={{
                            color: 'var(--primary)',
                          }}
                        >
                          {request.toPositionName}
                        </strong>

                        <div
                          style={{
                            fontSize: '12px',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {request.toDepartmentName}
                        </div>
                      </td>

                      <td
                        style={{
                          maxWidth: '240px',
                          fontSize: '13px',
                        }}
                      >
                        "{request.reason}"
                      </td>

                      <td>
                        <div>{request.requestedByName}</div>

                        <div
                          style={{
                            fontSize: '12px',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {formatDate(request.requestedAt)}
                        </div>
                      </td>

                      <td>
                        <span
                          className={`badge ${
                            request.status === 'approved'
                              ? 'badge-success'
                              : request.status === 'rejected'
                                ? 'badge-danger'
                                : 'badge-warning'
                          }`}
                        >
                          {request.status.toUpperCase()}
                        </span>
                      </td>

                      <td
                        style={{
                          textAlign: 'right',
                        }}
                      >
                        {request.status === 'pending' ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => openDecisionModal(request)}
                            disabled={loading}
                          >
                            Decide Request
                          </button>
                        ) : (
                          <div
                            style={{
                              fontSize: '12px',
                              color: 'var(--text-muted)',
                            }}
                          >
                            Decided by {request.decidedByName || 'Admin'}
                            {request.decidedAt && (
                              <> on {formatDate(request.decidedAt)}</>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= *
       * TAB 4: REGISTRY
       * ================================================================= */}
      {activeTab === 'registry' && (
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">System Action Registry</h2>

              <p className="card-subtitle">
                Machine-enforced platform capability registry with domain rules and audit
                sensitivity.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="loading-state">
              <div className="spinner" />

              <span>Loading action registry...</span>
            </div>
          ) : registryActions.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <ShieldIcon size={28} />
              </div>

              <h3>No registry actions found</h3>

              <p>The platform action registry returned no capabilities.</p>
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Action Identifier</th>
                    <th>Module</th>
                    <th>Domain</th>
                    <th>Attributes</th>
                    <th>Description</th>
                  </tr>
                </thead>

                <tbody>
                  {registryActions.map((action) => (
                    <tr key={action.action}>
                      <td>
                        <code>{action.action}</code>
                      </td>

                      <td>
                        <span className="badge badge-neutral">{action.module}</span>
                      </td>

                      <td>
                        <span
                          className={`badge ${
                            action.domain === 'people' ? 'badge-info' : 'badge-primary'
                          }`}
                        >
                          {action.domain}
                        </span>
                      </td>

                      <td>
                        <div
                          style={{
                            display: 'flex',
                            gap: '4px',
                            flexWrap: 'wrap',
                          }}
                        >
                          {action.sensitive && (
                            <span className="badge badge-danger">Sensitive</span>
                          )}

                          {action.approvalBearing && (
                            <span className="badge badge-warning">Approval Bearing</span>
                          )}

                          {!action.sensitive && !action.approvalBearing && (
                            <span className="badge badge-neutral">Standard</span>
                          )}
                        </div>
                      </td>

                      <td
                        style={{
                          fontSize: '12.5px',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {action.description || 'Core capability binding.'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= *
       * MODAL: CREATE OVERRIDE
       * ================================================================= */}
      <Modal
        isOpen={createOverrideModal}
        onClose={() => {
          if (!loading) {
            setCreateOverrideModal(false);
          }
        }}
        title="Grant User Permission Override"
        subtitle="Individual overrides replace position defaults for the specified action (PRD §4.4)."
      >
        <form onSubmit={handleCreateOverride}>
          <div className="form-grid">
            <div
              className="form-group"
              style={{
                gridColumn: '1 / -1',
              }}
            >
              <label htmlFor="override-user">Target Employee</label>

              <select
                id="override-user"
                className="form-control"
                value={overrideForm.userId}
                onChange={(event) =>
                  setOverrideForm((current) => ({
                    ...current,
                    userId: event.target.value,
                  }))
                }
                required
                disabled={loading}
              >
                {allUsers.length === 0 ? (
                  <option value="">No users available</option>
                ) : (
                  allUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.fullName} ({user.email || user.accountType || 'user'})
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="override-action">Action</label>

              <select
                id="override-action"
                className="form-control"
                value={overrideForm.action}
                onChange={(event) =>
                  setOverrideForm((current) => ({
                    ...current,
                    action: event.target.value,
                  }))
                }
                required
                disabled={loading || registryActions.length === 0}
              >
                {registryActions.length === 0 ? (
                  <option value="">No actions available</option>
                ) : (
                  registryActions.map((action) => (
                    <option key={action.action} value={action.action}>
                      {action.action}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="override-scope">Scope Reach</label>

              <select
                id="override-scope"
                className="form-control"
                value={overrideForm.scope}
                onChange={(event) =>
                  setOverrideForm((current) => ({
                    ...current,
                    scope: event.target.value as OverrideScope,
                  }))
                }
                required
                disabled={loading}
              >
                {OVERRIDE_SCOPES.map((scope) => (
                  <option key={scope.value} value={scope.value}>
                    {scope.label}
                  </option>
                ))}
              </select>
            </div>

            <div
              className="form-group"
              style={{
                gridColumn: '1 / -1',
              }}
            >
              <label htmlFor="override-reason">
                Documented Business Reason
                <span className="hint">Required (PRD AM-6)</span>
              </label>

              <textarea
                id="override-reason"
                className="form-control"
                rows={3}
                placeholder="Explain why this exception is granted..."
                value={overrideForm.reason}
                onChange={(event) =>
                  setOverrideForm((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
                required
                disabled={loading}
                maxLength={2000}
              />
            </div>

            <div
              className="form-group"
              style={{
                gridColumn: '1 / -1',
              }}
            >
              <label htmlFor="override-expiry">
                Expiration Date
                <span className="hint">Optional; evaluated at authorization time</span>
              </label>

              <input
                id="override-expiry"
                type="datetime-local"
                className="form-control"
                value={overrideForm.expiresAt}
                onChange={(event) =>
                  setOverrideForm((current) => ({
                    ...current,
                    expiresAt: event.target.value,
                  }))
                }
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCreateOverrideModal(false)}
              disabled={loading}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || allUsers.length === 0 || registryActions.length === 0}
            >
              {loading ? 'Granting...' : 'Grant Override'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ================================================================= *
       * MODAL: CREATE ROLE REQUEST
       * ================================================================= */}
      <Modal
        isOpen={createRoleRequestModal}
        onClose={() => {
          if (!loading) {
            setCreateRoleRequestModal(false);
          }
        }}
        title="Request Employee Role Change"
        subtitle="Submits a position promotion or transfer request to Super Admin."
      >
        <form onSubmit={handleCreateRoleRequest}>
          <div className="form-grid">
            <div
              className="form-group"
              style={{
                gridColumn: '1 / -1',
              }}
            >
              <label htmlFor="role-request-user">Employee</label>

              <select
                id="role-request-user"
                className="form-control"
                value={roleRequestForm.subjectUserId}
                onChange={(event) =>
                  setRoleRequestForm((current) => ({
                    ...current,
                    subjectUserId: event.target.value,
                  }))
                }
                required
                disabled={loading}
              >
                {allUsers.length === 0 ? (
                  <option value="">No employees available</option>
                ) : (
                  allUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.fullName} ({user.email || user.accountType || 'user'})
                    </option>
                  ))
                )}
              </select>
            </div>

            <div
              className="form-group"
              style={{
                gridColumn: '1 / -1',
              }}
            >
              <label htmlFor="role-request-position">Target Position</label>

              <select
                id="role-request-position"
                className="form-control"
                value={roleRequestForm.toPositionId}
                onChange={(event) =>
                  setRoleRequestForm((current) => ({
                    ...current,
                    toPositionId: event.target.value,
                  }))
                }
                required
                disabled={loading || allPositions.length === 0}
              >
                {allPositions.length === 0 ? (
                  <option value="">No positions available</option>
                ) : (
                  allPositions.map((position) => (
                    <option key={position.id} value={position.id}>
                      {position.name}
                      {position.departmentName ? ` — ${position.departmentName}` : ''}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div
              className="form-group"
              style={{
                gridColumn: '1 / -1',
              }}
            >
              <label htmlFor="role-request-reason">Justification & Reason</label>

              <textarea
                id="role-request-reason"
                className="form-control"
                rows={4}
                placeholder="Provide rationale for position change..."
                value={roleRequestForm.reason}
                onChange={(event) =>
                  setRoleRequestForm((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
                required
                disabled={loading}
                maxLength={2000}
              />
            </div>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCreateRoleRequestModal(false)}
              disabled={loading}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || allUsers.length === 0 || allPositions.length === 0}
            >
              {loading ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ================================================================= *
       * MODAL: DECIDE ROLE REQUEST
       * ================================================================= */}
      <Modal
        isOpen={decideModalOpen}
        onClose={() => {
          if (!loading) {
            setDecideModalOpen(false);
            setSelectedRequest(null);
          }
        }}
        title="Decide Role Change Request"
        subtitle={`Employee: ${selectedRequest?.subjectUserName || 'Unknown'} → Target: ${
          selectedRequest?.toPositionName || 'Unknown'
        }`}
      >
        <form onSubmit={handleDecideRequest}>
          <div className="form-grid">
            <div
              className="form-group"
              style={{
                gridColumn: '1 / -1',
              }}
            >
              <label htmlFor="decision-status">Decision</label>

              <select
                id="decision-status"
                className="form-control"
                value={decisionForm.status}
                onChange={(event) =>
                  setDecisionForm((current) => ({
                    ...current,
                    status: event.target.value === 'rejected' ? 'rejected' : 'approved',
                  }))
                }
                disabled={loading}
              >
                <option value="approved">Approve Promotion / Transfer</option>

                <option value="rejected">Reject Request</option>
              </select>
            </div>

            <div
              className="form-group"
              style={{
                gridColumn: '1 / -1',
              }}
            >
              <label htmlFor="decision-reason">Decision Comments / Feedback</label>

              <textarea
                id="decision-reason"
                className="form-control"
                rows={4}
                placeholder="Optional explanation of approval or rejection..."
                value={decisionForm.decisionReason}
                onChange={(event) =>
                  setDecisionForm((current) => ({
                    ...current,
                    decisionReason: event.target.value,
                  }))
                }
                disabled={loading}
                maxLength={2000}
              />
            </div>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDecideModalOpen(false)}
              disabled={loading}
            >
              Cancel
            </button>

            <button
              type="submit"
              className={`btn ${
                decisionForm.status === 'approved' ? 'btn-primary' : 'btn-danger'
              }`}
              disabled={loading || !selectedRequest}
            >
              {loading ? 'Processing...' : `Confirm ${decisionForm.status.toUpperCase()}`}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

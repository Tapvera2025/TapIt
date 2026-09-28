export interface OrganizationDepartment {
  id: string;
  code: string;
  name: string;
  kind: string;
  status: string;
  isSeeded: boolean;
}

export interface OrganizationTeam {
  id: string;
  name: string;
  kind: string;
  departmentId: string;
  parentTeamId: string | null;
  leadUserId: string | null;
  sharedVisibility?: boolean;
  isSeeded: boolean;
}

export interface OrganizationPosition {
  id: string;
  organizationId: string;
  departmentId: string;
  code: string;
  name: string;
  organizationalLevel: number;
  parentPositionId: string | null;
  isSeeded: boolean;
  status: string;
  maxDealValue: string | number | null;
  maxDiscountPercent: string | number | null;
  allowsCustomTerms: boolean;
  holderCount?: number;
  children?: OrganizationPosition[];
}

export interface OrganizationLadder {
  department: { id: string; code: string; name: string } | null;
  positions: OrganizationPosition[];
  teams: Array<{ id: string; name: string; kind: string }>;
}

export interface OrganizationDesignation {
  id: string;
  departmentId: string;
  name: string;
  specializations: string[];
  status: string;
  isSeeded: boolean;
}

export interface OrganizationEmployee {
  id: string;
  fullName: string;
  email?: string;
  positionId: string | null;
  positionName?: string | null;
  positionCode?: string | null;
  departmentId: string | null;
  departmentName?: string | null;
  teamId: string | null;
  teamName?: string | null;
  designationName?: string | null;
  specialization?: string | null;
  reportsTo: string | null;
  reportsToName?: string | null;
  missingManager?: boolean;
  effectiveManagerId?: string | null;
}

export interface OrganizationChartDepartment {
  id: string;
  code: string;
  name: string;
  status: string;
  headPositionNames: string[];
  peopleVisible: boolean;
  structureOnly: boolean;
}

export interface OrganizationChart {
  people: OrganizationEmployee[];
  departments: OrganizationChartDepartment[];
}

export interface ReportingManagerCandidate {
  id: string;
  fullName: string;
  accountType: 'employee' | 'super-admin';
}

export interface PositionImpactPreview {
  preview: true;
  operation?: string;
  position?: {
    code: string;
    name: string;
    departmentId: string;
    organizationalLevel: number;
    parentPositionId: string | null;
  };
  affectedPositionIds: string[];
  affectedHolderIds: string[];
  positionParentChanges?: Array<{
    positionId: string;
    currentParentPositionId: string | null;
    proposedParentPositionId: string | null;
  }>;
  reportingRelationships?: Array<Record<string, unknown>>;
  requiresConfirmation: boolean;
}

export interface PositionPolicy {
  id?: string;
  organizationId?: string;
  positionId?: string;
  action: string;
  allowed: boolean;
  scope: string;
  fields: string[] | null;
  constraints: string[] | null;
}

export interface PolicyImpactPreview {
  preview: true;
  holderCount: number;
  capabilitiesAdded: string[];
  capabilitiesRemoved: string[];
  scopeChanges: Array<{ action: string; from: string; to: string }>;
  policyChanges: Array<Record<string, unknown>>;
  scopeDescriptions?: {
    current: Array<Record<string, unknown>>;
    proposed: Array<Record<string, unknown>>;
  };
  requiresConfirmation: boolean;
}

export interface ReportingRelationship {
  userId: string;
  currentManagerId: string | null;
  proposedManagerId: string | null;
  changed: boolean;
}

export interface ReportingPreview {
  preview: true;
  employee: OrganizationEmployee;
  currentManager: OrganizationEmployee | null;
  proposedManager: OrganizationEmployee | null;
  affectedUsers: ReportingRelationship[];
  affectedCount: number;
  requiresConfirmation: true;
}

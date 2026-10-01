import type { Resource } from '@tapcrm/authz';

export const TERRITORY_DIMENSIONS = ['geography', 'industry', 'product', 'lead_source'] as const;
export type TerritoryDimension = (typeof TERRITORY_DIMENSIONS)[number];
export type TerritoryStatus = 'active' | 'inactive';

export interface TerritoryRule {
  id: string;
  dimension: TerritoryDimension;
  value: string;
}

export interface Territory {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  salesTeamId: string;
  salesTeamName: string;
  departmentId: string;
  status: TerritoryStatus;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
  rules: TerritoryRule[];
}

export type TerritoryResource = Resource & {
  type: 'territory';
  organizationId: string;
  salesTeamId: string;
  departmentId: string;
};

export interface TerritoryReportingMetric {
  territoryId: string;
  territoryName: string;
  salesTeamId: string;
  salesTeamName: string;
  leadCount: null;
  conversionCount: null;
  conversionRate: null;
  revenue: null;
}

export interface SourceReportingMetric {
  source: string;
  leadCount: null;
  conversionCount: null;
  conversionRate: null;
  revenue: null;
}

export interface TerritoryReporting {
  filters: { territoryId: string | null; salesTeamId: string | null; salesPoolId: string | null; source: string | null; from: string | null; to: string | null };
  territories: TerritoryReportingMetric[];
  sources: SourceReportingMetric[];
}

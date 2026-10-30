export type FinanceConfigurationStatus = 'draft' | 'pending_review' | 'active' | 'inactive';
export type FinancePolicyStatus = 'pending_review' | 'configured';

export interface FinanceFoundation {
  readonly organizationId: string;
  readonly legalEntityId: string;
  readonly legalName: string;
  readonly countryCode: string;
  readonly functionalCurrency: string;
  readonly supportedCurrencies: readonly string[];
  readonly timezone: string;
  readonly fiscalYearStartMonth: number;
  readonly status: FinanceConfigurationStatus;
  readonly taxPolicyStatus: FinancePolicyStatus;
  readonly statutorySourceStatus: FinancePolicyStatus;
  readonly revenuePolicyStatus: FinancePolicyStatus;
  readonly paymentProviderStatus: FinancePolicyStatus;
  readonly version: number;
  readonly updatedBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

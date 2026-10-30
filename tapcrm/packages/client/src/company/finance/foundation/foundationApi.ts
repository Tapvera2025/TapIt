import { identityRequest } from '../../../identity/api/authApi.js';

export interface FinanceFoundation {
  organizationId: string;
  legalEntityId: string;
  legalName: string;
  countryCode: string;
  functionalCurrency: string;
  supportedCurrencies: string[];
  timezone: string;
  fiscalYearStartMonth: number;
  status: 'draft' | 'pending_review' | 'active' | 'inactive';
  taxPolicyStatus: 'pending_review' | 'configured';
  statutorySourceStatus: 'pending_review' | 'configured';
  revenuePolicyStatus: 'pending_review' | 'configured';
  paymentProviderStatus: 'pending_review' | 'configured';
  version: number;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export function getFinanceFoundation(): Promise<FinanceFoundation> {
  return identityRequest('/api/finance/foundation');
}

export function updateFinanceFoundation(input: {
  legalName: string;
  countryCode: string;
  functionalCurrency: string;
  supportedCurrencies: string[];
  timezone: string;
  fiscalYearStartMonth: number;
  status: FinanceFoundation['status'];
  taxPolicyStatus: FinanceFoundation['taxPolicyStatus'];
  statutorySourceStatus: FinanceFoundation['statutorySourceStatus'];
  revenuePolicyStatus: FinanceFoundation['revenuePolicyStatus'];
  paymentProviderStatus: FinanceFoundation['paymentProviderStatus'];
  expectedVersion: number;
  reason: string;
}): Promise<FinanceFoundation> {
  return identityRequest('/api/finance/foundation', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

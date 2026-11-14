import { identityRequest } from '../../../identity/api/authApi.js';

export interface ReconciliationSettings {
  id: string;
  organizationId: string;
  bankMode: 'manual_csv' | 'api';
  bankProvider: string | null;
  bankAccountName: string | null;
  bankCurrency: string;
  bankLedgerAccountId: string | null;
  csvDateColumn: string;
  csvReferenceColumn: string;
  csvDescriptionColumn: string;
  csvDebitColumn: string;
  csvCreditColumn: string;
}

export const getReconciliationSettings = () =>
  identityRequest<ReconciliationSettings>('/api/finance/reconciliation-settings');

export const updateReconciliationSettings = (input: Omit<ReconciliationSettings, 'id' | 'organizationId'> & { reason: string }) =>
  identityRequest<ReconciliationSettings>('/api/finance/reconciliation-settings', {
    method: 'PUT',
    body: JSON.stringify(input),
  });

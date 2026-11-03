import { identityRequest } from '../../../identity/api/authApi.js';

export type PaymentGateway = {
  id: string;
  provider: string;
  environment: 'production' | 'sandbox';
  publicKey: string | null;
  supportedCurrencies: string[];
  isActive: boolean;
  createdAt: string;
};

export function getPaymentGateways(): Promise<PaymentGateway[]> {
  return identityRequest('/api/finance/payment-gateways');
}
export function connectPaymentGateway(input: unknown): Promise<PaymentGateway> {
  return identityRequest('/api/finance/payment-gateways', { method: 'POST', body: JSON.stringify(input) });
}
export function disconnectPaymentGateway(id: string, reason: string): Promise<null> {
  return identityRequest(`/api/finance/payment-gateways/${id}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
}

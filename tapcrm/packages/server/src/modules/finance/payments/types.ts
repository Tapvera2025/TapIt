import { HYPERSWITCH_PROVIDERS, type HyperswitchProviderId } from '@tapcrm/contracts';
export { HYPERSWITCH_PROVIDERS } from '@tapcrm/contracts';
export const PAYMENT_PROVIDERS = HYPERSWITCH_PROVIDERS.map((provider) => provider.id);
export type PaymentProvider = HyperswitchProviderId;
export type PaymentEnvironment = 'production' | 'sandbox';

export interface PaymentGatewayConfig {
  readonly id: string;
  readonly organizationId: string;
  readonly provider: PaymentProvider;
  readonly environment: PaymentEnvironment;
  readonly publicKey: string | null;
  readonly hyperswitchConnectorId: string | null;
  readonly supportedCurrencies: readonly string[];
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

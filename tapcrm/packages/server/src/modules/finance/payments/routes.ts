import { route } from '../../../platform/http/route.js';
import { createLinkSchema, providerConfigSchema } from './validators.js';
import { disconnectProvider, generateLink, getConfigs, saveProvider } from './service.js';

export function registerPaymentRoutes(): void {
  route({ method: 'GET', path: '/api/finance/payment-gateways', action: 'finance:manage-payment-gateways', module: 'accounting', handler: async ({ ctx }) => getConfigs(ctx) });
  route({ method: 'POST', path: '/api/finance/payment-gateways', action: 'finance:manage-payment-gateways', module: 'accounting', handler: async ({ ctx, body }) => saveProvider(ctx, providerConfigSchema.parse(body)) });
  route({ method: 'DELETE', path: '/api/finance/payment-gateways/:id', action: 'finance:manage-payment-gateways', module: 'accounting', handler: async ({ ctx, params, body }) => { await disconnectProvider(ctx, params['id']!, typeof (body as { reason?: unknown })?.reason === 'string' ? (body as { reason: string }).reason : 'Provider disconnected'); return null; } });
  route({ method: 'POST', path: '/api/finance/payments/create-link', action: 'finance:manage-payment-gateways', module: 'accounting', handler: async ({ ctx, body }) => generateLink(ctx, createLinkSchema.parse(body)) });
}

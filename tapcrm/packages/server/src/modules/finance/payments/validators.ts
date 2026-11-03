import { z } from 'zod';

export const providerConfigSchema = z.object({
  provider: z.string().regex(/^[a-z0-9_-]{2,64}$/),
  environment: z.enum(['production', 'sandbox']).default('production'),
  publicKey: z.string().trim().min(1),
  secretKey: z.string().min(1),
  supportedCurrencies: z.array(z.string().regex(/^[A-Z]{3}$/)).min(1).default(['INR']),
  legalEntityId: z.string().uuid().optional(),
  reason: z.string().trim().min(3),
});
export const createLinkSchema = z.object({
  amountMinor: z.coerce.bigint().positive(), currency: z.string().regex(/^[A-Z]{3}$/),
  referenceId: z.string().uuid(), referenceType: z.enum(['deal', 'invoice', 'manual']).default('deal'), returnUrl: z.string().url(), provider: z.string().regex(/^[a-z0-9_-]{2,64}$/).optional(),
});
export type ProviderConfigInput = z.infer<typeof providerConfigSchema>;
export type CreateLinkInput = z.infer<typeof createLinkSchema>;

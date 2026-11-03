import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

export const CURRENCY_OPTIONS = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD'] as const;
export type CurrencyCode = (typeof CURRENCY_OPTIONS)[number];
export interface CurrencySettings { supportedCurrencies: CurrencyCode[]; defaultCurrency: CurrencyCode }
const DEFAULT_CURRENCIES = [...CURRENCY_OPTIONS];
const normalize = (values: readonly string[], fallback: string): CurrencySettings => {
  const supported = [...new Set(values)].filter((x): x is CurrencyCode => (CURRENCY_OPTIONS as readonly string[]).includes(x));
  const currencies = supported.length ? supported : DEFAULT_CURRENCIES;
  return { supportedCurrencies: currencies, defaultCurrency: (currencies.includes(fallback as CurrencyCode) ? fallback : currencies[0]) as CurrencyCode };
};
export async function getCurrencySettings(ctx: RequestContext): Promise<CurrencySettings> {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.maybeOne<{ supportedCurrencies: string[]; defaultCurrency: string }>(sql`SELECT supported_currencies AS "supportedCurrencies", default_currency AS "defaultCurrency" FROM organization_currency_settings WHERE organization_id=${ctx.organizationId}`);
    if (!row) {
      await tx.query(sql`INSERT INTO organization_currency_settings (organization_id) VALUES (${ctx.organizationId}) ON CONFLICT DO NOTHING`);
      return normalize(DEFAULT_CURRENCIES, 'INR');
    }
    return normalize(row.supportedCurrencies, row.defaultCurrency);
  });
}
export async function updateCurrencySettings(ctx: RequestContext, input: { supportedCurrencies: string[]; defaultCurrency: string }): Promise<CurrencySettings> {
  if (!input.supportedCurrencies.length || input.supportedCurrencies.some((x) => !(CURRENCY_OPTIONS as readonly string[]).includes(x))) throw new Error('Select at least one supported currency.');
  const settings = normalize(input.supportedCurrencies, input.defaultCurrency);
  if (!settings.supportedCurrencies.includes(input.defaultCurrency as CurrencyCode)) throw new Error('Default currency must be enabled.');
  return db.transaction(ctx, async (tx) => {
    await tx.query(sql`INSERT INTO organization_currency_settings (organization_id, supported_currencies, default_currency, updated_at) VALUES (${ctx.organizationId}, ${settings.supportedCurrencies}, ${settings.defaultCurrency}, now()) ON CONFLICT (organization_id) DO UPDATE SET supported_currencies=EXCLUDED.supported_currencies, default_currency=EXCLUDED.default_currency, updated_at=now()`);
    return settings;
  });
}

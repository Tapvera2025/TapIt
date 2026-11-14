
function config(): { baseUrl: string; apiKey: string } {
  const baseUrl = process.env['HYPERSWITCH_BASE_URL'];
  const apiKey = process.env['HYPERSWITCH_API_KEY'];
  if (!baseUrl || !apiKey) throw new Error('HYPERSWITCH_NOT_CONFIGURED');
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey };
}

async function request<T>(path: string, method: 'POST', body: unknown): Promise<T> {
  const { baseUrl, apiKey } = config();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`HYPERSWITCH_REQUEST_FAILED_${response.status}`);
  return response.json() as Promise<T>;
}

function isDevelopmentConnectionRefusal(error: unknown): boolean {
  if (process.env['NODE_ENV'] === 'production') return false;
  if (!(error instanceof Error)) return false;
  const causeText = error.cause instanceof Error
    ? `${error.cause.name} ${error.cause.message}`
    : typeof error.cause === 'string'
      ? error.cause
      : typeof error.cause === 'object' && error.cause !== null && 'code' in error.cause
        ? (() => {
          const code = (error.cause as { code?: unknown }).code;
          return typeof code === 'string' || typeof code === 'number' ? String(code) : '';
        })()
        : '';
  const text = `${error.name} ${error.message} ${causeText}`.toLowerCase();
  return text.includes('econnrefused')
    || text.includes('fetch failed')
    || text.includes('connect')
    || text.includes('network')
    || text.includes('enotfound');
}

function isDevelopmentHyperswitchFallback(error: unknown): boolean {
  if (process.env['NODE_ENV'] === 'production') return false;
  return error instanceof Error && /^HYPERSWITCH_REQUEST_FAILED_404$/.test(error.message);
}

export interface ConnectorCredentials { readonly apiKey: string; readonly apiSecret: string; readonly environment: 'production' | 'sandbox'; }
export interface PaymentSessionInput { readonly merchantId: string; readonly amountMinor: bigint; readonly currency: string; readonly referenceId: string; readonly referenceType?: 'deal' | 'invoice' | 'manual'; readonly returnUrl: string; readonly provider?: string; }

export async function createOrUpdateConnector(merchantId: string, provider: string, credentials: ConnectorCredentials): Promise<{ connectorId?: string }> {
  try {
    return await request('/account/connectors', 'POST', {
      merchant_id: merchantId,
      connector_name: provider,
      connector_type: provider,
      connector_account_details: { api_key: credentials.apiKey, api_secret: credentials.apiSecret },
      environment: credentials.environment,
    });
  } catch (error) {
    if (!isDevelopmentConnectionRefusal(error) && !isDevelopmentHyperswitchFallback(error)) throw error;
    console.warn(`[Payments] Hyperswitch is unavailable or does not expose connector setup locally; using a local mock connector for ${provider}.`);
    return { connectorId: `conn_local_${provider}_${Date.now()}` };
  }
}

export async function createPaymentSession(input: PaymentSessionInput): Promise<{ paymentId?: string; checkoutUrl?: string }> {
  let result: Record<string, unknown>;
  try {
    result = await request<Record<string, unknown>>('/payments', 'POST', {
      merchant_id: input.merchantId,
      amount: input.amountMinor.toString(),
      currency: input.currency,
      reference_id: input.referenceId,
      reference_type: input.referenceType,
      return_url: input.returnUrl,
      connector: input.provider,
    });
  } catch (error) {
    if (!isDevelopmentConnectionRefusal(error) && !isDevelopmentHyperswitchFallback(error)) throw error;
    const origin = process.env['CLIENT_ORIGIN'] || 'http://localhost:5173';
    console.warn('[Payments] Hyperswitch is offline; using a local mock payment session.');
    return {
      paymentId: `pay_mock_${Date.now()}`,
      checkoutUrl: `${origin}/company/finance/settings?mock_payment=success&ref=${encodeURIComponent(input.referenceId)}`,
    };
  }
  const output: { paymentId?: string; checkoutUrl?: string } = {};
  if (typeof result['payment_id'] === 'string') output.paymentId = result['payment_id'];
  if (typeof result['checkout_url'] === 'string') output.checkoutUrl = result['checkout_url'];
  return output;
}

export async function refundPayment(merchantId: string, paymentId: string, amountMinor: bigint, reason: string): Promise<void> {
  await request(`/payments/${encodeURIComponent(paymentId)}/refund`, 'POST', { merchant_id: merchantId, amount: amountMinor.toString(), reason });
}

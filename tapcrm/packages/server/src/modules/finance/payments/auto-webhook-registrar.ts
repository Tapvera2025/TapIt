const events = ['payment.captured', 'payment.failed', 'refund.processed'];

export async function registerProviderWebhook(provider: string, apiKey: string, apiSecret: string, webhookSecret: string): Promise<{ id?: string; autoRegistered: boolean }> {
  const url = process.env['HYPERSWITCH_WEBHOOK_URL'];
  if (!url) return { autoRegistered: false };
  try {
    if (provider === 'razorpay') {
      const response = await fetch('https://api.razorpay.com/v1/webhooks', { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`, 'content-type': 'application/json' }, body: JSON.stringify({ url, secret: webhookSecret, alert_email: process.env['PAYMENT_ALERT_EMAIL'], active: true, events }) });
      if (response.ok) { const body = await response.json() as { id?: string }; return body.id ? { id: body.id, autoRegistered: true } : { autoRegistered: true }; }
    }
    if (provider === 'stripe') {
      const response = await fetch('https://api.stripe.com/v1/webhook_endpoints', { method: 'POST', headers: { authorization: `Bearer ${apiSecret}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ url, enabled_events: ['payment_intent.succeeded', 'charge.refunded'].join(',') }).toString() });
      if (response.ok) { const body = await response.json() as { id?: string }; return body.id ? { id: body.id, autoRegistered: true } : { autoRegistered: true }; }
    }
  } catch (error) {
    console.warn(`[Payments] Auto-webhook registration skipped for ${provider}:`, error);
  }
  return { autoRegistered: false };
}

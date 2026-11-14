import type { PaymentProvider } from './types.js';

export interface PaymentAdapterInput { readonly organizationId:string; readonly provider:PaymentProvider; readonly amountMinor:bigint; readonly currency:string; readonly referenceId:string; readonly referenceType:'invoice'|'deal'|'manual'; readonly returnUrl:string; readonly idempotencyKey:string; }
export interface PaymentAdapterResult { readonly paymentId:string|null; readonly checkoutUrl:string|null; readonly status:'created'|'pending'; readonly providerReference:string|null; }
export interface NormalizedPaymentEvent { readonly eventId:string; readonly paymentId:string|null; readonly status:'pending'|'authorized'|'captured'|'failed'|'refunded'; readonly amountMinor:bigint; readonly feeMinor:bigint; readonly currency:string; readonly referenceId:string|null; readonly referenceType:'invoice'|'deal'|'manual'; readonly receivedAt:string; }
export interface PaymentAdapter { readonly providerName:'hyperswitch'; createPayment(input:PaymentAdapterInput):Promise<PaymentAdapterResult>; normalizeEvent(raw:Record<string,unknown>):NormalizedPaymentEvent; }

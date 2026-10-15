/**
 * Sales v1.1 — WhatsApp inbound classifier (R1 plan step 1.9).
 *
 * The classifier decides what to do with each `InboundEvent`. It is
 * pure: no DB, no I/O, no clock. The service calls it per message and
 * then decides whether to invoke `ingest()`.
 *
 * The "triage until second message" promotion from the plan lives in
 * the service (requires DB state); the classifier only flags the shape
 * of the message as a greeting or richer intent.
 */

import type { InboundEvent } from './driver.js';

export type ClassifierVerdict =
  | 'status_receipt'          // delivery/read/sent/failed — never a lead
  | 'empty_message'           // media without caption, no text content
  | 'greeting_only'           // one-word hi/hello — may still create triage lead per plan
  | 'enquiry';                // substantive first-contact message → bid pool

export interface ClassifierOutput {
  readonly verdict: ClassifierVerdict;
  /** Normalized text (trimmed, lowercased) when applicable; otherwise null. */
  readonly textNormalized: string | null;
}

const GREETINGS = new Set([
  'hi', 'hello', 'hey', 'hola', 'namaste', 'yo', 'sup', 'heya', 'hii', 'hiii',
]);

export function classifyInbound(event: InboundEvent): ClassifierOutput {
  if (event.type === 'status') return { verdict: 'status_receipt', textNormalized: null };
  const raw = event.text?.trim() ?? '';
  if (raw.length === 0) return { verdict: 'empty_message', textNormalized: null };
  const normalized = raw.toLowerCase();
  const singleToken = normalized.split(/\s+/).filter((t) => t.length > 0);
  if (singleToken.length <= 1 && GREETINGS.has(normalized.replace(/[!.]+$/, ''))) {
    return { verdict: 'greeting_only', textNormalized: normalized };
  }
  return { verdict: 'enquiry', textNormalized: normalized };
}

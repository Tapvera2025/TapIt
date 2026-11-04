/**
 * OCR boundary for payable documents. Providers can be added behind this
 * contract later; the default deliberately never claims certainty.
 */
export interface PayableDocumentExtraction {
  readonly status: 'needs_review';
  readonly fields: Readonly<Record<string, string | number | boolean | null>>;
  readonly warnings: readonly string[];
}

export interface PayableDocumentExtractor {
  extract(input: { readonly mimeType: string; readonly body: Buffer }): Promise<PayableDocumentExtraction>;
}

export const manualPayableDocumentExtractor: PayableDocumentExtractor = {
  async extract() {
    return {
      status: 'needs_review',
      fields: {},
      warnings: ['No OCR provider is configured. Confirm all bill fields manually.'],
    };
  },
};

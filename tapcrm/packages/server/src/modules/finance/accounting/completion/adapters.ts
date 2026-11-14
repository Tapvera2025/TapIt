export interface ExternalAccountingAdapter {
  readonly provider: string;
  push(input: { sourceType: string; sourceId: string; payload: Record<string, unknown> }): Promise<{ externalId: string }>;
}

const adapters = new Map<string, ExternalAccountingAdapter>();

export function registerExternalAccountingAdapter(adapter: ExternalAccountingAdapter): void {
  adapters.set(adapter.provider, adapter);
}

export function getExternalAccountingAdapter(provider: string): ExternalAccountingAdapter | undefined {
  return adapters.get(provider);
}

export function listExternalAccountingProviders(): string[] {
  return [...adapters.keys()].sort();
}

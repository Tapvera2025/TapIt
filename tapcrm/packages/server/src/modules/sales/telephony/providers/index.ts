import type { CallWindow, NormalizedAgent, NormalizedCall, ProviderCredentials, TelephonyProvider } from '../types.js';
import { AircallClient } from './aircall.js';
import type { RequestBudget } from './http.js';
import { JustCallClient } from './justcall.js';

/**
 * One calling platform, behind the same four operations. The sync, the
 * connect flow and recording playback only ever talk to this interface, so a
 * third platform is one more adapter.
 */
export type CallPageHandler = (calls: readonly NormalizedCall[], rawCount: number) => Promise<void>;

export interface TelephonyClient {
  readonly provider: TelephonyProvider;
  /** Proves the credentials work. Throws ProviderError('rejected') when they do not. */
  verify(): Promise<{ accountLabel: string | null }>;
  listAgents(): Promise<NormalizedAgent[]>;
  /** Calls started inside the window, oldest first, one page at a time. */
  listCalls(window: CallWindow, onPage: CallPageHandler): Promise<void>;
  /** The audio of a call's recording or voicemail, as a streaming response. */
  fetchRecording(callExternalId: string): Promise<Response>;
}

export interface ClientOverrides {
  readonly budget?: RequestBudget;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

export type ClientFactory = (credentials: ProviderCredentials, overrides?: ClientOverrides) => TelephonyClient;

const defaultFactory: ClientFactory = (credentials, overrides = {}) => {
  const options = {
    ...(overrides.budget ? { budget: overrides.budget } : {}),
    ...(overrides.fetchImpl ? { fetchImpl: overrides.fetchImpl } : {}),
    ...(overrides.sleep ? { sleep: overrides.sleep } : {}),
  };
  return credentials.provider === 'justcall'
    ? new JustCallClient(credentials, options)
    : new AircallClient(credentials, options);
};

let factory: ClientFactory = defaultFactory;

export function createTelephonyClient(credentials: ProviderCredentials, overrides?: ClientOverrides): TelephonyClient {
  return factory(credentials, overrides);
}

/** Test-only: swap the platform adapters for fakes. */
export function __setTelephonyClientFactory(next: ClientFactory | null): void {
  factory = next ?? defaultFactory;
}

export { JUSTCALL_HISTORY_DAYS } from './justcall.js';
export { createBudget, PROVIDER_LABEL, type RequestBudget } from './http.js';

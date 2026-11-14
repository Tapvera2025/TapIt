import { identityRequest } from '../../../identity/api/authApi.js';

export interface CommandCentre { baseCurrency: string; reconciledCash: string; receivablesOutstanding: string; approvedPayables: string; unreconciledBankLines: number; approvedBudget: string; contractedCash: string; issuedCash: string; collectedCash: string; actualCost: string; advisory: boolean; }
export interface Snapshot { id: string; asOfDate: string; horizonWeeks: number; baseCurrency: string; minimumCash: string; sourceHash: string; createdAt: string; }
export interface ForecastRow { id: string; snapshotId: string; bucketNumber: number; bucketStart: string; bucketEnd: string; openingCash: string; contractedCash: string; issuedCash: string; expectedCollections: string; payableOutflows: string; recurringOutflows: string; closingCash: string; minimumCash: string; varianceToMinimum: string; evidence: Record<string, unknown>; }
export interface Scenario { id: string; name: string; baseSnapshotId: string; baseCurrency: string; assumptions: Record<string, unknown>; status: string; createdAt: string; }
export interface ScenarioForecast extends ForecastRow { scenarioInflowDelta: string; scenarioOutflowDelta: string; scenarioClosingCash: string; scenarioVarianceToMinimum: string; note: string | null; }

export const getCommandCentre = (currency = 'INR') => identityRequest<CommandCentre>(`/api/cash-flow/command-centre?baseCurrency=${currency}`);
export const listSnapshots = () => identityRequest<Snapshot[]>('/api/cash-flow/snapshots');
export const listForecast = (id: string) => identityRequest<ForecastRow[]>(`/api/cash-flow/snapshots/${id}/forecast`);
export const createForecast = (body: Record<string, unknown>) => identityRequest<Snapshot>('/api/cash-flow/forecast', { method: 'POST', body: JSON.stringify(body) });
export const listScenarios = () => identityRequest<Scenario[]>('/api/cash-flow/scenarios');
export const listScenarioForecast = (id: string) => identityRequest<ScenarioForecast[]>(`/api/cash-flow/scenarios/${id}/forecast`);
export const createScenario = (body: Record<string, unknown>) => identityRequest('/api/cash-flow/scenarios', { method: 'POST', body: JSON.stringify(body) });

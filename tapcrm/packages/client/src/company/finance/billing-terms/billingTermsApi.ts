import { identityRequest } from '../../../identity/api/authApi.js';

export interface BillingProfile { id:string; clientId:string; legalEntityId:string; currency:string; timezone:string; paymentTermsDays:number; creditLimit:string; creditControl:string; poRequired:boolean; billingContactName:string|null; billingContactEmail:string|null; status:string; version:number; }
export interface RateCard { id:string; name:string; description:string|null; status:string; versions?: Array<{ id:string; versionNumber:number; effectiveFrom:string; effectiveTo:string|null; lines?: Array<{ serviceKey:string; pricingModel:string; roleCode:string|null; projectType:string|null; unitRate:string; currency:string }> }>; }
export interface Contract { id:string; clientId:string; legalEntityId:string; contractNumber:string; title:string; currency:string; billingModel:string; startDate:string; endDate:string|null; status:string; version:number; renewalTermMonths:number|null; autoRenew:boolean; renewalNoticeDays:number; retainerQuantity:string|null; retainerUnit:string|null; overageRate:string|null; signedStatus:string; }
export interface Schedule { id:string; contractId:string; recurrence:string; localTimezone:string; billingDay:number|null; nextBillDate:string; status:string; generationKey:string; }
export interface BillableEvent { id:string; clientId:string; contractId:string|null; sourceType:string; sourceId:string; serviceKey:string; eventDate:string; currency:string; quantity:string; amount:string; state:string; billedQuantity:string; idempotencyKey:string; }
export interface ContractDocument { id:string; contractId:string; originalFilename:string; mimeType:string; sizeBytes:number; sha256:string; createdAt:string; }
const request = <T>(path:string, init?:RequestInit) => identityRequest<T>(path, init);
export const listBillingProfiles = () => request<BillingProfile[]>('/api/billing/profiles');
export const saveBillingProfile = (body:Record<string,unknown>) => request<BillingProfile>('/api/billing/profiles', { method:'PUT', body:JSON.stringify(body) });
export const listRateCards = () => request<RateCard[]>('/api/billing/rate-cards');
export const getRateCard = (id:string) => request<RateCard>(`/api/billing/rate-cards/${id}`);
export const createRateCard = (body:Record<string,unknown>) => request<RateCard>('/api/billing/rate-cards', { method:'POST', body:JSON.stringify(body) });
export const addRateCardVersion = (id:string, body:Record<string,unknown>) => request(`/api/billing/rate-cards/${id}/versions`, { method:'POST', body:JSON.stringify(body) });
export const listContracts = () => request<Contract[]>('/api/billing/contracts');
export const createContract = (body:Record<string,unknown>) => request<Contract>('/api/billing/contracts', { method:'POST', body:JSON.stringify(body) });
export const amendContract = (id:string, body:Record<string,unknown>) => request(`/api/billing/contracts/${id}/amend`, { method:'POST', body:JSON.stringify(body) });
export const changeContractStatus = (id:string, body:Record<string,unknown>) => request(`/api/billing/contracts/${id}/status`, { method:'POST', body:JSON.stringify(body) });
export const recordContractUsage = (id:string, body:Record<string,unknown>) => request(`/api/billing/contracts/${id}/usage`, { method:'POST', body:JSON.stringify(body) });
export const listSchedules = () => request<Schedule[]>('/api/billing/schedules');
export const createSchedule = (body:Record<string,unknown>) => request<Schedule>('/api/billing/schedules', { method:'POST', body:JSON.stringify(body) });
export const listBillableEvents = () => request<BillableEvent[]>('/api/billing/billable-events');
export const createBillableEvent = (body:Record<string,unknown>) => request<BillableEvent>('/api/billing/billable-events', { method:'POST', body:JSON.stringify(body) });
export const decideBillableEvent = (id:string, body:Record<string,unknown>) => request(`/api/billing/billable-events/${id}/decision`, { method:'POST', body:JSON.stringify(body) });
export const listContractDocuments = (id:string) => request<ContractDocument[]>(`/api/billing/contracts/${id}/documents`);
export const uploadContractDocument = (id:string, body:Record<string,unknown>) => request(`/api/billing/contracts/${id}/documents`, { method:'POST', body:JSON.stringify(body) });

import { identityRequest } from '../../../identity/api/authApi.js';

export type LeadStatus = 'new' | 'assigned' | 'contacted' | 'discovery' | 'proposal_sent' | 'follow_up' | 'callback_scheduled' | 'nurture' | 'converted' | 'closed_lost';
export interface LeadSource { id: string; name: string; direction: 'inbound' | 'outbound'; status: 'active' | 'inactive'; }
export interface Campaign { id: string; name: string; status: 'active' | 'inactive'; }
export interface Handover { id: string; leadId: string; fromUserId: string; fromUserName: string | null; toUserId: string; toUserName: string | null; status: 'pending' | 'accepted' | 'declined' | 'expired'; disposition: 'accepted' | 'rejected' | 'callback' | null; reason: string | null; offeredAt: string; acceptedAt: string | null; declinedAt: string | null; expiredAt: string | null; }
export interface HandoverTarget { id: string; fullName: string; positionCode: 'sales-supervisor' | 'sales-team-lead'; teamId: string | null; availability: 'working' | 'on_break' | 'not_punched_in'; selectable: boolean; }
export interface LeadCallback { id: string; leadId: string; ownerId: string; ownerName: string | null; scheduledAt: string; reason: string | null; status: 'scheduled' | 'completed' | 'missed' | 'cancelled'; completedAt: string | null; missedAt: string | null; cancelledAt: string | null; }
export interface Lead { id: string; leadNumber: string; contactName: string; companyName: string | null; phone: string | null; email: string | null; sourceId: string; sourceName: string; campaignId: string | null; campaignName: string | null; status: LeadStatus; routingStatus: 'assigned' | 'unrouted'; ownerId: string | null; currentHolderId: string | null; ownerName: string | null; currentHolderName: string | null; salesTeamName: string | null; territoryName: string | null; lossReason: string | null; lostAt: string | null; previousLeadId: string | null; stalledAt: string | null; stalledReason: string | null; createdAt: string; updatedAt: string; activities: Array<{ id: string; eventName: string; createdAt: string }>; }
export interface ReengagementSegment { sourceName: string; campaignName: string | null; lossReason: string; lostDate: string; count: number; }
export interface ReengagementSegments { total: number; segments: ReengagementSegment[]; }
export interface LeadPage { items: Lead[]; total: number; page: number; pageSize: number; totalPages: number; }
export function getLeads(): Promise<LeadPage> { return identityRequest('/api/leads'); }
export function getStalledLeads(): Promise<LeadPage> { return identityRequest('/api/leads/stalled'); }
export function getLead(id: string): Promise<Lead> { return identityRequest(`/api/leads/${id}`); }
export function getLeadSources(): Promise<LeadSource[]> { return identityRequest('/api/lead-sources'); }
export function getCampaigns(): Promise<Campaign[]> { return identityRequest('/api/campaigns'); }
export function getReengagementSegments(): Promise<ReengagementSegments> { return identityRequest('/api/leads/re-engagement/segments'); }
export function createLead(input: { contactName: string; companyName?: string | undefined; phone?: string | undefined; email?: string | undefined; sourceId: string; campaignId?: string | undefined; previousLeadId?: string | undefined }): Promise<{ lead: Lead; duplicates: Array<{ leadId: string; leadNumber: string; ownerId: string | null; ownerName: string | null }> }> { return identityRequest('/api/leads', { method: 'POST', body: JSON.stringify(input) }); }
export function createLeadSource(input: { name: string; direction: LeadSource['direction'] }): Promise<LeadSource> { return identityRequest('/api/lead-sources', { method: 'POST', body: JSON.stringify(input) }); }
export function getHandoverTargets(leadId: string): Promise<HandoverTarget[]> { return identityRequest(`/api/handovers/targets?leadId=${encodeURIComponent(leadId)}`); }
export function getHandovers(leadId: string): Promise<Handover[]> { return identityRequest(`/api/handovers?leadId=${encodeURIComponent(leadId)}`); }
export function createHandover(input: { leadId: string; toUserId: string; reason?: string | undefined }): Promise<Handover> { return identityRequest('/api/handovers', { method: 'POST', body: JSON.stringify(input) }); }
export function acceptHandover(id: string): Promise<Handover> { return identityRequest(`/api/handovers/${id}/accept`, { method: 'POST' }); }
export function declineHandover(id: string, reason: string): Promise<Handover> { return identityRequest(`/api/handovers/${id}/decline`, { method: 'POST', body: JSON.stringify({ reason }) }); }
export function recordHandoverDisposition(id: string, disposition: 'accepted' | 'rejected' | 'callback', reason?: string, scheduledAt?: string, lossReason?: string): Promise<Handover> { return identityRequest(`/api/handovers/${id}/disposition`, { method: 'POST', body: JSON.stringify({ disposition, reason, scheduledAt, lossReason }) }); }
export function getCallbacks(leadId: string): Promise<LeadCallback[]> { return identityRequest(`/api/callbacks?leadId=${encodeURIComponent(leadId)}`); }
export function createCallback(input: { leadId: string; scheduledAt: string; reason?: string | undefined }): Promise<LeadCallback> { return identityRequest('/api/callbacks', { method: 'POST', body: JSON.stringify(input) }); }
export function updateCallback(id: string, input: { scheduledAt?: string | undefined; reason?: string | null | undefined }): Promise<LeadCallback> { return identityRequest(`/api/callbacks/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); }
export function callbackOutcome(id: string, status: 'completed' | 'missed' | 'cancelled'): Promise<LeadCallback> { return identityRequest(`/api/callbacks/${id}/outcome`, { method: 'POST', body: JSON.stringify({ status }) }); }

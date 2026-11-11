import type {
  ContentBrand,
  ContentCommentThread,
  ContentDocument,
  ContentEvent,
  ContentSnapshot,
  ContentVersion,
} from '@tapcrm/contracts';
import { identityRequest } from '../identity/api/authApi.js';
const root = (siteId: string) => `/api/seo/sites/${encodeURIComponent(siteId)}`;
const doc = (siteId: string, id: string) =>
  `${root(siteId)}/content/${encodeURIComponent(id)}`;
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });
export const listContent = (siteId: string, offset: number) =>
  identityRequest<{ items: ContentDocument[]; total: number }>(
    `${root(siteId)}/content?offset=${offset}`,
  );
export const readContent = (siteId: string, id: string) =>
  identityRequest<ContentDocument>(doc(siteId, id));
export const createContent = (
  siteId: string,
  snapshot: ContentSnapshot,
  reviewerId: string | null,
  ownerId?: string,
) =>
  identityRequest<ContentDocument>(
    `${root(siteId)}/content`,
    json('POST', { snapshot, reviewerId, ownerId }),
  );
export const saveContent = (
  siteId: string,
  id: string,
  expectedVersion: number,
  snapshot: ContentSnapshot,
  reviewerId: string | null,
) =>
  identityRequest<ContentDocument>(
    doc(siteId, id),
    json('PUT', { expectedVersion, snapshot, reviewerId }),
  );
export const saveContentBody = (siteId: string, id: string, body: string) =>
  identityRequest<ContentDocument>(`${doc(siteId, id)}/body`, json('PUT', { body }));
export const checkpointContent = (siteId: string, id: string, expectedVersion: number) =>
  identityRequest<ContentDocument>(
    `${doc(siteId, id)}/checkpoint`,
    json('POST', { expectedVersion }),
  );
export type CreateContentCommentInput = Pick<
  ContentCommentThread,
  'kind' | 'anchorFrom' | 'anchorTo' | 'quotedText' | 'body' | 'suggestedText'
>;
export const contentCommentThreads = (siteId: string, id: string) =>
  identityRequest<ContentCommentThread[]>(`${doc(siteId, id)}/comments`);
export const createContentComment = (
  siteId: string,
  id: string,
  input: CreateContentCommentInput,
) =>
  identityRequest<ContentCommentThread>(
    `${doc(siteId, id)}/comments`,
    json('POST', input),
  );
export const updateContentComment = (
  siteId: string,
  id: string,
  threadId: string,
  status: ContentCommentThread['status'],
) =>
  identityRequest<ContentCommentThread>(
    `${doc(siteId, id)}/comments/${encodeURIComponent(threadId)}`,
    json('PATCH', { status }),
  );
export const contentHistory = (siteId: string, id: string, offset: number) =>
  identityRequest<{ versions: ContentVersion[]; events: ContentEvent[] }>(
    `${doc(siteId, id)}/history?offset=${offset}`,
  );
export const restoreContent = (
  siteId: string,
  id: string,
  expectedVersion: number,
  version: number,
) =>
  identityRequest<ContentDocument>(
    `${doc(siteId, id)}/restore`,
    json('POST', { expectedVersion, version }),
  );
export const transitionContent = (
  siteId: string,
  id: string,
  expectedVersion: number,
  transition: string,
  note: string,
) =>
  identityRequest<ContentDocument>(
    `${doc(siteId, id)}/${['approve', 'request_changes'].includes(transition) ? 'review' : 'workflow'}`,
    json('POST', { expectedVersion, transition, note }),
  );
export const exportContent = (siteId: string, id: string) =>
  identityRequest<{ filename: string; text: string }>(`${doc(siteId, id)}/export`, {
    method: 'POST',
  });
export const contentMembers = (siteId: string) =>
  identityRequest<{ id: string; name: string }[]>(`${root(siteId)}/content-members`);
export const readBrand = (siteId: string, version?: number) =>
  identityRequest<ContentBrand>(
    `${root(siteId)}/content-brand${version ? `?version=${version}` : ''}`,
  );
export const saveBrand = (siteId: string, expectedVersion: number, guidance: string) =>
  identityRequest<ContentBrand>(
    `${root(siteId)}/content-brand`,
    json('PUT', { expectedVersion, guidance }),
  );

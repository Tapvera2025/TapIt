export type ContentStatus = 'draft' | 'in_review' | 'approved' | 'archived';
export interface ContentSnapshot {
  title: string;
  body: string;
  audience: string;
  purpose: string;
  keywords: string;
  outline: string;
  sources: string;
  targetUrl: string;
  metaDescription: string;
  dueDate: string;
  brandVersion: number | null;
}
export interface ContentDocument {
  id: string;
  siteId: string;
  ownerId: string;
  reviewerId: string | null;
  ownerName: string;
  reviewerName: string | null;
  status: ContentStatus;
  version: number;
  approvedVersion: number | null;
  snapshot: ContentSnapshot;
  createdAt: string;
  updatedAt: string;
}
export interface ContentVersion {
  version: number;
  snapshot: ContentSnapshot;
  authorName: string;
  createdAt: string;
  reason: string;
}
export interface ContentEvent {
  id: string;
  version: number;
  action: string;
  actorName: string;
  note: string;
  createdAt: string;
}
export interface ContentCommentThread {
  id: string;
  documentId: string;
  kind: 'comment' | 'suggestion';
  anchorFrom: string;
  anchorTo: string;
  quotedText: string;
  body: string;
  suggestedText: string | null;
  status: 'open' | 'resolved' | 'accepted' | 'rejected';
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}
export interface ContentBrand {
  version: number;
  guidance: string;
  scope: 'client' | 'website';
}
export const EMPTY_CONTENT_SNAPSHOT: ContentSnapshot = {
  title: '',
  body: '',
  audience: '',
  purpose: '',
  keywords: '',
  outline: '',
  sources: '',
  targetUrl: '',
  metaDescription: '',
  dueDate: '',
  brandVersion: null,
};

export type SeoCategory = 'seo' | 'gmb';
export type SeoPriority = 'low' | 'medium' | 'high';
export type SeoDevice = 'desktop' | 'mobile';
export type SeoTrend = 'improving' | 'declining' | 'stagnant' | 'unclassified';
export type SeoBlogCategory = 'blog-post' | 'article' | 'news' | 'tutorial' | 'case-study' | 'other';
export type SeoBlogStatus = 'draft' | 'published' | 'archived';

export interface SeoKeyword {
  id: string; projectId: string; keyword: string; initialRank: number; previousRank: number | null;
  currentRank: number | null; targetUrl: string | null; keywordLink: string | null;
  searchEngine: string; country: string; city: string | null; device: SeoDevice;
  autoFetchFrequency: string; priority: SeoPriority; category: SeoCategory; notes: string | null;
  lastCheckedAt: Date | null; createdAt: Date; updatedAt: Date; trend: SeoTrend; rankChange: number | null;
  lastAutoFetchAt: Date | null; lastAutoFetchOutcome: 'ok' | 'no-data' | 'skipped' | 'failed' | null; lastAutoFetchMessage: string | null;
}

export interface SeoBlogPost {
  id: string; projectId: string; title: string; url: string | null; description: string | null;
  category: SeoBlogCategory; status: SeoBlogStatus; publishDate: Date | null; wordCount: number;
  targetKeywords: string[]; notes: string | null; createdByName: string | null; createdAt: Date; updatedAt: Date;
}

export interface SeoOverview {
  totalKeywords: number; improving: number; declining: number; stagnant: number; unclassified: number;
  averageCurrentRank: number | null; totalBlogs: number; publishedBlogs: number; draftBlogs: number; archivedBlogs: number; lastUpdatedAt: Date | null;
}

export interface SeoReport {
  period: 7 | 30 | 90;
  overview: SeoOverview;
  keywords: { items: SeoKeyword[]; total: number; page: number; pageSize: number; totalPages: number };
  blogs: { items: SeoBlogPost[]; total: number; page: number; pageSize: number; totalPages: number };
}

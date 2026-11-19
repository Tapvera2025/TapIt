import { inflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../../../platform/dal/context.js';

/**
 * The project report goes to the company's client, so it carries the
 * company's name, never the CRM vendor's.
 */

vi.mock('../repository.js', () => ({
  findOrganizationName: vi.fn(async () => 'Acme Digital'),
  findProjectById: vi.fn(async () => ({
    id: 'p-1', name: 'Clinic website', clientName: 'Dr Rao Clinic', businessName: 'Rao Clinic',
    workStatus: 'ongoing', priority: 'medium', startDate: '2026-01-01', expectedEndDate: null,
    currency: 'INR', assignees: [], services: [], description: null,
  })),
}));
vi.mock('./repository.js', () => ({
  listKeywords: vi.fn(async () => ({ items: [], total: 0 })),
  listBlogs: vi.fn(async () => ({ items: [], total: 0 })),
  overview: vi.fn(async () => ({})),
}));
vi.mock('./off-page.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  listBacklinks: vi.fn(async () => ({ items: [], total: 0 })),
}));
vi.mock('./screenshots.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  listScreenshots: vi.fn(async () => ({ items: [], total: 0 })),
}));

const { createProjectReportPdf } = await import('./pdf.js');

describe('project report PDF branding', () => {
  it('names the issuing company and not Tapvera', async () => {
    const ctx = { organizationId: 'org-1', principal: { id: 'u' } } as unknown as RequestContext;
    const bytes = await createProjectReportPdf(ctx, 'p-1');
    const raw = bytes.toString('latin1');
    // Document properties name the company (PDFKit writes /Author as an indirect string).
    expect(raw).toMatch(/\/Author \d+ 0 R/);
    expect(raw).toContain('(Acme Digital)');
    // Page text is in compressed streams: inflate them and read the glyph hex.
    const text = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
      .map((match) => {
        try {
          return inflateSync(Buffer.from(match[1] ?? '', 'latin1')).toString('latin1');
        } catch {
          return '';
        }
      })
      .join('\n');
    const shown = [...text.matchAll(/<([0-9a-f]+)>/gi)]
      .map((match) => Buffer.from(match[1] ?? '', 'hex').toString('latin1'))
      .join('');
    expect(shown).toContain('CONFIDENTIAL');
    expect(shown.toLowerCase()).not.toContain('tapvera');
    expect(raw.toLowerCase()).not.toContain('tapvera');
  });
});

import { describe, expect, it } from 'vitest';
import {
  CALL_STATUS_LABELS,
  callStatusTone,
  importProgress,
  importStatusTone,
  looksLikeGoogleSheet,
  plural,
  previewStatusTone,
  readableBytes,
  rowStatusTone,
  sourceKindIcon,
  splitCounts,
  TEMPLATE_CSV,
} from './import-format.js';

describe('lead import formatting', () => {
  it('splits leads round-robin the way the server does', () => {
    expect(splitCounts(10, 3)).toEqual([4, 3, 3]);
    expect(splitCounts(2, 3)).toEqual([1, 1, 0]);
    expect(splitCounts(5, 0)).toEqual([]);
  });

  it('describes progress, sizes and counts', () => {
    expect(importProgress(250, 1000)).toBe(25);
    expect(importProgress(0, 0)).toBe(0);
    expect(importProgress(1200, 1000)).toBe(100);
    expect(readableBytes(512)).toBe('512 B');
    expect(readableBytes(2048)).toBe('2 KB');
    expect(readableBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(plural(1, 'lead')).toBe('1 lead');
    expect(plural(1200, 'lead')).toBe(`${(1200).toLocaleString()} leads`);
  });

  it('colours statuses with the app tones', () => {
    expect(importStatusTone('completed')).toContain('app-success');
    expect(importStatusTone('failed')).toContain('app-danger');
    expect(rowStatusTone('invalid')).toContain('app-danger');
    expect(previewStatusTone('ready')).toContain('app-success');
    expect(callStatusTone('not_called')).toContain('app-danger');
    expect(callStatusTone('connected')).toContain('app-success');
    expect(CALL_STATUS_LABELS.other).toBe('Called by someone else');
    expect(sourceKindIcon('google_sheet')).toBe('link');
  });

  it('recognizes Google Sheets links and offers a template with the usual columns', () => {
    expect(looksLikeGoogleSheet('https://docs.google.com/spreadsheets/d/abc/edit#gid=0')).toBe(true);
    expect(looksLikeGoogleSheet('https://example.com/sheet.csv')).toBe(false);
    expect(TEMPLATE_CSV.split('\n')[0]).toBe('Client Name,Business Name,Owner Name,Number,Email,City,Requirement,Assigned To,Notes');
  });
});

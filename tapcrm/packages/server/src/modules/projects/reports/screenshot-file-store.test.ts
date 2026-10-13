import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const uploadRoot = vi.hoisted(() => ({ value: '' }));
vi.mock('../../../config.js', () => ({ loadConfig: () => ({ TAPCRM_UPLOAD_DIR: uploadRoot.value }) }));

import { removeScreenshot, readScreenshot, storeScreenshot } from './screenshot-file-store.js';

describe('screenshot filesystem storage', () => {
  beforeEach(async () => { uploadRoot.value = await mkdtemp(join(tmpdir(), 'tapcrm-screenshot-')); });
  afterEach(async () => { await rm(uploadRoot.value, { recursive: true, force: true }); });

  it('creates unique generated names for duplicate original files', async () => {
    const body = Buffer.from('image bytes');
    const first = await storeScreenshot('org-1', 'project-1', 'image/png', body);
    const second = await storeScreenshot('org-1', 'project-1', 'image/png', body);

    expect(first.relativePath).not.toBe(second.relativePath);
    expect(first.relativePath).toMatch(/^screenshots\/org-1\/project-1\/[0-9a-f-]+\.png$/);
    expect(first.relativePath).not.toContain('duplicate');
    await expect(readFile(join(uploadRoot.value, first.relativePath))).resolves.toEqual(body);
  });

  it('rejects traversal paths and safely removes generated files', async () => {
    await expect(readScreenshot('../outside.png')).rejects.toThrow('Invalid screenshot path.');
    const saved = await storeScreenshot('org-1', 'project-1', 'image/jpeg', Buffer.from([1, 2, 3]));
    await removeScreenshot(saved.relativePath);
    await expect(readScreenshot(saved.relativePath)).rejects.toThrow('Screenshot file is no longer available.');
  });
});

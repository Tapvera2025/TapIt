import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { chownTree, dropRootPrivileges, lookupPasswdUser, type PrivilegeDropDeps } from './privileges.js';

function deps(overrides: Partial<PrivilegeDropDeps> = {}) {
  const calls: string[] = [];
  const env: NodeJS.ProcessEnv = { HOME: '/root' };
  const base: PrivilegeDropDeps = {
    getuid: () => 0,
    initgroups: (user) => calls.push(`initgroups:${user}`),
    setgid: (id) => calls.push(`setgid:${id}`),
    setuid: (id) => calls.push(`setuid:${id}`),
    lookupUser: (name) => (name === 'node' ? { uid: 1000, gid: 1000, homedir: '/home/node' } : null),
    chownTree: vi.fn(() => {
      calls.push('chown');
      return 3;
    }),
    env,
    log: () => undefined,
  };
  return { deps: { ...base, ...overrides }, calls, env };
}

describe('dropRootPrivileges', () => {
  it('does nothing when the API is not root', () => {
    const { deps: d, calls } = deps({ getuid: () => 1000 });
    expect(dropRootPrivileges('/app/storage', d)).toBe('not-root');
    expect(calls).toEqual([]);
  });

  it('hands the upload folder over first, then becomes the node user (groups, group, user, in that order)', () => {
    const { deps: d, calls, env } = deps();
    expect(dropRootPrivileges('/app/storage', d)).toBe('dropped');
    expect(calls).toEqual(['chown', 'initgroups:node', 'setgid:node', 'setuid:node']);
    expect(d.chownTree).toHaveBeenCalledWith('/app/storage', 1000, 1000);
    expect(env['HOME']).toBe('/home/node');
  });

  it('uses TAPCRM_RUN_AS when set', () => {
    const { deps: d, calls } = deps({ lookupUser: (name) => (name === 'tapcrm' ? { uid: 2000, gid: 2000, homedir: '/srv' } : null) });
    d.env['TAPCRM_RUN_AS'] = 'tapcrm';
    expect(dropRootPrivileges('/data', d)).toBe('dropped');
    expect(calls).toContain('setuid:tapcrm');
  });

  it('still drops privileges if the folder cannot be handed over', () => {
    const { deps: d, calls } = deps({ chownTree: () => { throw new Error('EPERM'); } });
    expect(dropRootPrivileges('/app/storage', d)).toBe('dropped');
    expect(calls).toEqual(['initgroups:node', 'setgid:node', 'setuid:node']);
  });

  it('keeps running, loudly, when the user does not exist', () => {
    const log = vi.fn();
    const { deps: d, calls } = deps({ lookupUser: () => null, log });
    expect(dropRootPrivileges('/app/storage', d)).toBe('no-such-user');
    expect(calls).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });
});

describe('helpers', () => {
  it('reads a user from a passwd file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'passwd-'));
    const file = join(dir, 'passwd');
    writeFileSync(file, 'root:x:0:0:root:/root:/bin/bash\nnode:x:1000:1000::/home/node:/bin/bash\n');
    expect(lookupPasswdUser('node', file)).toEqual({ uid: 1000, gid: 1000, homedir: '/home/node' });
    expect(lookupPasswdUser('nobody-here', file)).toBeNull();
    expect(lookupPasswdUser('node', join(dir, 'missing'))).toBeNull();
  });

  it('creates a missing folder and changes nothing that already has the right owner', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'uploads-')), 'storage');
    expect(chownTree(dir, process.getuid?.() ?? 0, process.getgid?.() ?? 0)).toBe(0);
    mkdirSync(join(dir, 'expenses', 'org'), { recursive: true });
    writeFileSync(join(dir, 'expenses', 'org', 'a.pdf'), 'x');
    expect(chownTree(dir, process.getuid?.() ?? 0, process.getgid?.() ?? 0)).toBe(0);
  });
});

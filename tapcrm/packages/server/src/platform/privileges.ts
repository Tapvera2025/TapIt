import { chownSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The API must not run as root. The server image starts as root (the upload
 * folder is a host directory root created), so at startup, while still root,
 * this hands that folder to an unprivileged user and then switches the whole
 * process to that user: before the app is built, a port is opened, or any
 * upload, resume, image or crawled page is parsed.
 *
 * Already not root (local development, a normal service account): no-op.
 */

export interface PasswdEntry {
  readonly uid: number;
  readonly gid: number;
  readonly homedir: string;
}

export interface PrivilegeDropDeps {
  readonly getuid: () => number;
  readonly setgid: (id: string) => void;
  readonly setuid: (id: string) => void;
  readonly initgroups: (user: string, group: string) => void;
  readonly lookupUser: (name: string) => PasswdEntry | null;
  readonly chownTree: (dir: string, uid: number, gid: number) => number;
  readonly env: NodeJS.ProcessEnv;
  readonly log: (line: Record<string, unknown>) => void;
}

/** Gives `dir` and everything under it to uid:gid; returns how many entries changed. */
export function chownTree(dir: string, uid: number, gid: number): number {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  let changed = 0;
  const entries = [dir, ...readdirSync(dir, { recursive: true }).map((entry) => join(dir, String(entry)))];
  for (const path of entries) {
    const stats = statSync(path, { throwIfNoEntry: false });
    if (!stats || (stats.uid === uid && stats.gid === gid)) continue;
    chownSync(path, uid, gid);
    changed += 1;
  }
  return changed;
}

/** A user from /etc/passwd, or null when there is no such user (or no passwd file). */
export function lookupPasswdUser(name: string, passwd = '/etc/passwd'): PasswdEntry | null {
  let text: string;
  try {
    text = readFileSync(passwd, 'utf8');
  } catch {
    return null;
  }
  for (const line of text.split('\n')) {
    const [user, , uid, gid, , homedir] = line.split(':');
    if (user === name && uid !== undefined && gid !== undefined) {
      return { uid: Number(uid), gid: Number(gid), homedir: homedir || `/home/${name}` };
    }
  }
  return null;
}

const processDeps = (): PrivilegeDropDeps => ({
  getuid: () => (typeof process.getuid === 'function' ? process.getuid() : -1),
  setgid: (id) => process.setgid?.(id),
  setuid: (id) => process.setuid?.(id),
  // Node has process.initgroups on POSIX; the installed @types/node omits it.
  initgroups: (user, group) =>
    (process as NodeJS.Process & { initgroups?: (user: string, extraGroup: string) => void }).initgroups?.(user, group),
  lookupUser: (name) => lookupPasswdUser(name),
  chownTree,
  env: process.env,
  log: (line) => console.log(JSON.stringify(line)),
});

/**
 * Drops root. TAPCRM_RUN_AS names the user (default `node`, which the official
 * Node image provides). If that user does not exist the API keeps running and
 * says so loudly; headless rendering refuses to start as root on its own.
 */
export function dropRootPrivileges(
  uploadDir: string,
  deps: PrivilegeDropDeps = processDeps(),
): 'not-root' | 'dropped' | 'no-such-user' {
  if (deps.getuid() !== 0) return 'not-root';
  const name = deps.env['TAPCRM_RUN_AS']?.trim() || 'node';
  const target = deps.lookupUser(name);
  if (!target) {
    deps.log({
      level: 'error',
      msg: `running as root: user "${name}" does not exist, so privileges were NOT dropped; set TAPCRM_RUN_AS to an unprivileged user`,
    });
    return 'no-such-user';
  }
  const folder = resolve(uploadDir);
  try {
    const changed = deps.chownTree(folder, target.uid, target.gid);
    if (changed > 0) {
      deps.log({ level: 'info', msg: 'upload folder handed to the API user', folder, user: name, entries: changed });
    }
  } catch (error) {
    deps.log({ level: 'warn', msg: 'could not hand the upload folder to the API user; uploads may fail', folder, user: name, error: String(error) });
  }
  deps.initgroups(name, name);
  deps.setgid(name);
  deps.setuid(name);
  deps.env['HOME'] = target.homedir;
  deps.log({ level: 'info', msg: 'running as an unprivileged user', user: name });
  return 'dropped';
}

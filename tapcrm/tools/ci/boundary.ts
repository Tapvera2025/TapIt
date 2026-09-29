import { dirname, relative, resolve, sep } from 'node:path';

/**
 * Module boundary — TECH.md §3 and MB-1/MB-5.
 *
 * A module may import `contracts`, `authz`, `platform` and its own files. From
 * another module it may import that module's `facade.ts` and nothing else.
 * `modules/index.ts` — the composition root that registers every module's
 * routes, policies and jobs — sits outside any module and is exempt.
 *
 * The check resolves each relative import against the importing file, so
 * `../identity/password/service.js` is caught as surely as
 * `../../modules/identity/password/service.js`. The earlier check matched only
 * paths that spelled out `modules/`, and missed the first form.
 */

export interface SourceFile {
  /** Absolute path of the file. */
  readonly path: string;
  readonly text: string;
}

export interface BoundaryViolation {
  /** Repository-relative path of the importing file. */
  readonly file: string;
  readonly line: number;
  /** The importing module. */
  readonly from: string;
  /** The module the import reaches into. */
  readonly to: string;
  readonly specifier: string;
}

const SPECIFIER_PATTERNS: readonly RegExp[] = [
  /\bfrom\s*['"]([^'"]+)['"]/g, // import … from '…', export … from '…'
  /\bimport\s*['"]([^'"]+)['"]/g, // import '…'
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, // import('…')
];

/**
 * Where a path sits under `server/src/modules`: the module folder and the path
 * inside it. Null for anything else, including files directly in `modules/`.
 */
export function locateInModule(
  root: string,
  absolutePath: string,
): { module: string; inside: string[] } | null {
  const parts = relative(root, absolutePath.replace(/\.(js|ts)$/, '')).split(sep);
  for (let i = 0; i + 3 < parts.length; i += 1) {
    if (parts[i] === 'server' && parts[i + 1] === 'src' && parts[i + 2] === 'modules') {
      const inside = parts.slice(i + 4);
      const module = parts[i + 3];
      return module !== undefined && inside.length > 0 ? { module, inside } : null;
    }
  }
  return null;
}

export function findBoundaryViolations(
  files: readonly SourceFile[],
  root: string,
): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  for (const file of files) {
    const own = locateInModule(root, file.path);
    if (own === null) continue; // the composition root and non-module code
    for (const pattern of SPECIFIER_PATTERNS) {
      for (const match of file.text.matchAll(pattern)) {
        const specifier = match[1] ?? '';
        if (!specifier.startsWith('.')) continue;
        const target = locateInModule(root, resolve(dirname(file.path), specifier));
        if (target === null || target.module === own.module) continue;
        const isFacade = target.inside.length === 1 && target.inside[0] === 'facade';
        if (isFacade) continue;
        violations.push({
          file: relative(root, file.path),
          line: file.text.slice(0, match.index).split('\n').length,
          from: own.module,
          to: target.module,
          specifier,
        });
      }
    }
  }
  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

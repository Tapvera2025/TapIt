import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Only index.css (via Tailwind's import) and ui/theme.css may declare cascade layers.
 *
 * A layer's priority is decided by which stylesheet mentions it FIRST in the final
 * bundle. A component stylesheet that opens `@layer components { ... }` can be bundled
 * ahead of Tailwind's `@layer theme, base, components, utilities`, which then makes
 * `components` the LOWEST layer, below `base`, and the `* { padding: 0 }` reset beats
 * every `.ui-*` class: dialogs lose their padding, tab strips collapse, and so on.
 * That is exactly what happened across the whole app once.
 */
const SRC = join(__dirname);
const ALLOWED = new Set(['index.css', join('ui', 'theme.css')]);

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : cssFiles(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

describe('cascade layers', () => {
  it('are declared only by the stylesheets that own the layer order', () => {
    const offenders = cssFiles(SRC)
      .filter((file) => !ALLOWED.has(relative(SRC, file)))
      .filter((file) => /@layer\b/.test(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')))
      .map((file) => relative(SRC, file));
    expect(offenders, `These files declare @layer and can reorder the cascade: ${offenders.join(', ')}`).toEqual([]);
  });
});

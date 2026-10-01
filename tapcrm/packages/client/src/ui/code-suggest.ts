function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Suggests the next code in a sequential series.
 *
 * Splits `seed` (or the last entry of `existingCodes`) into a text prefix and
 * a trailing number, scans `existingCodes` for the highest number sharing that
 * prefix, and returns prefix + (max + 1).  Zero-padding is preserved.
 *
 * Examples
 *   suggestNextCode(['P1', 'P2'])          → 'P3'
 *   suggestNextCode(['P1'], 'POSI1')       → 'POSI2'
 *   suggestNextCode(['D-001', 'D-002'])    → 'D-003'
 *   suggestNextCode([], 'ABC')             → 'ABC1'  (no trailing digit → append 1)
 *   suggestNextCode([])                    → ''      (nothing to go on)
 */
export function suggestNextCode(existingCodes: string[], seed?: string): string {
  const reference = seed ?? existingCodes.at(-1);
  if (!reference) return '';

  const m = reference.match(/^(.*?)(\d+)$/);
  const prefix = m ? m[1]! : reference;
  const numStr = m ? m[2]! : '';
  const hasLeadingZero = numStr.length > 1 && numStr.startsWith('0');
  const width = numStr.length;

  const re = new RegExp(`^${escapeRegex(prefix)}(\\d+)$`, 'i');
  let max = numStr ? parseInt(numStr, 10) : 0;
  for (const code of existingCodes) {
    const cm = code.match(re);
    if (cm) {
      const n = parseInt(cm[1]!, 10);
      if (n > max) max = n;
    }
  }

  const nextNum = max + 1;
  const numPart = hasLeadingZero
    ? String(nextNum).padStart(width, '0')
    : String(nextNum);
  return prefix + numPart;
}

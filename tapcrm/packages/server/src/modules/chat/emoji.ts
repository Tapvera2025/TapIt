/**
 * "Is this exactly one emoji?" — the reaction validator (0138).
 *
 * `\p{RGI_Emoji}` is the Unicode property of strings for every
 * Recommended-for-General-Interchange emoji: single code points, skin-tone
 * modifiers, ZWJ families/professions, keycaps and flags. It needs the regex
 * `v` flag, built with the constructor because the compile target predates it.
 */
const RGI_EMOJI = new RegExp('^\\p{RGI_Emoji}$', 'v');
const VARIATION_SELECTOR = '\uFE0F';
const MAX_LENGTH = 32;

/**
 * The RGI (fully-qualified) form of what a picker sent. Some pickers add
 * U+FE0F everywhere ("👍" + FE0F), others drop it ("❤" without it): try the
 * value, then the bare sequence, then the selector after the first code point.
 */
export function normalizeEmoji(value: string): string {
  const trimmed = value.trim();
  if (RGI_EMOJI.test(trimmed)) return trimmed;
  const bare = trimmed.split(VARIATION_SELECTOR).join('');
  if (bare && RGI_EMOJI.test(bare)) return bare;
  const first = bare ? String.fromCodePoint(bare.codePointAt(0)!) : '';
  const qualified = `${first}${VARIATION_SELECTOR}${bare.slice(first.length)}`;
  return first && RGI_EMOJI.test(qualified) ? qualified : trimmed;
}

export function isSingleEmoji(value: string): boolean {
  return value.length > 0 && value.length <= MAX_LENGTH && RGI_EMOJI.test(value);
}

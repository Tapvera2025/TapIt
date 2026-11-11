/**
 * Chat message formatting — a small, safe Markdown dialect.
 *
 *   *bold*  **bold**   _italic_   ~strike~  ~~strike~~   `inline code`
 *   ```lang            > quote        - bullet / * bullet / • bullet
 *   code block         1. numbered
 *   ```                [label](https://…) and bare https:// links
 *
 * The parser produces a tree of plain objects that MessageMarkdown renders
 * as React elements — never HTML strings — so message text cannot inject
 * markup. Emphasis follows the WhatsApp/Slack rule: a marker opens only at
 * a word boundary and closes before one, so snake_case_names, 2*3*4 and
 * URLs with underscores are left alone.
 */

export type Inline =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'bold' | 'italic' | 'strike'; readonly children: readonly Inline[] }
  | { readonly type: 'code'; readonly text: string }
  | { readonly type: 'link'; readonly href: string; readonly children: readonly Inline[] }
  | { readonly type: 'mention'; readonly text: string; readonly userId: string };

export type Block =
  | { readonly type: 'paragraph'; readonly lines: readonly (readonly Inline[])[] }
  | { readonly type: 'code'; readonly language: string | null; readonly text: string }
  | { readonly type: 'quote'; readonly lines: readonly (readonly Inline[])[] }
  | { readonly type: 'list'; readonly ordered: boolean; readonly start: number; readonly items: readonly (readonly Inline[])[] }
  | { readonly type: 'spacer' };

export interface MentionRef {
  readonly userId: string;
  readonly fullName: string;
}

/* ------------------------------------------------------------------ *
 * Inline
 * ------------------------------------------------------------------ */

const WORD = /[\p{L}\p{N}]/u;
const SPACE = /\s/u;

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && WORD.test(char);
}

const MARKERS: readonly { readonly token: string; readonly type: 'bold' | 'italic' | 'strike' }[] = [
  { token: '**', type: 'bold' },
  { token: '~~', type: 'strike' },
  { token: '*', type: 'bold' },
  { token: '_', type: 'italic' },
  { token: '~', type: 'strike' },
];

function canOpen(text: string, index: number, token: string): boolean {
  const before = index === 0 ? undefined : text[index - 1];
  const after = text[index + token.length];
  if (after === undefined || SPACE.test(after)) return false;
  if (before !== undefined && (isWordChar(before) || before === token[0])) return false;
  return true;
}

function canClose(text: string, index: number, token: string, openEnd: number): boolean {
  if (index <= openEnd) return false;
  const before = text[index - 1];
  const after = text[index + token.length];
  if (before === undefined || SPACE.test(before)) return false;
  if (after !== undefined && (isWordChar(after) || after === token[0])) return false;
  return true;
}

/** Emphasis over plain text (code, links and mentions were split out first). */
function parseEmphasis(text: string, depth = 0): Inline[] {
  if (!text) return [];
  if (depth > 4) return [{ type: 'text', text }];
  for (let i = 0; i < text.length; i += 1) {
    for (const { token, type } of MARKERS) {
      if (!text.startsWith(token, i) || !canOpen(text, i, token)) continue;
      const openEnd = i + token.length;
      let close = text.indexOf(token, openEnd);
      while (close !== -1 && !canClose(text, close, token, openEnd)) close = text.indexOf(token, close + 1);
      if (close === -1) continue;
      const inner = text.slice(openEnd, close);
      if (inner.includes('\n')) continue;
      const result: Inline[] = [];
      if (i > 0) result.push({ type: 'text', text: text.slice(0, i) });
      result.push({ type, children: parseEmphasis(inner, depth + 1) });
      result.push(...parseEmphasis(text.slice(close + token.length), depth));
      return result;
    }
  }
  return [{ type: 'text', text }];
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/giu;
const MD_LINK = /\[([^\]\n]{1,200})\]\((https?:\/\/[^)\s]+)\)/giu;

function trimUrl(url: string): string {
  let result = url;
  for (;;) {
    const last = result.at(-1);
    if (last === undefined) return result;
    if ('.,;:!?*_~\''.includes(last)) {
      result = result.slice(0, -1);
      continue;
    }
    if (last === ')' && [...result].filter((c) => c === ')').length > [...result].filter((c) => c === '(').length) {
      result = result.slice(0, -1);
      continue;
    }
    return result;
  }
}

function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

interface Span {
  readonly start: number;
  readonly end: number;
  readonly node: Inline;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Links and recorded mentions, found in a run of text that contains no code. */
function findSpans(text: string, mentions: readonly MentionRef[]): Span[] {
  const spans: Span[] = [];
  const overlaps = (start: number, end: number) => spans.some((span) => start < span.end && end > span.start);
  for (const match of text.matchAll(MD_LINK)) {
    const href = safeHref(match[2]!);
    if (!href || match.index === undefined) continue;
    spans.push({ start: match.index, end: match.index + match[0].length, node: { type: 'link', href, children: parseEmphasis(match[1]!) } });
  }
  for (const match of text.matchAll(URL_PATTERN)) {
    if (match.index === undefined) continue;
    const url = trimUrl(match[0]);
    const href = safeHref(url);
    if (!href || overlaps(match.index, match.index + url.length)) continue;
    spans.push({ start: match.index, end: match.index + url.length, node: { type: 'link', href, children: [{ type: 'text', text: url }] } });
  }
  if (mentions.length > 0) {
    const names = [...new Map(mentions.map((m) => [m.fullName, m])).values()].sort((a, b) => b.fullName.length - a.fullName.length);
    const pattern = new RegExp(`@(${names.map((m) => escapeRegExp(m.fullName)).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined || overlaps(match.index, match.index + match[0].length)) continue;
      const ref = names.find((m) => m.fullName === match[1]);
      if (ref) spans.push({ start: match.index, end: match.index + match[0].length, node: { type: 'mention', text: match[0], userId: ref.userId } });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

export function parseInline(text: string, mentions: readonly MentionRef[] = []): Inline[] {
  const result: Inline[] = [];
  // Inline code first: nothing inside backticks is formatting, a link or a mention.
  const parts = text.split(/(`[^`\n]+`)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      result.push({ type: 'code', text: part.slice(1, -1) });
      continue;
    }
    let cursor = 0;
    for (const span of findSpans(part, mentions)) {
      if (span.start < cursor) continue;
      result.push(...parseEmphasis(part.slice(cursor, span.start)));
      result.push(span.node);
      cursor = span.end;
    }
    result.push(...parseEmphasis(part.slice(cursor)));
  }
  return mergeText(result);
}

function mergeText(nodes: Inline[]): Inline[] {
  const merged: Inline[] = [];
  for (const node of nodes) {
    const last = merged.at(-1);
    if (node.type === 'text' && last?.type === 'text') merged[merged.length - 1] = { type: 'text', text: last.text + node.text };
    else if (node.type !== 'text' || node.text) merged.push(node);
  }
  return merged;
}

/* ------------------------------------------------------------------ *
 * Blocks
 * ------------------------------------------------------------------ */

const FENCE = /^\s*```(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,4})[.)]\s+(.*)$/;

export function parseMarkdown(text: string, mentions: readonly MentionRef[] = []): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: Inline[][] = [];
  const flush = (): void => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', lines: paragraph });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;

    const fence = FENCE.exec(line);
    if (fence) {
      const rest = fence[1] ?? '';
      // ```single line``` on one line.
      const inlineClose = rest.indexOf('```');
      if (inlineClose !== -1) {
        flush();
        blocks.push({ type: 'code', language: null, text: rest.slice(0, inlineClose) });
        continue;
      }
      const closing = lines.findIndex((candidate, index) => index > i && candidate.includes('```'));
      if (closing !== -1) {
        flush();
        const language = /^[\w+#.-]{1,24}$/.test(rest.trim()) ? rest.trim() : null;
        const body = lines.slice(i + 1, closing);
        const closingLine = lines[closing]!;
        const beforeFence = closingLine.slice(0, closingLine.indexOf('```'));
        if (beforeFence.trim()) body.push(beforeFence);
        // A first line that is not a language name is content (```const x = 1).
        if (!language && rest.trim()) body.unshift(rest);
        blocks.push({ type: 'code', language, text: body.join('\n') });
        i = closing;
        continue;
      }
    }

    if (QUOTE.test(line)) {
      flush();
      const quoted: Inline[][] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) {
        quoted.push(parseInline(QUOTE.exec(lines[i]!)?.[1] ?? '', mentions));
        i += 1;
      }
      i -= 1;
      blocks.push({ type: 'quote', lines: quoted });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = numbered !== null && bullet === null;
      const pattern = ordered ? NUMBERED : BULLET;
      const items: Inline[][] = [];
      const start = ordered ? Number(numbered?.[1] ?? 1) : 1;
      while (i < lines.length) {
        const match = pattern.exec(lines[i]!);
        if (!match) break;
        items.push(parseInline((ordered ? match[2] : match[1]) ?? '', mentions));
        i += 1;
      }
      i -= 1;
      blocks.push({ type: 'list', ordered, start, items });
      continue;
    }

    if (line.trim() === '') {
      flush();
      if (blocks.length > 0 && blocks.at(-1)?.type !== 'spacer') blocks.push({ type: 'spacer' });
      continue;
    }
    paragraph.push(parseInline(line, mentions));
  }
  flush();
  while (blocks.at(-1)?.type === 'spacer') blocks.pop();
  return blocks;
}

/** True when the text is one plain paragraph — rendered inline, exactly as before formatting existed. */
export function isSimple(blocks: readonly Block[]): boolean {
  return blocks.length === 1 && blocks[0]!.type === 'paragraph';
}

/* ------------------------------------------------------------------ *
 * Plain text (conversation list, reply previews, search snippets)
 * ------------------------------------------------------------------ */

function inlineText(nodes: readonly Inline[]): string {
  return nodes.map((node) => {
    switch (node.type) {
      case 'text':
      case 'code':
      case 'mention':
        return node.text;
      case 'link':
        return inlineText(node.children);
      default:
        return inlineText(node.children);
    }
  }).join('');
}

export function toPlainText(text: string): string {
  return parseMarkdown(text).map((block) => {
    switch (block.type) {
      case 'paragraph':
      case 'quote':
        return block.lines.map(inlineText).join(' ');
      case 'code':
        return block.text;
      case 'list':
        return block.items.map((item) => `• ${inlineText(item)}`).join(' ');
      default:
        return '';
    }
  }).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ *
 * Composer helpers
 * ------------------------------------------------------------------ */

export type FormatAction = 'bold' | 'italic' | 'strike' | 'code' | 'codeblock' | 'bullet' | 'numbered' | 'quote';

/**
 * Applies a toolbar action to the composer text: wraps the selection in
 * markers (or inserts an empty pair with the caret inside), or prefixes the
 * selected lines. Returns the new text and selection.
 */
export function applyFormat(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  action: FormatAction,
): { text: string; selectionStart: number; selectionEnd: number } {
  const selected = text.slice(selectionStart, selectionEnd);
  const wrap = (marker: string) => {
    // Toggle off when the selection is already wrapped in this marker.
    const before = text.slice(selectionStart - marker.length, selectionStart);
    const after = text.slice(selectionEnd, selectionEnd + marker.length);
    if (selected && before === marker && after === marker) {
      return {
        text: text.slice(0, selectionStart - marker.length) + selected + text.slice(selectionEnd + marker.length),
        selectionStart: selectionStart - marker.length,
        selectionEnd: selectionEnd - marker.length,
      };
    }
    return {
      text: text.slice(0, selectionStart) + marker + selected + marker + text.slice(selectionEnd),
      selectionStart: selectionStart + marker.length,
      selectionEnd: selectionEnd + marker.length,
    };
  };
  switch (action) {
    case 'bold':
      return wrap('*');
    case 'italic':
      return wrap('_');
    case 'strike':
      return wrap('~');
    case 'code':
      return wrap('`');
    case 'codeblock': {
      const needsLeadingBreak = selectionStart > 0 && text[selectionStart - 1] !== '\n';
      const prefix = `${needsLeadingBreak ? '\n' : ''}\`\`\`\n`;
      const suffix = '\n```';
      return {
        text: text.slice(0, selectionStart) + prefix + selected + suffix + text.slice(selectionEnd),
        selectionStart: selectionStart + prefix.length,
        selectionEnd: selectionStart + prefix.length + selected.length,
      };
    }
    default: {
      const lineStart = text.lastIndexOf('\n', selectionStart - 1) + 1;
      const block = text.slice(lineStart, selectionEnd);
      const lines = block.split('\n');
      const prefixed = lines.map((line, index) =>
        action === 'bullet' ? `- ${line}` : action === 'numbered' ? `${index + 1}. ${line}` : `> ${line}`,
      ).join('\n');
      return {
        text: text.slice(0, lineStart) + prefixed + text.slice(selectionEnd),
        selectionStart: lineStart + prefixed.length,
        selectionEnd: lineStart + prefixed.length,
      };
    }
  }
}

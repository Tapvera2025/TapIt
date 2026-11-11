export interface TiptapJsonNode {
  type: string;
  text?: string;
  content?: TiptapJsonNode[];
  [key: string]: unknown;
}

/** Convert Phase 1 plain drafts and Phase 2 Tiptap JSON into a safe text view. */
export function contentBodyToPlainText(body: string): string {
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== 'object' || !('type' in value)) return body;
    const read = (node: unknown): string => {
      if (!node || typeof node !== 'object') return '';
      const item = node as TiptapJsonNode;
      if (item.type === 'text') return typeof item.text === 'string' ? item.text : '';
      if (item.type === 'hardBreak') return '\n';
      const children = Array.isArray(item.content) ? item.content.map(read).join('') : '';
      return ['paragraph', 'heading', 'listItem', 'blockquote', 'tableRow'].includes(
        item.type,
      )
        ? `${children}\n`
        : children;
    };
    return read(value)
      .replace(/[\t ]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch {
    return body;
  }
}

/** Convert legacy plain text to the schema used by the collaborative editor. */
export function plainTextToContentJson(body: string): TiptapJsonNode {
  try {
    const value: unknown = JSON.parse(body);
    if (
      value &&
      typeof value === 'object' &&
      'type' in value &&
      (value as { type?: unknown }).type === 'doc'
    ) {
      return value as TiptapJsonNode;
    }
  } catch {
    // Phase 1 stored plain text; treat it as paragraphs during one-time import.
  }
  const paragraphs = body.split(/\n{2,}/).map((part) => ({
    type: 'paragraph',
    ...(part.length ? { content: [{ type: 'text', text: part }] } : {}),
  }));
  return {
    type: 'doc',
    content: paragraphs.length ? paragraphs : [{ type: 'paragraph' }],
  };
}

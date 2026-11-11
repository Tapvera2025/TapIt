/**
 * Message text without its formatting markers — for notification bodies and
 * other places that show a message as plain text (a push notification must
 * not read "**Invoice** is _ready_").
 *
 * The thread itself renders the markdown on the client; this only has to be
 * readable, not a full parser: fenced/inline code keep their content, the
 * emphasis markers (*bold*, **bold**, _italic_, ~strike~) are dropped where
 * they wrap text, quotes lose their ">" and [label](url) becomes "label".
 */
export function toPlainText(body: string): string {
  return body
    .replace(/```[^\n`]*\n?([\s\S]*?)```/g, (_match, code: string) => code.trimEnd())
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1')
    .replace(/(^|[^\p{L}\p{N}*])\*\*(?=\S)([^*\n]*?\S)\*\*(?![\p{L}\p{N}])/gu, '$1$2')
    .replace(/(^|[^\p{L}\p{N}*])\*(?=\S)([^*\n]*?\S)\*(?![\p{L}\p{N}*])/gu, '$1$2')
    .replace(/(^|[^\p{L}\p{N}_])_(?=\S)([^_\n]*?\S)_(?![\p{L}\p{N}_])/gu, '$1$2')
    .replace(/(^|[^\p{L}\p{N}~])~~?(?=\S)([^~\n]*?\S)~~?(?![\p{L}\p{N}~])/gu, '$1$2')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*[-*•][ \t]+/gm, '• ')
    .trim();
}

/** One line, clipped — for list previews and notification bodies. */
export function previewText(body: string, max: number): string {
  const text = toPlainText(body).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

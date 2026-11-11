import { useMemo, useState, type ReactNode } from 'react';
import { Icon } from '../ui/index.js';
import { isSimple, parseMarkdown, type Block, type Inline, type MentionRef } from './markdown.js';

function renderInline(nodes: readonly Inline[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case 'text':
        return <span key={key}>{node.text}</span>;
      case 'bold':
        return <strong key={key} className="font-semibold">{renderInline(node.children, key)}</strong>;
      case 'italic':
        return <em key={key}>{renderInline(node.children, key)}</em>;
      case 'strike':
        return <s key={key} className="opacity-80">{renderInline(node.children, key)}</s>;
      case 'code':
        return (
          <code key={key} className="rounded bg-app-background/70 px-1 py-px font-mono text-[0.85em] text-app-foreground ring-1 ring-inset ring-app-border/70">
            {node.text}
          </code>
        );
      case 'link':
        return (
          <a
            key={key}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="break-all font-medium text-app-accent underline decoration-app-accent/40 underline-offset-2 hover:decoration-app-accent"
            onClick={(event) => event.stopPropagation()}
          >
            {renderInline(node.children, key)}
          </a>
        );
      case 'mention':
        return <span key={key} className="rounded bg-app-accent/20 px-0.5 font-semibold text-app-accent">{node.text}</span>;
      default:
        return null;
    }
  });
}

function CodeBlock({ language, text }: { language: string | null; text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }).catch(() => undefined);
  };
  return (
    <div className="my-1 overflow-hidden rounded-lg border border-app-border bg-app-background/80">
      <div className="flex items-center justify-between gap-2 border-b border-app-border/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-app-muted">
        <span>{language ?? 'code'}</span>
        <button type="button" onClick={copy} className="inline-flex items-center gap-1 normal-case tracking-normal hover:text-app-accent" aria-label="Copy code">
          <Icon name={copied ? 'check' : 'copy'} className="size-3" />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre data-lenis-prevent className="max-h-80 overflow-auto px-3 py-2 font-mono text-xs leading-5 text-app-foreground"><code>{text}</code></pre>
    </div>
  );
}

function renderBlock(block: Block, index: number): ReactNode {
  const key = `b${index}`;
  switch (block.type) {
    case 'paragraph':
      return (
        <p key={key} className="whitespace-pre-wrap break-words">
          {block.lines.map((line, lineIndex) => (
            <span key={`${key}-${lineIndex}`}>
              {lineIndex > 0 && <br />}
              {renderInline(line, `${key}-${lineIndex}`)}
            </span>
          ))}
        </p>
      );
    case 'code':
      return <CodeBlock key={key} language={block.language} text={block.text} />;
    case 'quote':
      return (
        <blockquote key={key} className="my-0.5 border-l-[3px] border-app-accent/50 pl-2.5 text-app-foreground/85">
          {block.lines.map((line, lineIndex) => (
            <p key={`${key}-${lineIndex}`} className="whitespace-pre-wrap break-words">{renderInline(line, `${key}-${lineIndex}`)}</p>
          ))}
        </blockquote>
      );
    case 'list': {
      const items = block.items.map((item, itemIndex) => (
        <li key={`${key}-${itemIndex}`} className="break-words pl-0.5">{renderInline(item, `${key}-${itemIndex}`)}</li>
      ));
      return block.ordered
        ? <ol key={key} start={block.start} className="my-0.5 list-decimal space-y-0.5 pl-5">{items}</ol>
        : <ul key={key} className="my-0.5 list-disc space-y-0.5 pl-5">{items}</ul>;
    }
    case 'spacer':
      return <div key={key} className="h-2" aria-hidden="true" />;
    default:
      return null;
  }
}

/**
 * A message body with its formatting. A single plain paragraph renders
 * inline (so the bubble's timestamp can sit at the end of the last line,
 * exactly as before); anything with blocks renders as blocks.
 */
export function MessageMarkdown({ body, mentions, trailing }: { body: string; mentions: readonly MentionRef[]; trailing?: ReactNode }): React.JSX.Element {
  const blocks = useMemo(() => parseMarkdown(body, mentions), [body, mentions]);
  if (blocks.length === 0) return <>{trailing}</>;
  if (isSimple(blocks)) {
    const block = blocks[0] as Extract<Block, { type: 'paragraph' }>;
    return (
      <p className="inline whitespace-pre-wrap break-words">
        {block.lines.map((line, lineIndex) => (
          <span key={lineIndex}>
            {lineIndex > 0 && <br />}
            {renderInline(line, `p-${lineIndex}`)}
          </span>
        ))}
        {trailing}
      </p>
    );
  }
  return (
    <div className="space-y-1 break-words">
      {blocks.map(renderBlock)}
      {trailing}
    </div>
  );
}

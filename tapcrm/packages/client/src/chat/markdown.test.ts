import { describe, expect, it } from 'vitest';
import { applyFormat, isSimple, parseInline, parseMarkdown, toPlainText } from './markdown.js';

describe('chat markdown — inline', () => {
  it('bold, italic, strike and code', () => {
    expect(parseInline('*bold* and **also bold**')).toEqual([
      { type: 'bold', children: [{ type: 'text', text: 'bold' }] },
      { type: 'text', text: ' and ' },
      { type: 'bold', children: [{ type: 'text', text: 'also bold' }] },
    ]);
    expect(parseInline('_soft_ ~gone~ ~~also gone~~')).toEqual([
      { type: 'italic', children: [{ type: 'text', text: 'soft' }] },
      { type: 'text', text: ' ' },
      { type: 'strike', children: [{ type: 'text', text: 'gone' }] },
      { type: 'text', text: ' ' },
      { type: 'strike', children: [{ type: 'text', text: 'also gone' }] },
    ]);
    expect(parseInline('run `npm *install*` now')).toEqual([
      { type: 'text', text: 'run ' },
      { type: 'code', text: 'npm *install*' },
      { type: 'text', text: ' now' },
    ]);
  });

  it('nests emphasis', () => {
    expect(parseInline('*_both_*')).toEqual([{ type: 'bold', children: [{ type: 'italic', children: [{ type: 'text', text: 'both' }] }] }]);
  });

  it('leaves snake_case, arithmetic, lone markers and spaced markers alone', () => {
    for (const text of ['file_name_v2.csv', '2*3*4 = 24', 'a * b * c', 'price is 5*', '* not a list here', 'x_ y _z']) {
      expect(parseInline(text), text).toEqual([{ type: 'text', text }]);
    }
  });

  it('links: bare URLs (trailing punctuation excluded) and [label](url); unsafe schemes stay text', () => {
    expect(parseInline('see https://github.com/org/repo_name/pull/1.')).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'link', href: 'https://github.com/org/repo_name/pull/1', children: [{ type: 'text', text: 'https://github.com/org/repo_name/pull/1' }] },
      { type: 'text', text: '.' },
    ]);
    expect(parseInline('[the *spec*](https://example.com/spec)')).toEqual([
      { type: 'link', href: 'https://example.com/spec', children: [{ type: 'text', text: 'the ' }, { type: 'bold', children: [{ type: 'text', text: 'spec' }] }] },
    ]);
    expect(parseInline('[click](javascript:alert(1))')).toEqual([{ type: 'text', text: '[click](javascript:alert(1))' }]);
  });

  it('mentions only the people the message actually recorded', () => {
    const mentions = [{ userId: 'u1', fullName: 'Asha Verma' }];
    expect(parseInline('@Asha Verma and @Someone Else', mentions)).toEqual([
      { type: 'mention', text: '@Asha Verma', userId: 'u1' },
      { type: 'text', text: ' and @Someone Else' },
    ]);
  });
});

describe('chat markdown — blocks', () => {
  it('a plain message is one simple paragraph', () => {
    const blocks = parseMarkdown('hello there\nsecond line');
    expect(isSimple(blocks)).toBe(true);
    expect(blocks[0]).toEqual({ type: 'paragraph', lines: [[{ type: 'text', text: 'hello there' }], [{ type: 'text', text: 'second line' }]] });
  });

  it('code blocks keep their content verbatim, with an optional language', () => {
    expect(parseMarkdown('```ts\nconst a = *b*;\n```')).toEqual([{ type: 'code', language: 'ts', text: 'const a = *b*;' }]);
    expect(parseMarkdown('```inline code```')).toEqual([{ type: 'code', language: null, text: 'inline code' }]);
    // Unclosed fence: just text.
    expect(parseMarkdown('```oops')).toEqual([{ type: 'paragraph', lines: [[{ type: 'text', text: '```oops' }]] }]);
  });

  it('quotes, bullet and numbered lists', () => {
    const blocks = parseMarkdown('> client said yes\n> on Monday\n\n- one\n- *two*\n\n3. three\n4. four');
    expect(blocks.map((b) => b.type)).toEqual(['quote', 'spacer', 'list', 'spacer', 'list']);
    expect(blocks[2]).toMatchObject({ type: 'list', ordered: false, items: [[{ type: 'text', text: 'one' }], [{ type: 'bold', children: [{ type: 'text', text: 'two' }] }]] });
    expect(blocks[4]).toMatchObject({ type: 'list', ordered: true, start: 3 });
  });

  it('plain text for previews drops the markers', () => {
    expect(toPlainText('*Invoice* `INV-42` is _ready_:\n- pay by Friday')).toBe('Invoice INV-42 is ready: • pay by Friday');
  });
});

describe('composer formatting', () => {
  it('wraps the selection, and unwraps when applied again', () => {
    const once = applyFormat('make this bold', 5, 9, 'bold');
    expect(once).toEqual({ text: 'make *this* bold', selectionStart: 6, selectionEnd: 10 });
    expect(applyFormat(once.text, once.selectionStart, once.selectionEnd, 'bold')).toEqual({ text: 'make this bold', selectionStart: 5, selectionEnd: 9 });
  });

  it('inserts an empty pair with the caret inside when nothing is selected', () => {
    expect(applyFormat('ab', 1, 1, 'code')).toEqual({ text: 'a``b', selectionStart: 2, selectionEnd: 2 });
  });

  it('prefixes every selected line for lists and quotes', () => {
    expect(applyFormat('one\ntwo', 0, 7, 'numbered').text).toBe('1. one\n2. two');
    expect(applyFormat('one\ntwo', 4, 7, 'quote').text).toBe('one\n> two');
    expect(applyFormat('x', 1, 1, 'codeblock').text).toBe('x\n```\n\n```');
  });
});

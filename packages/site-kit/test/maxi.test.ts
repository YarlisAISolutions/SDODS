import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  createSseParser,
  historyFor,
  MaxiChat,
  parseInline,
  parseMarkdown,
  safeHref,
  TutorAvatar,
} from '../src/index';

describe('createSseParser', () => {
  it('reassembles events split across chunks and skips comments', () => {
    const seen: Array<[string, string]> = [];
    const parser = createSseParser(({ event, data }) => seen.push([event, data]));
    parser.push(':ok\n\nevent: text\nda');
    parser.push('ta: {"text":"Hel"}\n\nevent: text\r\ndata: {"text":"lo"}\r\n\r\n:hb\n\n');
    parser.push('event: done\ndata: {"id":"1"}');
    parser.end();
    expect(seen).toEqual([
      ['text', '{"text":"Hel"}'],
      ['text', '{"text":"lo"}'],
      ['done', '{"id":"1"}'],
    ]);
  });
});

describe('parseMarkdown', () => {
  it('parses the blocks an answer uses', () => {
    const blocks = parseMarkdown(
      '## Install\n\nRun this:\n\n```bash\ncurl -fsSL https://sdods.com/install.sh | sh\n```\n\n- one\n- two\n\n1. first\n2. second\n\n| a | b |\n|---|---|\n| 1 | 2 |',
    );
    expect(blocks.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'code',
      'list',
      'list',
      'table',
    ]);
    expect(blocks[2]).toEqual({
      type: 'code',
      lang: 'bash',
      text: 'curl -fsSL https://sdods.com/install.sh | sh',
      open: false,
    });
    expect(blocks[4]).toMatchObject({ type: 'list', ordered: true });
  });

  it('treats a code fence that is still streaming as an open block', () => {
    const blocks = parseMarkdown('Here:\n\n```gherkin\n@ui @smoke\nFeature: Lo');
    expect(blocks.at(-1)).toEqual({
      type: 'code',
      lang: 'gherkin',
      text: '@ui @smoke\nFeature: Lo',
      open: true,
    });
  });

  it('parses inline code, emphasis and links', () => {
    expect(
      parseInline('Run `sdods doctor`, **then** see [the docs](https://docs.sdods.com/docs/)'),
    ).toEqual([
      { type: 'text', text: 'Run ' },
      { type: 'code', text: 'sdods doctor' },
      { type: 'text', text: ', ' },
      { type: 'strong', children: [{ type: 'text', text: 'then' }] },
      { type: 'text', text: ' see ' },
      {
        type: 'link',
        href: 'https://docs.sdods.com/docs/',
        children: [{ type: 'text', text: 'the docs' }],
      },
    ]);
  });

  it('never produces a script link', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref(' data:text/html,x')).toBeUndefined();
    expect(parseInline('[click](javascript:alert(1))')).toEqual([
      { type: 'text', text: 'click' },
      { type: 'text', text: ')' },
    ]);
    const html = renderToStaticMarkup(
      createElement('div', null, JSON.stringify(parseInline('<img src=x onerror=alert(1)>'))),
    );
    expect(html).not.toContain('<img');
  });

  it('leaves snake_case and file paths alone', () => {
    expect(parseInline('set standard_user in my_env_file')).toEqual([
      { type: 'text', text: 'set standard_user in my_env_file' },
    ]);
  });
});

describe('historyFor', () => {
  it('drops failed exchanges and keeps turns alternating', () => {
    const history = historyFor(
      [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1', id: 'x' },
        { role: 'user', content: 'q2' },
        { role: 'assistant', content: '', failed: true },
      ],
      'q3',
    );
    expect(history).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q3' },
    ]);
  });

  it('keeps at most 19 messages and always starts with the visitor', () => {
    const long = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
      content: `m${i}`,
    }));
    const history = historyFor(long, 'latest');
    expect(history).toHaveLength(19);
    expect(history[0]!.role).toBe('user');
    expect(history.at(-1)).toEqual({ role: 'user', content: 'latest' });
  });
});

describe('MaxiChat', () => {
  const props = { name: 'Maxi', greeting: 'Hi, I am Maxi.' };

  it('renders nothing without an endpoint, so a site can ship it before the service exists', () => {
    expect(renderToStaticMarkup(createElement(MaxiChat, { ...props, endpoint: '' }))).toBe('');
    expect(renderToStaticMarkup(createElement(MaxiChat, { ...props, endpoint: undefined }))).toBe(
      '',
    );
  });

  it('renders a labelled launcher that controls the dialog', () => {
    const html = renderToStaticMarkup(
      createElement(MaxiChat, { ...props, endpoint: 'https://maxi.example' }),
    );
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('Ask Maxi');
  });

  it('keeps the tutor avatar accessible name the docs relied on', () => {
    expect(renderToStaticMarkup(createElement(TutorAvatar, { mood: 'happy' }))).toContain(
      'aria-label="Maxi the tutor, looking happy"',
    );
  });
});

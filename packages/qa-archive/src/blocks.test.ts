import { describe, expect, it } from 'vitest';
import { excerpt, imagesIn, parseBody, parseSpans } from './blocks';

describe('parseSpans', () => {
  it('reads inline code and links, and leaves everything else literal', () => {
    expect(
      parseSpans('run `sdods lint` then see [the docs](https://docs.sdods.com/docs/)'),
    ).toEqual([
      { t: 'text', v: 'run ' },
      { t: 'code', v: 'sdods lint' },
      { t: 'text', v: ' then see ' },
      { t: 'link', v: 'the docs', href: 'https://docs.sdods.com/docs/' },
    ]);
  });

  it('does not turn a backticked link into a link', () => {
    expect(parseSpans('`[a](b)`')).toEqual([{ t: 'code', v: '[a](b)' }]);
  });

  it('leaves markdown it does not support as text', () => {
    expect(parseSpans('**bold** and <script>')).toEqual([
      { t: 'text', v: '**bold** and <script>' },
    ]);
  });
});

describe('parseBody', () => {
  it('separates paragraphs on blank lines and joins wrapped ones', () => {
    expect(parseBody('one\nstill one\n\ntwo')).toEqual([
      { kind: 'p', spans: [{ t: 'text', v: 'one still one' }] },
      { kind: 'p', spans: [{ t: 'text', v: 'two' }] },
    ]);
  });

  it('reads a fence with its language and keeps the code verbatim', () => {
    const [block] = parseBody('```bash\nsdods run -p demo-shop\n  --headed\n```');
    expect(block).toEqual({
      kind: 'code',
      lang: 'bash',
      code: 'sdods run -p demo-shop\n  --headed',
    });
  });

  it('does not touch markdown characters inside a fence', () => {
    const [block] = parseBody('```text\n- not a list\n`not code`\n```');
    expect(block).toEqual({ kind: 'code', lang: 'text', code: '- not a list\n`not code`' });
  });

  // A stranger typing into the answer box will leave a fence open. That must degrade, not throw.
  it('treats an unclosed fence as code to the end of the body', () => {
    expect(parseBody('intro\n\n```\nhalf written')).toEqual([
      { kind: 'p', spans: [{ t: 'text', v: 'intro' }] },
      { kind: 'code', lang: undefined, code: 'half written' },
    ]);
  });

  it('groups consecutive bullets into one list and splits on a change of kind', () => {
    const blocks = parseBody('- a\n- b\n1. c');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false });
    expect(blocks[1]).toMatchObject({ kind: 'list', ordered: true });
  });

  it('promotes a tagged quote to a callout and leaves a plain one a quote', () => {
    expect(parseBody('> [!WARNING]\n> mind the gap')[0]).toEqual({
      kind: 'callout',
      tone: 'warn',
      spans: [{ t: 'text', v: 'mind the gap' }],
    });
    expect(parseBody('> plain')[0]).toMatchObject({ kind: 'quote' });
  });

  it('reads an image line with an optional caption', () => {
    expect(parseBody('![doctor output](/questions/doctor.png "sdods doctor")')).toEqual([
      {
        kind: 'image',
        src: '/questions/doctor.png',
        alt: 'doctor output',
        caption: 'sdods doctor',
      },
    ]);
  });

  it('is empty for an empty body', () => {
    expect(parseBody('')).toEqual([]);
  });
});

describe('excerpt', () => {
  it('uses prose only and drops code', () => {
    expect(excerpt('The run fails.\n\n```bash\nsdods run\n```')).toBe('The run fails.');
  });

  it('truncates on a word boundary', () => {
    const out = excerpt('word '.repeat(80), 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('imagesIn', () => {
  it('finds every image in a body', () => {
    expect(imagesIn('a\n\n![x](/one.png)\n\nb\n\n![y](/two.png)')).toEqual([
      { src: '/one.png', alt: 'x' },
      { src: '/two.png', alt: 'y' },
    ]);
  });
});

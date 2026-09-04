import {
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import type { StepDef } from '../../api/types';

/**
 * Step completion. Primary source is the project's step catalog (`bddgen export`).
 * A Web Worker hosting @cucumber/language-service can enrich results when it loads; the
 * local matcher below keeps the editor useful without it.
 */
export interface WorkerApi {
  completions(
    text: string,
    line: number,
    column: number,
  ): Promise<Array<{ label: string; detail?: string; insertText?: string }>>;
}

const KEYWORD_RE = /^\s*(Given|When|Then|And|But)\s+/;

export function patternToSnippet(pattern: string): string {
  let n = 0;
  return pattern.replace(/\{(string|int|float|word|method|role|[a-zA-Z_]+)\}/g, (_m, t: string) => {
    n++;
    return t === 'string' ? `"\${${n}:${t}}"` : `\${${n}:${t}}`;
  });
}

function tokens(q: string) {
  return q.split(/\s+/).filter(Boolean);
}

export function stepCompletions(steps: StepDef[], worker?: WorkerApi | null) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    const m = KEYWORD_RE.exec(before);
    if (!m) {
      const w = ctx.matchBefore(/^\s*\w*/);
      if (!w) return null;
      const options: Completion[] = [
        'Given',
        'When',
        'Then',
        'And',
        'But',
        'Scenario:',
        'Scenario Outline:',
        'Background:',
        'Examples:',
      ].map((k) => ({ label: k, type: 'keyword', apply: `${k} ` }));
      return { from: w.from + (w.text.length - w.text.trimStart().length), options };
    }
    const typed = before.slice(m[0].length);
    const from = line.from + m[0].length;
    const q = typed.toLowerCase();
    let options: Completion[] = steps
      .filter((s) => !q || tokens(q).every((t) => s.pattern.toLowerCase().includes(t)))
      .slice(0, 50)
      .map((s) => ({
        label: s.pattern,
        type: 'function',
        detail: `${s.keyword} · ${s.source ?? ''}`,
        info: s.file ? `${s.file}:${s.line ?? ''}` : undefined,
        apply: snippet(patternToSnippet(s.pattern)),
      }));
    if (worker) {
      try {
        const extra = await worker.completions(
          ctx.state.doc.toString(),
          line.number - 1,
          ctx.pos - line.from,
        );
        const known = new Set(options.map((o) => o.label));
        options = [
          ...options,
          ...extra
            .filter((e) => !known.has(e.label))
            .map<Completion>((e) => ({
              label: e.label,
              type: 'function',
              detail: e.detail ?? 'language-service',
              apply: e.insertText ?? e.label,
            })),
        ];
      } catch {
        /* worker unavailable */
      }
    }
    return { from, options, filter: false, validFor: /^[^\n]*$/ };
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import {
  linter,
  lintGutter,
  setDiagnostics,
  type Diagnostic as CmDiagnostic,
} from '@codemirror/lint';
import {
  useFeature,
  useFeatures,
  useProject,
  useSaveFeature,
  useSteps,
  useValidateFeature,
  toDiagnostics,
} from '../api/queries';
import type { Diagnostic } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, ErrorBox, Kbd, PageHeader, Spinner, TagChip } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { cn } from '../lib/utils';
import { gherkinLanguage, parseFeatureText, scenarioAtLine } from './editor/gherkin-language';
import { stepCompletions, type WorkerApi } from './editor/completions';
import { StartRunDialog } from './Runs';

export function FeatureEditorPage() {
  const { slug = '', '*': splat = '' } = useParams();
  const nav = useNavigate();
  const project = useProject(slug);
  const files = useFeatures(slug);
  const path = splat || files.data?.[0]?.path || '';
  const file = useFeature(slug, path);
  const steps = useSteps(slug);
  const validate = useValidateFeature(slug);
  const save = useSaveFeature(slug);
  const { canEdit } = useAuth();
  const editable = canEdit(project.data?.workspace, project.data?.organization);
  const { toast } = useToast();
  const [doc, setDoc] = useState('');
  const [dirty, setDirty] = useState(false);
  const [serverDiags, setServerDiags] = useState<Diagnostic[]>([]);
  const [cursorLine, setCursorLine] = useState(1);
  const [running, setRunning] = useState<{ feature: string; scenario?: string } | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const worker = useRef<WorkerApi | null>(null);
  const stepsRef = useRef(steps.data ?? []);
  stepsRef.current = steps.data ?? [];

  // Worker (best-effort): language-service in a Web Worker fed by the step catalog.
  useEffect(() => {
    if (!steps.data || typeof Worker === 'undefined') return;
    try {
      const w = new Worker(new URL('./editor/language-service.worker.ts', import.meta.url), {
        type: 'module',
      });
      let seq = 0;
      const pending = new Map<number, (v: any) => void>();
      w.onmessage = (e) => pending.get(e.data.id)?.(e.data.result ?? e.data.ok);
      const call = (msg: Record<string, unknown>) =>
        new Promise<any>((resolve) => {
          const id = ++seq;
          pending.set(id, resolve);
          w.postMessage({ id, ...msg });
          setTimeout(() => resolve([]), 1500);
        });
      void call({ kind: 'init', expressions: steps.data.map((s) => s.pattern) });
      worker.current = {
        completions: (text, line, column) => call({ kind: 'completions', text, line, column }),
      };
      return () => w.terminate();
    } catch {
      worker.current = null;
    }
  }, [steps.data]);

  const localLint = useCallback(
    (text: string): Diagnostic[] => {
      const p = parseFeatureText(text);
      const d: Diagnostic[] = [];
      if (p.featureLine == null)
        d.push({
          severity: 'error',
          rule: 'gherkin/feature',
          message: 'Missing "Feature:" line.',
          line: 1,
        });
      const suites = project.data?.tags.suites.map((s) => `@${s}`) ?? [];
      const allTags = (s: (typeof p.scenarios)[number]) => [...p.tags, ...s.tags];
      for (const s of p.scenarios) {
        const t = allTags(s);
        if (!t.some((x) => ['@ui', '@api', '@hybrid'].includes(x)))
          d.push({
            severity: 'error',
            rule: 'tags/layer',
            message: `"${s.name}" needs exactly one layer tag (@ui, @api, @hybrid).`,
            line: s.line,
            fix: { description: 'Add @ui', insertTag: '@ui' },
          });
        if (suites.length && !t.some((x) => suites.includes(x)))
          d.push({
            severity: 'error',
            rule: 'tags/suite',
            message: `"${s.name}" needs exactly one suite tag (${suites.join(', ')}).`,
            line: s.line,
            fix: {
              description: `Add ${suites[1] ?? suites[0]}`,
              insertTag: suites[1] ?? suites[0],
            },
          });
        if (s.outline && !/# title-format:/.test(text))
          d.push({
            severity: 'warning',
            rule: 'outline/title',
            message: 'Scenario Outline without "# title-format:" reports rows as "Example #n".',
            line: s.line,
          });
      }
      return d;
    },
    [project.data],
  );

  const allDiags = useMemo(
    () => [
      ...localLint(doc),
      ...serverDiags.filter(
        (sd) => !localLint(doc).some((ld) => ld.rule === sd.rule && ld.line === sd.line),
      ),
    ],
    [doc, serverDiags, localLint],
  );
  const hasErrors = allDiags.some((d) => d.severity === 'error');

  // Debounced server validation.
  useEffect(() => {
    if (!doc || !path) return;
    const t = setTimeout(
      () =>
        validate.mutate(
          { path, content: doc },
          { onSuccess: (r) => setServerDiags(r.diagnostics) },
        ),
      600,
    );
    return () => clearTimeout(t);
  }, [doc, path]);

  // Mount CodeMirror once per file.
  useEffect(() => {
    if (!host.current || file.data == null) return;
    view.current?.destroy();
    setDoc(file.data.content);
    setDirty(false);
    const state = EditorState.create({
      doc: file.data.content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        lintGutter(),
        gherkinLanguage,
        autocompletion({
          override: [stepCompletions(stepsRef.current, worker.current)],
          activateOnTyping: true,
        }),
        linter(() => [], { delay: 300 }),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
          {
            key: 'Mod-s',
            run: () => {
              document.getElementById('save-feature')?.click();
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            setDoc(u.state.doc.toString());
            setDirty(true);
          }
          if (u.selectionSet || u.docChanged)
            setCursorLine(u.state.doc.lineAt(u.state.selection.main.head).number);
        }),
        EditorState.readOnly.of(!editable),
      ],
    });
    view.current = new EditorView({ state, parent: host.current });
    return () => view.current?.destroy();
  }, [file.data?.path, file.data?.content, editable]);

  // Push diagnostics into the editor gutter.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cm: CmDiagnostic[] = allDiags.map((d) => {
      const line = v.state.doc.line(Math.min(Math.max(1, d.line ?? 1), v.state.doc.lines));
      return {
        from: line.from,
        to: line.to,
        severity: d.severity,
        message: `${d.rule}: ${d.message}`,
        actions: d.fix?.insertTag
          ? [
              {
                name: d.fix.description,
                apply: (view: EditorView) => insertTag(view, line.from, d.fix!.insertTag!),
              },
            ]
          : undefined,
      };
    });
    v.dispatch(setDiagnostics(v.state, cm));
  }, [allDiags]);

  const parsed = useMemo(() => parseFeatureText(doc), [doc]);
  const current = scenarioAtLine(parsed, cursorLine);
  const insertTagAtCursor = (tag: string) => {
    const v = view.current;
    if (!v) return;
    const target = current
      ? v.state.doc.line(current.line)
      : parsed.featureLine
        ? v.state.doc.line(parsed.featureLine)
        : v.state.doc.line(1);
    insertTag(v, target.from, tag);
  };

  if (files.isLoading || project.isLoading) return <Spinner />;
  if (files.error) return <ErrorBox error={files.error} retry={() => files.refetch()} />;

  const byModule = new Map<string, typeof files.data>();
  for (const f of files.data ?? [])
    byModule.set(f.module ?? '(no module)', [
      ...(byModule.get(f.module ?? '(no module)') ?? []),
      f,
    ]);
  const tagChoices = [
    '@ui',
    '@api',
    '@hybrid',
    ...(project.data?.tags.suites.map((s) => `@${s}`) ?? []),
    ...(project.data?.modules.flatMap((m) => m.tags) ?? []),
    ...(project.data?.tags.extra.map((s) => `@${s}`) ?? []),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Feature editor"
        subtitle={
          <span className="flex items-center gap-2">
            <span className="mono">
              projects/{slug}/features/{path}
            </span>
            {dirty && <Badge tone="amber">unsaved</Badge>}
            {steps.isLoading ? (
              <Badge>loading steps…</Badge>
            ) : (
              steps.data && <Badge>{steps.data.length} steps in catalog</Badge>
            )}
          </span>
        }
        actions={
          <>
            <Button size="sm" onClick={() => setRunning({ feature: path })} disabled={!path}>
              Run feature
            </Button>
            <Button
              size="sm"
              onClick={() => current && setRunning({ feature: path, scenario: current.name })}
              disabled={!current}
            >
              Run this scenario
            </Button>
            <Button
              size="sm"
              onClick={() =>
                validate.mutate(
                  { path, content: doc },
                  {
                    onSuccess: (r) => {
                      setServerDiags(r.diagnostics);
                      toast(`${r.diagnostics.length} finding(s)`);
                    },
                  },
                )
              }
            >
              Validate
            </Button>
            <Button
              id="save-feature"
              size="sm"
              variant="primary"
              disabled={!editable || !dirty || hasErrors || save.isPending}
              title={hasErrors ? 'Fix lint errors before saving' : 'Save (⌘S)'}
              onClick={() =>
                save.mutate(
                  { path, content: doc },
                  {
                    onSuccess: () => {
                      setDirty(false);
                      toast('Saved', 'success');
                    },
                    onError: (e: any) => {
                      setServerDiags(
                        toDiagnostics(e?.body?.error?.details ?? e?.body?.details ?? e?.body),
                      );
                      toast(e.message, 'error');
                    },
                  },
                )
              }
            >
              Save <Kbd>⌘S</Kbd>
            </Button>
          </>
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)_280px] gap-3">
        <aside
          className="panel min-h-0 overflow-auto p-2 text-sm scrollbar-thin"
          aria-label="feature files"
        >
          {[...byModule.entries()].map(([m, fs]) => (
            <div key={m} className="mb-2">
              <div className="mb-1 px-1 text-[10px] uppercase tracking-wide muted">{m}</div>
              {(fs ?? []).map((f) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => nav(`/projects/${slug}/editor/${f.path}`)}
                  className={cn(
                    'block w-full truncate rounded px-2 py-1 text-left hover:bg-[var(--panel-2)]',
                    f.path === path && 'bg-brand-500/15 font-medium',
                  )}
                  title={f.path}
                >
                  {f.path.split('/').pop()} <span className="muted text-[10px]">{f.scenarios}</span>
                </button>
              ))}
            </div>
          ))}
        </aside>
        <div className="panel relative min-h-0 overflow-hidden">
          <div className="h-full min-h-0 overflow-hidden" ref={host} />
          {file.isLoading && (
            <div className="absolute inset-0 flex items-start justify-center bg-[var(--panel)]">
              <Spinner label="Loading feature…" />
            </div>
          )}
        </div>
        <aside className="panel min-h-0 space-y-3 overflow-auto p-3 text-xs scrollbar-thin">
          <section>
            <div className="mb-1 font-medium">
              Tags{' '}
              {current ? (
                <span className="muted">for “{current.name}”</span>
              ) : (
                <span className="muted">for the feature</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {(current ? [...parsed.tags, ...current.tags] : parsed.tags).map((t) => (
                <TagChip key={t} tag={t} />
              ))}
            </div>
            {editable && (
              <div className="mt-2 flex flex-wrap gap-1">
                {tagChoices.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => insertTagAtCursor(t)}
                    className="rounded border border-line px-1.5 py-0.5 mono hover:bg-[var(--panel-2)]"
                  >
                    + {t}
                  </button>
                ))}
              </div>
            )}
          </section>
          <section>
            <div className="mb-1 font-medium">Diagnostics ({allDiags.length})</div>
            <ul className="space-y-1">
              {allDiags.map((d, i) => (
                <li key={i} className={d.severity === 'error' ? 'text-red-500' : 'text-amber-600'}>
                  <button
                    type="button"
                    className="text-left hover:underline"
                    onClick={() =>
                      d.line &&
                      view.current?.dispatch({
                        selection: { anchor: view.current.state.doc.line(d.line).from },
                        scrollIntoView: true,
                      })
                    }
                  >
                    L{d.line ?? '?'} {d.rule}: {d.message}
                  </button>
                </li>
              ))}
              {allDiags.length === 0 && <li className="status-passed">No findings.</li>}
            </ul>
          </section>
          <section>
            <div className="mb-1 font-medium">Scenarios</div>
            <ul className="space-y-0.5">
              {parsed.scenarios.map((s) => (
                <li key={s.line}>
                  <button
                    type="button"
                    className={cn('hover:underline', current?.line === s.line && 'font-medium')}
                    onClick={() =>
                      view.current?.dispatch({
                        selection: { anchor: view.current.state.doc.line(s.line).from },
                        scrollIntoView: true,
                      })
                    }
                  >
                    L{s.line} {s.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <div className="mb-1 font-medium">Step catalog</div>
            <StepCatalog
              steps={steps.data ?? []}
              onInsert={(p) =>
                view.current?.dispatch({
                  changes: { from: view.current.state.selection.main.head, insert: p },
                })
              }
            />
          </section>
        </aside>
      </div>
      {running && (
        <StartRunDialog
          open
          onClose={() => setRunning(null)}
          defaultProject={slug}
          prefill={{
            project: slug,
            env: project.data?.envs.default ?? '',
            feature: running.feature,
            scenario: running.scenario,
          }}
        />
      )}
    </div>
  );
}

function insertTag(view: EditorView, lineFrom: number, tag: string) {
  const line = view.state.doc.lineAt(lineFrom);
  const prev = line.number > 1 ? view.state.doc.line(line.number - 1) : null;
  const indent = line.text.match(/^\s*/)?.[0] ?? '';
  if (prev && prev.text.trim().startsWith('@')) {
    if (prev.text.includes(tag)) return;
    view.dispatch({ changes: { from: prev.to, insert: ` ${tag}` } });
  } else {
    view.dispatch({ changes: { from: line.from, insert: `${indent}${tag}\n` } });
  }
}

function StepCatalog({
  steps,
  onInsert,
}: {
  steps: Array<{ keyword: string; pattern: string; source?: string }>;
  onInsert: (p: string) => void;
}) {
  const [q, setQ] = useState('');
  const list = steps.filter((s) => s.pattern.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
  return (
    <div>
      <input
        className="mb-1 w-full rounded border border-line bg-[var(--panel)] px-2 py-1"
        placeholder="search steps"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="search steps"
      />
      <ul className="space-y-0.5">
        {list.map((s) => (
          <li key={`${s.keyword}${s.pattern}`}>
            <button
              type="button"
              className="w-full truncate text-left hover:underline"
              title={`${s.keyword} ${s.pattern} (${s.source ?? ''})`}
              onClick={() =>
                onInsert(`${s.keyword === 'Unknown' ? 'And' : s.keyword} ${s.pattern}`)
              }
            >
              <span className="text-brand-600">{s.keyword}</span> {s.pattern}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

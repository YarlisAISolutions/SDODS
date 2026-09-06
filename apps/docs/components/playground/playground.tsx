'use client';

/**
 * The runnable scenario on the getting-started pages.
 *
 * A reader edits the Gherkin, presses Run, and watches the same steps the CLI would run: API
 * steps send real requests to the sandbox in `envs/staging.yaml`, UI steps drive a stand-in
 * storefront that carries the real selectors, and hybrid scenarios do both with one set of
 * variables. Nothing here is a recording of a run — it is a run, in the reader's browser.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { BrowserPanel } from './browser-panel';
import { layerOf, lintTags, parseFeature, type ParsedStep } from './gherkin';
import { narrateDone, narrateFail, narrateLint, narratePass, narrateUnknown } from './narration';
import { ENV_VARS, getPreset, type PresetId } from './presets';
import { type Exchange, type NetworkMode } from './sandbox';
import { initialApp, type AppState } from './shop';
import {
  matchStep,
  stepsByLayer,
  type StepFailure,
  type Evidence,
  type RunContext,
  type StepLayer,
} from './steps';
import { TutorBar, type TutorMood } from '../tutor';

type StepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'unknown';

interface StepRun {
  status: StepStatus;
  detail?: string;
  error?: string;
  expected?: string;
  actual?: string;
  evidence: Evidence[];
  ms?: number;
}

const PENDING: StepRun = { status: 'pending', evidence: [] };

function cloneApp(app: AppState): AppState {
  return {
    ...app,
    fields: { ...app.fields },
    cart: [...app.cart],
    mocked: app.mocked ? { ...app.mocked } : null,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pretty(value: unknown): string {
  const text = JSON.stringify(value, null, 2) ?? String(value);
  return text.length > 4000 ? `${text.slice(0, 4000)}\n… truncated for the panel` : text;
}

const STATUS_STYLE: Record<StepStatus, string> = {
  pending: 'text-fd-muted-foreground',
  running: 'text-amber-600 dark:text-amber-400',
  passed: 'text-emerald-600 dark:text-emerald-400',
  failed: 'text-rose-600 dark:text-rose-400',
  skipped: 'text-fd-muted-foreground',
  unknown: 'text-rose-600 dark:text-rose-400',
};

const STATUS_MARK: Record<StepStatus, string> = {
  pending: '○',
  running: '◐',
  passed: '✓',
  failed: '✗',
  skipped: '–',
  unknown: '?',
};

/** The glyph and the colour are the same fact twice; neither survives being read aloud. */
const STATUS_WORD: Record<StepStatus, string> = {
  pending: 'not run',
  running: 'running',
  passed: 'passed',
  failed: 'failed',
  skipped: 'skipped',
  unknown: 'undefined step',
};

export function Playground({ preset: presetId }: { preset: PresetId }) {
  const preset = getPreset(presetId);
  const [source, setSource] = useState(preset.gherkin);
  const [runs, setRuns] = useState<StepRun[]>([]);
  const [app, setApp] = useState<AppState>(initialApp);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [mode, setMode] = useState<NetworkMode>('live');
  const [tab, setTab] = useState<'browser' | 'network' | 'report'>(preset.panel);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [tutor, setTutor] = useState<{ mood: TutorMood; text: string }>({
    mood: 'idle',
    text: preset.intro,
  });
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const ctxRef = useRef<RunContext | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const tokenRef = useRef(0);

  const feature = useMemo(() => parseFeature(source), [source]);
  const scenario = feature.scenarios[0];
  const steps: ParsedStep[] = useMemo(() => scenario?.steps ?? [], [scenario]);
  const layer: StepLayer = (scenario && layerOf(feature, scenario)) ?? preset.layer;
  const lint = useMemo(() => (scenario ? lintTags(feature, scenario) : []), [feature, scenario]);
  const blocking = [...feature.errors, ...lint.map((l) => l.message)];
  const tags = scenario ? [...feature.tags, ...scenario.tags] : [];

  const makeContext = useCallback((): RunContext => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const fresh = initialApp();
    const ctx: RunContext = {
      vars: { ...ENV_VARS },
      headers: {},
      query: {},
      exchanges: [],
      app: fresh,
      mocks: [],
      lease: null,
      mode,
      signal: controller.signal,
      sync: () => {
        setApp(cloneApp(ctx.app));
        setExchanges([...ctx.exchanges]);
      },
      paused: 0,
      pause: async (ms: number) => {
        await delay(ms);
        ctx.paused += ms;
      },
    };
    setApp(cloneApp(fresh));
    setExchanges([]);
    return ctx;
  }, [mode]);

  const reset = useCallback(() => {
    tokenRef.current += 1;
    abortRef.current?.abort();
    ctxRef.current = null;
    setRuns(steps.map(() => PENDING));
    setCursor(0);
    setBusy(false);
    setElapsed(0);
    setApp(initialApp());
    setExchanges([]);
    setTutor({ mood: 'idle', text: preset.intro });
  }, [preset.intro, steps]);

  /** Runs one step and reports how it ended, which is what decides whether the run continues. */
  const execute = useCallback(
    async (ctx: RunContext, index: number): Promise<'passed' | 'failed' | 'unknown'> => {
      const step = steps[index]!;
      setRuns((prev) => {
        const next = [...prev];
        next[index] = { status: 'running', evidence: [] };
        return next;
      });

      const match = matchStep(step.text);
      const started = performance.now();
      const pausedBefore = ctx.paused;
      // The playback delays are for the reader, not the scenario, so they never reach a timing.
      const took = () =>
        Math.max(0, Math.round(performance.now() - started - (ctx.paused - pausedBefore)));

      if (!match) {
        setRuns((prev) => {
          const next = [...prev];
          next[index] = {
            status: 'unknown',
            error: 'Undefined step — no phrasing in the step library matches this line.',
            evidence: [],
            ms: 0,
          };
          return next;
        });
        setTutor({ mood: 'concerned', text: narrateUnknown(step.text) });
        setCatalogOpen(true);
        return 'unknown';
      }

      if (layer !== 'hybrid' && match.definition.layer !== layer) {
        setRuns((prev) => {
          const next = [...prev];
          next[index] = {
            status: 'failed',
            error: `This scenario is tagged @${layer}, and "${match.definition.pattern}" is a ${match.definition.layer} step. Tag the scenario @hybrid to use both layers in one scenario.`,
            evidence: [],
            ms: 0,
          };
          return next;
        });
        setTutor({
          mood: 'concerned',
          text: `A @${layer} scenario does not get browser fixtures. The layer tag is what decides which fixtures a scenario is given — tag it @hybrid and both are available.`,
        });
        return 'unknown';
      }

      try {
        const outcome = await match.definition.run(ctx, match.args, step.docString);
        const ms = took();
        setRuns((prev) => {
          const next = [...prev];
          next[index] = {
            status: 'passed',
            detail: outcome.detail,
            evidence: outcome.evidence ?? [],
            ms,
          };
          return next;
        });
        setElapsed((total) => total + ms);
        setApp(cloneApp(ctx.app));
        setExchanges([...ctx.exchanges]);
        setTutor({
          mood: 'talking',
          text: narratePass(match.definition.pattern, outcome.detail, outcome.teach),
        });
        return 'passed';
      } catch (error) {
        const ms = took();
        const failure = error as StepFailure;
        setRuns((prev) => {
          const next = [...prev];
          next[index] = {
            status: 'failed',
            error: failure.message,
            expected: failure.expected,
            actual: failure.actual,
            evidence: [],
            ms,
          };
          return next;
        });
        setElapsed((total) => total + ms);
        setApp(cloneApp(ctx.app));
        setExchanges([...ctx.exchanges]);
        setTutor({
          mood: 'concerned',
          text: narrateFail(match.definition.pattern, failure.message),
        });
        return 'failed';
      }
    },
    [layer, steps],
  );

  const guard = useCallback((): boolean => {
    if (blocking.length === 0) return true;
    setTutor({ mood: 'concerned', text: narrateLint(blocking) });
    return false;
  }, [blocking]);

  const runAll = useCallback(async () => {
    if (!guard()) return;
    const token = ++tokenRef.current;
    setBusy(true);
    setElapsed(0);
    setRuns(steps.map(() => PENDING));
    setCursor(0);
    const ctx = makeContext();
    ctxRef.current = ctx;
    setTab(preset.panel);

    let passed = 0;
    let failed = 0;
    let undefinedStep = false;
    for (let i = 0; i < steps.length; i += 1) {
      if (tokenRef.current !== token) return;
      const result = await execute(ctx, i);
      setCursor(i + 1);
      if (tokenRef.current !== token) return;
      if (result !== 'passed') {
        failed = 1;
        undefinedStep = result === 'unknown';
        setRuns((prev) => {
          const next = [...prev];
          for (let j = i + 1; j < next.length; j += 1)
            next[j] = { status: 'skipped', evidence: [] };
          return next;
        });
        break;
      }
      passed += 1;
      await delay(260);
    }
    if (tokenRef.current !== token) return;
    setBusy(false);
    // An undefined step already got the explanation that helps; a summary would only bury it.
    if (undefinedStep) return;
    const skipped = steps.length - passed - failed;
    setTutor({
      mood: failed ? 'concerned' : 'happy',
      text: narrateDone(passed, failed, skipped),
    });
  }, [execute, guard, makeContext, preset.panel, steps]);

  const runNext = useCallback(async () => {
    if (!guard()) return;
    if (cursor >= steps.length) return;
    setBusy(true);
    if (cursor === 0 || !ctxRef.current) {
      ctxRef.current = makeContext();
      setRuns(steps.map(() => PENDING));
      setElapsed(0);
    }
    const result = await execute(ctxRef.current, cursor);
    setCursor((c) => c + 1);
    setBusy(false);
    if (result !== 'passed') {
      setRuns((prev) => {
        const next = [...prev];
        for (let j = cursor + 1; j < next.length; j += 1)
          next[j] = { status: 'skipped', evidence: [] };
        return next;
      });
    }
  }, [cursor, execute, guard, makeContext, steps]);

  const insert = (pattern: string) => {
    setSource((current) => `${current.replace(/\n+$/, '')}\n    And ${pattern}\n`);
  };

  const counts: Record<StepStatus, number> = runs.reduce(
    (acc, run) => ({ ...acc, [run.status]: (acc[run.status] ?? 0) + 1 }),
    {} as Record<StepStatus, number>,
  );
  // A scenario that fails stops early, so "did it finish" is about the steps, not the cursor.
  const settled =
    runs.length > 0 && runs.every((run) => run.status !== 'pending' && run.status !== 'running');
  const verdict: 'idle' | 'running' | 'passed' | 'failed' = !runs.some(
    (run) => run.status !== 'pending',
  )
    ? 'idle'
    : !settled
      ? 'running'
      : (counts.failed ?? 0) + (counts.unknown ?? 0) > 0
        ? 'failed'
        : 'passed';
  const showBrowser = layer !== 'api';
  const showNetwork = layer !== 'ui';
  // The layer tag decides which panels exist, so an edited tag can leave the open tab behind.
  const activeTab =
    (tab === 'browser' && !showBrowser) || (tab === 'network' && !showNetwork) ? 'report' : tab;
  const openTabs: StageTab[] = [
    ...(showBrowser ? (['browser'] as const) : []),
    ...(showNetwork ? (['network'] as const) : []),
    'report',
  ];

  return (
    <div className="not-prose my-8 overflow-hidden rounded-xl border border-fd-border bg-fd-card text-fd-foreground">
      {/* ── who is asking, and for what ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-fd-border bg-fd-muted/50 px-4 py-3">
        <span className="rounded-full bg-fd-primary/10 px-2.5 py-0.5 font-mono text-xs font-semibold text-fd-primary">
          @{preset.layer}
        </span>
        <span className="flex-1 text-sm font-semibold">{preset.title}</span>
        {showNetwork ? (
          <span
            role="group"
            aria-label="Where the API steps send their requests"
            className="inline-flex overflow-hidden rounded-md border border-fd-border text-xs"
          >
            {(['live', 'replay'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => {
                  setMode(value);
                  reset();
                }}
                className={`px-2 py-1 ${
                  mode === value
                    ? 'bg-fd-primary text-fd-primary-foreground'
                    : 'bg-fd-card text-fd-muted-foreground hover:bg-fd-accent'
                }`}
              >
                {value === 'live' ? 'Live sandbox' : 'Recorded'}
              </button>
            ))}
          </span>
        ) : null}
      </div>

      <div className="border-b border-fd-border px-4 py-3 text-sm">
        <p className="text-fd-muted-foreground">{preset.story}</p>
        <p className="mt-2 mb-1 text-xs font-semibold tracking-wide uppercase">Done means</p>
        <ul className="list-disc space-y-0.5 pl-5 text-fd-muted-foreground">
          {preset.acceptance.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      {/* ── the scenario, editable ── */}
      <div className="px-4 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wide uppercase">The scenario</span>
          <button
            type="button"
            onClick={() => {
              setSource(preset.gherkin);
              reset();
            }}
            className="text-xs text-fd-muted-foreground underline underline-offset-2 hover:text-fd-foreground"
          >
            restore the original
          </button>
        </div>
        <textarea
          value={source}
          spellCheck={false}
          onChange={(event) => {
            setSource(event.target.value);
            reset();
          }}
          rows={Math.min(20, Math.max(8, source.split('\n').length + 1))}
          aria-label="Gherkin scenario — edit and run it"
          className="w-full resize-y rounded-lg border border-fd-border bg-fd-background p-3 font-mono text-[12.5px] leading-relaxed outline-none focus:border-fd-primary"
        />
        {blocking.length > 0 ? (
          <ul className="mt-2 space-y-1 rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            {blocking.map((message) => (
              <li key={message}>sdods lint: {message}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-fd-muted-foreground">
            {tags.map((tag) => (
              <span key={tag} className="rounded bg-fd-muted px-1.5 py-0.5 font-mono">
                {tag}
              </span>
            ))}
            <span>· lint clean · {steps.length} steps</span>
          </p>
        )}
      </div>

      {/* ── controls ── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => void runAll()}
          disabled={busy}
          className="rounded-md bg-fd-primary px-3 py-1.5 text-sm font-semibold text-fd-primary-foreground disabled:opacity-50"
        >
          {busy ? 'Running…' : 'Run scenario'}
        </button>
        <button
          type="button"
          onClick={() => void runNext()}
          disabled={busy || cursor >= steps.length || verdict === 'failed'}
          className="rounded-md border border-fd-border px-3 py-1.5 text-sm font-medium hover:bg-fd-accent disabled:opacity-50"
        >
          Next step
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-fd-border px-3 py-1.5 text-sm font-medium hover:bg-fd-accent"
        >
          Reset
        </button>
        <span className="ml-auto font-mono text-xs text-fd-muted-foreground" aria-hidden="true">
          {Math.min(cursor, steps.length)} / {steps.length} steps · {elapsed} ms
        </span>
        {/* Running a scenario changes a dozen glyphs and no text. This is the one line that
            says what happened, and it only speaks when the run settles. */}
        <span role="status" className="sr-only">
          {verdict === 'idle'
            ? ''
            : verdict === 'running'
              ? `Running step ${Math.min(cursor, steps.length)} of ${steps.length}.`
              : `Scenario ${verdict}. ${counts.passed ?? 0} passed, ${(counts.failed ?? 0) + (counts.unknown ?? 0)} failed, ${counts.skipped ?? 0} skipped, in ${elapsed} milliseconds.`}
        </span>
      </div>

      {/* ── the stage ── */}
      <div className="border-y border-fd-border bg-fd-muted/30">
        <div
          role="tablist"
          aria-label="The stage"
          className="flex flex-wrap gap-1 px-4 pt-3 text-xs"
        >
          {showBrowser ? (
            <TabButton
              id="browser"
              active={activeTab === 'browser'}
              onSelect={setTab}
              tabs={openTabs}
            >
              Browser
            </TabButton>
          ) : null}
          {showNetwork ? (
            <TabButton
              id="network"
              active={activeTab === 'network'}
              onSelect={setTab}
              tabs={openTabs}
            >
              Request &amp; response {exchanges.length ? `(${exchanges.length})` : ''}
            </TabButton>
          ) : null}
          <TabButton id="report" active={activeTab === 'report'} onSelect={setTab} tabs={openTabs}>
            Run report
          </TabButton>
        </div>
        <div
          role="tabpanel"
          id={`stage-panel-${activeTab}`}
          aria-labelledby={`stage-tab-${activeTab}`}
          tabIndex={0}
          className="p-4"
        >
          {activeTab === 'browser' ? <BrowserPanel app={app} /> : null}
          {activeTab === 'network' ? <NetworkView exchanges={exchanges} /> : null}
          {activeTab === 'report' ? (
            <ReportView
              title={scenario?.name ?? 'No scenario'}
              tags={tags}
              layer={layer}
              steps={steps}
              runs={runs}
              elapsed={elapsed}
              counts={counts}
              verdict={verdict}
              command={preset.command}
            />
          ) : null}
        </div>
      </div>

      <TutorBar mood={tutor.mood} text={tutor.text} />

      {/* ── the run log ── */}
      <ol className="divide-y divide-fd-border border-t border-fd-border">
        {steps.map((step, index) => {
          const run = runs[index] ?? PENDING;
          return (
            <li key={`${step.line}-${step.text}`} className="px-4 py-2 text-sm">
              <div className="flex items-start gap-2">
                <span className={`mt-0.5 w-4 font-mono ${STATUS_STYLE[run.status]}`}>
                  <span aria-hidden="true">{STATUS_MARK[run.status]}</span>
                  <span className="sr-only">{STATUS_WORD[run.status]}: </span>
                </span>
                <span className="flex-1">
                  <span className="font-semibold text-fd-muted-foreground">{step.keyword} </span>
                  <span className="font-mono text-[12.5px]">{step.text}</span>
                  {run.detail ? (
                    <span className="mt-0.5 block text-xs text-fd-muted-foreground">
                      {run.detail}
                    </span>
                  ) : null}
                  {run.error ? (
                    <span className="mt-1 block rounded bg-rose-50 p-2 text-xs whitespace-pre-wrap text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                      {run.error}
                      {run.expected ? (
                        <span className="mt-1 block font-mono">
                          expected: {run.expected} · actual: {run.actual}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                  {run.evidence.length > 0 ? (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {run.evidence.map((item) => (
                        <span
                          key={item.label}
                          className="rounded bg-fd-muted px-1.5 py-0.5 font-mono text-[10.5px] text-fd-muted-foreground"
                        >
                          <span aria-hidden="true">
                            {item.kind === 'screenshot'
                              ? '📸'
                              : item.kind === 'request'
                                ? '📎'
                                : item.kind === 'locator'
                                  ? '🎯'
                                  : '𝑥'}
                          </span>{' '}
                          <span className="sr-only">{item.kind}: </span>
                          {item.label}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
                {run.ms !== undefined ? (
                  <span className="font-mono text-[11px] text-fd-muted-foreground">
                    {run.ms} ms
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {/* ── what to run for real, and what else you can say ── */}
      <div className="border-t border-fd-border px-4 py-3">
        <p className="text-xs text-fd-muted-foreground">Run the same scenario on your machine:</p>
        <pre
          tabIndex={0}
          role="region"
          aria-label="The same scenario as a command"
          className="mt-1 overflow-x-auto rounded-md bg-fd-muted p-2 font-mono text-xs"
        >
          {preset.command}
        </pre>
        <button
          type="button"
          onClick={() => setCatalogOpen((open) => !open)}
          aria-expanded={catalogOpen}
          aria-controls="playground-step-catalog"
          className="mt-3 text-xs font-medium text-fd-primary underline underline-offset-2"
        >
          {catalogOpen ? 'Hide' : 'Show'} the steps you can use here
        </button>
        {catalogOpen ? (
          <ul id="playground-step-catalog" className="mt-2 space-y-1">
            {stepsByLayer(layer).map((definition) => (
              <li key={definition.pattern}>
                <button
                  type="button"
                  onClick={() => insert(definition.pattern)}
                  className="w-full rounded px-1.5 py-1 text-left font-mono text-[11.5px] hover:bg-fd-accent"
                  title={`Defined in ${definition.source}`}
                >
                  <span className="text-fd-muted-foreground">{definition.keyword} </span>
                  {definition.pattern}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

type StageTab = 'browser' | 'network' | 'report';

/**
 * One tab of the stage. The selected tab is the only one in the tab order and the arrows walk
 * between them, which is what a tablist promises the moment it claims the role.
 */
function TabButton({
  id,
  active,
  onSelect,
  tabs,
  children,
}: {
  id: StageTab;
  active: boolean;
  onSelect: (tab: StageTab) => void;
  /** The tabs actually on screen — the layer tag decides which of the three exist. */
  tabs: StageTab[];
  children: React.ReactNode;
}) {
  function onKeyDown(event: React.KeyboardEvent) {
    const at = tabs.indexOf(id);
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? tabs[(at + 1) % tabs.length]
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? tabs[(at - 1 + tabs.length) % tabs.length]
          : event.key === 'Home'
            ? tabs[0]
            : event.key === 'End'
              ? tabs[tabs.length - 1]
              : undefined;
    if (!next || next === id) return;
    event.preventDefault();
    onSelect(next);
    document.getElementById(`stage-tab-${next}`)?.focus();
  }

  return (
    <button
      type="button"
      role="tab"
      id={`stage-tab-${id}`}
      aria-selected={active}
      aria-controls={`stage-panel-${id}`}
      tabIndex={active ? 0 : -1}
      onKeyDown={onKeyDown}
      onClick={() => onSelect(id)}
      className={`rounded-t-md border border-b-0 px-3 py-1.5 font-medium ${
        active
          ? 'border-fd-border bg-fd-card text-fd-foreground'
          : 'border-transparent text-fd-muted-foreground hover:text-fd-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function NetworkView({ exchanges }: { exchanges: Exchange[] }) {
  if (exchanges.length === 0)
    return (
      <p className="rounded-lg border border-dashed border-fd-border p-6 text-center text-sm text-fd-muted-foreground">
        No request yet. Every API step attaches its request and response here — the same two files
        the HTML report shows against the scenario.
      </p>
    );
  return (
    <div className="space-y-3">
      {exchanges.map((exchange, index) => (
        <div
          key={`${exchange.method}-${exchange.path}-${index}`}
          className="overflow-hidden rounded-lg border border-fd-border bg-fd-card"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-fd-border px-3 py-2 font-mono text-xs">
            <span className="font-semibold">{exchange.method}</span>
            <span className="flex-1 truncate text-fd-muted-foreground">{exchange.url}</span>
            <span
              className={
                exchange.status < 300
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }
            >
              {exchange.status}
            </span>
            <span className="text-fd-muted-foreground">{exchange.timeMs} ms</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                exchange.source === 'live'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'
              }`}
            >
              {exchange.source === 'live' ? 'live' : 'replayed'}
            </span>
          </div>
          {exchange.note ? (
            <p className="border-b border-fd-border bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              {exchange.note}
            </p>
          ) : null}
          {exchange.requestBody !== undefined ? (
            <div className="border-b border-fd-border px-3 py-2">
              <p className="mb-1 font-mono text-[10.5px] text-fd-muted-foreground">request.json</p>
              <pre className="overflow-x-auto text-[11.5px]">{pretty(exchange.requestBody)}</pre>
            </div>
          ) : null}
          <div className="px-3 py-2">
            <p className="mb-1 font-mono text-[10.5px] text-fd-muted-foreground">response.json</p>
            <pre className="max-h-64 overflow-auto text-[11.5px]">{pretty(exchange.body)}</pre>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReportView({
  title,
  tags,
  layer,
  steps,
  runs,
  elapsed,
  counts,
  verdict,
  command,
}: {
  title: string;
  tags: string[];
  layer: StepLayer;
  steps: ParsedStep[];
  runs: StepRun[];
  elapsed: number;
  counts: Record<StepStatus, number>;
  verdict: 'idle' | 'running' | 'passed' | 'failed';
  command: string;
}) {
  const failed = (counts.failed ?? 0) + (counts.unknown ?? 0);
  const attachments = runs.flatMap((run) => run.evidence);
  return (
    <div className="overflow-hidden rounded-lg border border-fd-border bg-fd-card">
      <div
        className={`px-4 py-3 ${
          verdict === 'failed'
            ? 'bg-rose-100 dark:bg-rose-950/50'
            : verdict === 'passed'
              ? 'bg-emerald-100 dark:bg-emerald-950/50'
              : 'bg-fd-muted'
        }`}
      >
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 font-mono text-xs text-fd-muted-foreground">
          {tags.join(' ')} · target demo-shop--{layer} · staging
        </p>
        <p className="mt-2 font-mono text-xs">
          {verdict === 'idle' ? 'not run yet' : verdict === 'running' ? 'running…' : verdict} ·{' '}
          {counts.passed ?? 0} passed · {failed} failed · {counts.skipped ?? 0} skipped · {elapsed}{' '}
          ms
        </p>
      </div>
      <ol className="divide-y divide-fd-border">
        {steps.map((step, index) => {
          const run = runs[index] ?? PENDING;
          return (
            <li
              key={`${step.line}-report`}
              className="flex items-baseline gap-2 px-4 py-1.5 font-mono text-[11.5px]"
            >
              <span className={STATUS_STYLE[run.status]}>
                <span aria-hidden="true">{STATUS_MARK[run.status]}</span>
                <span className="sr-only">{STATUS_WORD[run.status]}: </span>
              </span>
              <span className="flex-1 truncate">
                {step.keyword} {step.text}
              </span>
              <span className="text-fd-muted-foreground">
                {run.ms === undefined ? '—' : `${run.ms} ms`}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="border-t border-fd-border px-4 py-3 text-xs text-fd-muted-foreground">
        <p>
          {attachments.length} attachment{attachments.length === 1 ? '' : 's'} on this scenario.{' '}
          <code className="font-mono">{command}</code> writes the same summary to the HTML report
          and the run viewer, with screenshots and the request and response files.
        </p>
      </div>
    </div>
  );
}

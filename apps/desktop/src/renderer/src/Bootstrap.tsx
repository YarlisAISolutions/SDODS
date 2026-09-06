/**
 * The only screen this renderer owns: what the user looks at before the SDODS server exists.
 *
 * It shows the install as stages, each with its own steps, and one overall percentage. That is a
 * deliberate replacement for streaming npm's output as the primary content — several hundred
 * `npm http fetch` lines say nothing about whether an install is healthy, and on a slow machine
 * they scroll for minutes. The raw log is still here, behind a disclosure, because it is exactly
 * what you want when something fails.
 *
 * When it does fail, the failing stage stays marked and the captured child output is shown
 * directly: the likely causes (offline, corporate proxy, private registry) are all things the
 * user can act on once they can see them.
 */
import { useEffect, useRef, useState } from 'react';
import { STAGES, isStageComplete, type Progress, type StageId } from '../../shared/stages.js';

interface Failure {
  message: string;
  detail: string;
}

/** Which steps within the active stage are already behind us. */
function stepIndex(stage: StageId, step: string): number {
  return STAGES.find((s) => s.id === stage)?.steps.findIndex((x) => x.id === step) ?? -1;
}

export function Bootstrap() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [info, setInfo] = useState<{ workspace: string; version: string } | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const offProgress = window.sdods.onProgress((p: Progress) => {
      // A detail-only event carries a log line and no sentence; it must not blank the message.
      setProgress((prev) => (p.message ? p : prev ? { ...prev, percent: p.percent } : p));
      if (p.detail) setLines((prev) => [...prev.slice(-500), p.detail!]);
    });
    const offError = window.sdods.onError((e: Failure) => setFailure(e));
    const offLog = window.sdods.onServerLog((line: string) =>
      setLines((prev) => [...prev.slice(-500), line]),
    );
    void window.sdods.info().then(setInfo);
    return () => {
      offProgress();
      offError();
      offLog();
    };
  }, []);

  useEffect(() => {
    if (showLog) logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines, showLog]);

  const retry = () => {
    setFailure(null);
    setLines([]);
    setProgress(null);
    void window.sdods.retry();
  };

  const percent = progress?.percent ?? 0;
  const activeStage = progress?.stage ?? 'prepare';

  return (
    <main className="shell">
      <header>
        <h1>SDODS</h1>
        <p className="tagline">
          {failure
            ? 'Setup could not finish'
            : percent >= 100
              ? 'Ready'
              : 'Setting things up — this only happens once.'}
        </p>
      </header>

      <section className="progress" aria-live="polite">
        <div className="progress-head">
          <span className="progress-message">
            {failure ? 'Stopped' : (progress?.message ?? 'Starting…')}
          </span>
          <span className="progress-percent">{percent}%</span>
        </div>
        <div
          className={`bar${failure ? ' bar-failed' : ''}`}
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Installation progress"
        >
          <div className="bar-fill" style={{ width: `${percent}%` }} />
        </div>
      </section>

      <ol className="stages">
        {STAGES.map((stage) => {
          const done = isStageComplete(stage.id, activeStage) || percent >= 100;
          const active = stage.id === activeStage && !done;
          const failed = failure !== null && stage.id === activeStage;
          const state = failed ? 'failed' : done ? 'done' : active ? 'active' : 'pending';
          const at = active && progress ? stepIndex(stage.id, progress.step) : -1;

          return (
            <li key={stage.id} className={state}>
              <span className="marker" aria-hidden>
                {state === 'done' ? '✓' : state === 'failed' ? '✕' : ''}
              </span>
              <div className="stage-body">
                <p className="stage-title">{stage.title}</p>
                {/* Steps are only worth showing for the stage in flight; listing every step of
                    every stage turns a status display into a wall of text. */}
                {active && (
                  <ul className="steps">
                    {stage.steps.map((step, i) => (
                      <li
                        key={step.id}
                        className={i < at ? 'done' : i === at ? 'current' : 'pending'}
                      >
                        {step.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {failure && (
        <section className="error">
          <p className="what">{failure.message}</p>
          {failure.detail && <pre className="detail">{failure.detail}</pre>}
          <button onClick={retry}>Try again</button>
        </section>
      )}

      {lines.length > 0 && (
        <details
          className="log-details"
          open={showLog}
          onToggle={(e) => setShowLog(e.currentTarget.open)}
        >
          <summary>Details ({lines.length} lines)</summary>
          <pre className="log" ref={logRef}>
            {lines.join('\n')}
          </pre>
        </details>
      )}

      {info && (
        <footer>
          <span>{info.workspace}</span>
          <span>v{info.version}</span>
        </footer>
      )}
    </main>
  );
}

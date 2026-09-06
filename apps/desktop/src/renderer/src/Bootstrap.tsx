/**
 * The only screen this renderer owns: what the user looks at before the SDODS server exists.
 *
 * Two jobs. Show that something is happening — a first install can take minutes when antivirus is
 * scanning every extracted file, and silence reads as "hung". And when it fails, show the actual
 * child-process output rather than a shrug, because the likely causes (offline, corporate proxy,
 * private registry) are all things the user can act on once they can see them.
 */
import { useEffect, useRef, useState } from 'react';

type Phase = 'checking' | 'installing-cli' | 'scaffolding' | 'installing-deps' | 'done' | 'failed';

interface Progress {
  phase: string;
  message: string;
  detail?: string;
}
interface Failure {
  message: string;
  detail: string;
}

const STEPS: { phase: Phase; label: string }[] = [
  { phase: 'installing-cli', label: 'Downloading SDODS' },
  { phase: 'scaffolding', label: 'Creating your workspace' },
  { phase: 'installing-deps', label: 'Installing test dependencies' },
  { phase: 'done', label: 'Starting the server' },
];

const order = (p: string) => STEPS.findIndex((s) => s.phase === p);

export function Bootstrap() {
  const [phase, setPhase] = useState<string>('checking');
  const [message, setMessage] = useState('Starting SDODS…');
  const [lines, setLines] = useState<string[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [info, setInfo] = useState<{ workspace: string; version: string } | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const offProgress = window.sdods.onProgress((p: Progress) => {
      setPhase(p.phase);
      if (p.message) setMessage(p.message);
      if (p.detail) setLines((prev) => [...prev.slice(-400), p.detail!]);
    });
    const offError = window.sdods.onError((e: Failure) => {
      setFailure(e);
      setPhase('failed');
    });
    const offLog = window.sdods.onServerLog((line: string) =>
      setLines((prev) => [...prev.slice(-400), line]),
    );
    void window.sdods.info().then(setInfo);
    return () => {
      offProgress();
      offError();
      offLog();
    };
  }, []);

  // Follow the tail as output arrives.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  const retry = () => {
    setFailure(null);
    setLines([]);
    setPhase('checking');
    setMessage('Retrying…');
    void window.sdods.retry();
  };

  const current = order(phase);

  return (
    <main className="shell">
      <header>
        <h1>SDODS</h1>
        <p className="tagline">
          {failure ? 'Setup could not finish' : 'Setting things up — this only happens once.'}
        </p>
      </header>

      {!failure && (
        <>
          <ol className="steps">
            {STEPS.map((s, i) => {
              const state =
                current < 0
                  ? 'pending'
                  : i < current
                    ? 'done'
                    : i === current
                      ? 'active'
                      : 'pending';
              return (
                <li key={s.phase} className={state}>
                  <span className="dot" aria-hidden />
                  {s.label}
                </li>
              );
            })}
          </ol>
          <p className="status">{message}</p>
        </>
      )}

      {failure && (
        <section className="error">
          <p className="what">{failure.message}</p>
          {failure.detail && <pre className="detail">{failure.detail}</pre>}
          <button onClick={retry}>Try again</button>
        </section>
      )}

      {lines.length > 0 && (
        <pre className="log" ref={logRef}>
          {lines.join('\n')}
        </pre>
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

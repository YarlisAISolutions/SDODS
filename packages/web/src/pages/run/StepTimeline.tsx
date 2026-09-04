import type { AttemptView } from '../../api/types';
import { Badge } from '../../components/ui';
import { StepCard } from './StepCard';
import { ScreenshotCompare } from './ScreenshotCompare';

export function StepTimeline({
  attempt,
  projectSlug,
  fingerprint,
}: {
  attempt: AttemptView;
  projectSlug: string;
  fingerprint: string;
}) {
  return (
    <div className="space-y-4">
      {(attempt.scenarioStart || attempt.scenarioEnd) && (
        <section className="panel p-3">
          <div className="mb-2 text-xs font-medium">
            Scenario <Badge>start</Badge> ↔ <Badge>end</Badge>
          </div>
          <ScreenshotCompare
            before={attempt.scenarioStart}
            after={attempt.scenarioEnd}
            labels={['start', 'end']}
            storageKey="compare-mode-scenario"
          />
        </section>
      )}
      <ol className="relative space-y-3 border-l border-line pl-1">
        {attempt.steps.map((s) => (
          <StepCard key={s.id} step={s} projectSlug={projectSlug} fingerprint={fingerprint} />
        ))}
      </ol>
      {attempt.failure && (
        <section className="panel p-3">
          <div className="mb-2 text-xs font-medium text-red-600">Failure screenshot</div>
          <img
            src={attempt.failure.url}
            alt="failure"
            className="w-full rounded border border-line"
          />
        </section>
      )}
      <section className="flex flex-wrap gap-2 text-xs">
        {attempt.trace && (
          <a
            className="text-brand-600 hover:underline"
            href={`/trace/index.html?trace=${encodeURIComponent(attempt.trace.url)}`}
            target="_blank"
            rel="noreferrer"
          >
            Open trace viewer
          </a>
        )}
        {attempt.video && (
          <a
            className="text-brand-600 hover:underline"
            href={attempt.video.url}
            target="_blank"
            rel="noreferrer"
          >
            Video
          </a>
        )}
      </section>
    </div>
  );
}

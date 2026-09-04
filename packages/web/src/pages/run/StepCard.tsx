import { useState } from 'react';
import { Link } from 'react-router';
import type { StepView } from '../../api/types';
import { Badge, Button, StatusPill } from '../../components/ui';
import { fmtDuration } from '../../lib/utils';
import { ScreenshotCompare } from './ScreenshotCompare';
import { ApiPanel } from './ApiPanel';

export function StepCard({
  step,
  projectSlug,
  fingerprint,
}: {
  step: StepView;
  projectSlug: string;
  fingerprint: string;
}) {
  const [showStack, setShowStack] = useState(false);
  return (
    <li className="relative pl-6" data-testid={`step-${step.stepIndex}`}>
      <span
        className={`absolute left-0 top-2 h-3 w-3 rounded-full border-2 border-[var(--panel)] ${step.status === 'passed' ? 'bg-green-500' : step.status === 'failed' ? 'bg-red-500' : step.status === 'skipped' ? 'bg-amber-400' : 'bg-slate-400'}`}
      />
      <div className="panel p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="muted w-6 text-right text-xs">
            {step.kind === 'hook' ? step.hookType : step.stepIndex + 1}
          </span>
          <span className="font-semibold text-brand-600">
            {step.keyword ?? (step.kind === 'hook' ? 'Hook' : '')}
          </span>
          <span className="min-w-0 flex-1">{step.text}</span>
          <StatusPill status={step.status} />
          <span className="muted text-xs">{fmtDuration(step.durationMs)}</span>
          {step.layerHint && (
            <Badge tone={step.layerHint === 'api' ? 'purple' : 'blue'}>{step.layerHint}</Badge>
          )}
        </div>
        {step.argument != null && (
          <pre className="mono panel-2 mt-2 max-h-40 overflow-auto rounded p-2 text-[11px]">
            {typeof step.argument === 'string'
              ? step.argument
              : JSON.stringify(step.argument, null, 2)}
          </pre>
        )}
        {step.definitionLocation && (
          <div className="muted mt-1 text-[11px] mono">{step.definitionLocation}</div>
        )}
        {step.errorMessage && (
          <div className="mt-2 rounded border border-red-500/40 bg-red-500/5 p-2 text-xs">
            <div className="whitespace-pre-wrap font-medium text-red-600">{step.errorMessage}</div>
            {step.errorStack && (
              <>
                <button
                  type="button"
                  className="muted mt-1 hover:underline"
                  onClick={() => setShowStack(!showStack)}
                >
                  {showStack ? 'hide' : 'show'} stack
                </button>
                {showStack && (
                  <pre className="mono mt-1 max-h-48 overflow-auto whitespace-pre-wrap">
                    {step.errorStack}
                  </pre>
                )}
              </>
            )}
          </div>
        )}
        {step.heals.map((h, i) => (
          <div
            key={i}
            className="mt-2 rounded border border-amber-500/50 bg-amber-500/10 p-2 text-xs"
            data-testid="heal-callout"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="amber">healed</Badge>
              <span>
                <span className="mono">{h.originalSelector}</span> →{' '}
                <span className="mono">{h.healedSelector}</span> via <b>{h.strategyUsed}</b> (
                {h.durationMs} ms)
              </span>
              <Link
                to={`/agents?kind=heal&project=${projectSlug}&scenario=${fingerprint}`}
                className="ml-auto"
              >
                <Button size="sm">Propose fix</Button>
              </Link>
            </div>
            <div className="muted mt-1">
              candidates:{' '}
              {h.candidates.map((c) => `${c.strategy} ${c.score.toFixed(2)}`).join(' · ')}
            </div>
          </div>
        ))}
        {(step.before || step.after) && (
          <div className="mt-3">
            <ScreenshotCompare before={step.before} after={step.after} />
          </div>
        )}
        {step.visual && (
          <div className="mt-3">
            <div className="mb-1 text-xs font-medium">
              Visual baseline <span className="mono">{step.visual.name}</span>
            </div>
            <ScreenshotCompare
              before={step.visual.expected}
              after={step.visual.actual}
              labels={['expected', 'actual']}
              defaultMode="diff"
              storageKey="compare-mode-visual"
            />
          </div>
        )}
        {step.apiSnapshot && (
          <div className="mt-3">
            <ApiPanel snapshot={step.apiSnapshot} />
          </div>
        )}
      </div>
    </li>
  );
}

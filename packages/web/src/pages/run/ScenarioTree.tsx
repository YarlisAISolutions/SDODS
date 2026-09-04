import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { ScenarioNode } from '../../api/types';
import { Badge, Input, Select, StatusPill } from '../../components/ui';
import { fmtDuration } from '../../lib/utils';

export interface TreeGroup {
  module: string;
  features: Array<{ featureUri: string; featureName: string; scenarios: ScenarioNode[] }>;
}

/** Group scenarios MODULE → feature → scenario (pure; unit-tested). */
export function groupScenarios(scenarios: ScenarioNode[]): TreeGroup[] {
  const byModule = new Map<
    string,
    Map<string, { featureUri: string; featureName: string; scenarios: ScenarioNode[] }>
  >();
  for (const s of scenarios) {
    const m = s.module ?? '(no module)';
    const feats = byModule.get(m) ?? new Map();
    const f = feats.get(s.featureUri) ?? {
      featureUri: s.featureUri,
      featureName: s.featureName,
      scenarios: [],
    };
    f.scenarios.push(s);
    feats.set(s.featureUri, f);
    byModule.set(m, feats);
  }
  return [...byModule.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([module, feats]) => ({
      module,
      features: [...feats.values()].sort((a, b) => a.featureUri.localeCompare(b.featureUri)),
    }));
}

export function ScenarioTree({ runId, scenarios }: { runId: string; scenarios: ScenarioNode[] }) {
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState('');
  const [browser, setBrowser] = useState('');
  const browsers = useMemo(
    () => [...new Set(scenarios.map((s) => s.browser ?? s.layer))],
    [scenarios],
  );
  const visible = useMemo(
    () =>
      scenarios.filter(
        (s) =>
          (!filter ||
            `${s.featureName} ${s.scenarioName} ${s.tags.join(' ')}`
              .toLowerCase()
              .includes(filter.toLowerCase())) &&
          (!status || (status === 'flaky' ? s.flaky : s.status === status)) &&
          (!browser || (s.browser ?? s.layer) === browser),
      ),
    [scenarios, filter, status, browser],
  );
  const groups = useMemo(() => groupScenarios(visible), [visible]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input
          className="w-64"
          placeholder="filter by feature, scenario or tag"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="filter scenarios"
        />
        <Select
          className="w-36"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="status"
        >
          <option value="">Any status</option>
          {['passed', 'failed', 'skipped', 'flaky'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
        <Select
          className="w-40"
          value={browser}
          onChange={(e) => setBrowser(e.target.value)}
          aria-label="browser"
        >
          <option value="">Any browser</option>
          {browsers.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </Select>
        <span className="muted self-center text-xs">
          {visible.length} of {scenarios.length}
        </span>
      </div>
      {groups.map((g) => (
        <section key={g.module} className="panel" data-testid={`module-${g.module}`}>
          <header className="panel-2 flex items-center justify-between rounded-t-[10px] px-3 py-1.5 text-sm">
            <span className="flex items-center gap-2">
              <Badge tone="purple">module</Badge>{' '}
              <span className="mono font-medium">{g.module}</span>
            </span>
            <span className="muted text-xs">
              {g.features.reduce((n, f) => n + f.scenarios.length, 0)} scenarios
            </span>
          </header>
          {g.features.map((f) => (
            <div key={f.featureUri} className="border-t border-line">
              <div className="flex items-center gap-2 px-3 py-1 text-xs">
                <span className="font-medium">{f.featureName}</span>
                <span className="mono muted">{f.featureUri}</span>
              </div>
              <ul>
                {f.scenarios.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center gap-2 border-t border-line/60 px-3 py-1.5 text-sm hover:bg-[var(--panel-2)]"
                  >
                    <StatusPill status={s.status} />
                    <Link
                      to={`/runs/${runId}/scenarios/${s.id}`}
                      className="min-w-0 flex-1 truncate hover:underline"
                    >
                      {s.scenarioName}
                      {s.exampleIndex != null && (
                        <span className="muted"> · example {s.exampleIndex + 1}</span>
                      )}
                    </Link>
                    <span className="flex shrink-0 items-center gap-1">
                      {s.flaky && <Badge tone="amber">flaky</Badge>}
                      {s.healed > 0 && <Badge tone="amber">healed ×{s.healed}</Badge>}
                      {s.visual && <Badge tone="blue">visual</Badge>}
                      {s.jiraKeys.map((k) => (
                        <Badge key={k} tone="amber" title="Jira link">
                          {k}
                        </Badge>
                      ))}
                      <Badge>{s.browser ?? s.layer}</Badge>
                      {s.attemptsCount > 1 && <Badge>{s.attemptsCount} attempts</Badge>}
                      <span className="muted w-14 text-right text-xs">
                        {fmtDuration(s.durationMs)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
      {groups.length === 0 && <div className="muted text-xs">No scenarios match.</div>}
    </div>
  );
}

import { useState } from 'react';
import type { ApiSnapshot } from '../../api/types';
import { Badge, Button } from '../../components/ui';
import { copyToClipboard, toCurl } from '../../lib/utils';
import { useToast } from '../../components/ui/Toast';

export function ApiPanel({ snapshot }: { snapshot: ApiSnapshot }) {
  const { toast } = useToast();
  const [tab, setTab] = useState<'response' | 'request'>('response');
  const s = snapshot;
  const tone = s.response.status < 300 ? 'green' : s.response.status < 500 ? 'amber' : 'red';
  return (
    <div className="panel-2 rounded-md p-2 text-xs" data-testid="api-panel">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="blue">{s.request.method}</Badge>
        <span className="mono min-w-0 flex-1 truncate">{s.request.url}</span>
        <Badge tone={tone}>
          {s.response.status} {s.response.statusText}
        </Badge>
        <span className="muted">{s.response.responseTime} ms</span>
        {s.replayedFromHar && <Badge tone="purple">HAR replay</Badge>}
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            copyToClipboard(toCurl(s.request)).then(() => toast('curl copied', 'success'))
          }
        >
          copy as curl
        </Button>
      </div>
      <div className="mt-2 flex gap-1">
        {(['response', 'request'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded px-2 py-0.5 ${tab === t ? 'bg-brand-500/20 font-medium' : 'muted'}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div>
          <div className="muted mb-1">headers</div>
          <JsonTree value={tab === 'response' ? s.response.headers : s.request.headers} />
          {tab === 'request' && s.request.query && (
            <>
              <div className="muted mb-1 mt-2">query</div>
              <JsonTree value={s.request.query} />
            </>
          )}
        </div>
        <div>
          <div className="muted mb-1">body</div>
          <JsonTree value={tab === 'response' ? s.response.body : (s.request.body ?? null)} />
        </div>
      </div>
    </div>
  );
}

export function JsonTree({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  if (value === null || value === undefined) return <span className="muted mono">null</span>;
  if (typeof value !== 'object')
    return <span className="mono">{typeof value === 'string' ? `"${value}"` : String(value)}</span>;
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const isArr = Array.isArray(value);
  if (entries.length === 0) return <span className="mono">{isArr ? '[]' : '{}'}</span>;
  return (
    <div className="mono">
      <button
        type="button"
        className="muted hover:text-[var(--text)]"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? '▾' : '▸'} {isArr ? `[${entries.length}]` : `{${entries.length}}`}
      </button>
      {open && (
        <div className="ml-3 border-l border-line pl-2">
          {entries.map(([k, v]) => (
            <div key={k} className="flex gap-1">
              <span className="text-brand-600">{k}:</span>
              <JsonTree value={v} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

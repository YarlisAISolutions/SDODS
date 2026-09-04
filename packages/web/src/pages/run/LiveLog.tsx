import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useQueryClient } from '@tanstack/react-query';
import { useSse } from '../../api/sse';
import { Badge } from '../../components/ui';
import { cn } from '../../lib/utils';

interface LogLine {
  t: number;
  stream: 'out' | 'err';
  line: string;
}

export function LiveLog({ runId, live }: { runId: string; live: boolean }) {
  const qc = useQueryClient();
  const [lines, setLines] = useState<LogLine[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [follow, setFollow] = useState(true);
  const { connected } = useSse<any>(`/api/runs/${runId}/events`, {
    enabled: true,
    onMessage: (m) => {
      if (m.event === 'log') setLines((l) => [...l, m.data as LogLine]);
      else if (m.event === 'progress') setProgress(m.data as { done: number; total: number });
      else if (m.event === 'ingested' || m.event === 'done')
        void qc.invalidateQueries({ queryKey: ['run', runId] });
    },
  });
  const parentRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 20,
  });
  useEffect(() => {
    if (follow && lines.length) v.scrollToIndex(lines.length - 1);
  }, [lines.length, follow, v]);
  return (
    <div className="panel flex h-[60vh] min-h-[320px] flex-col">
      <div className="panel-2 flex items-center gap-3 rounded-t-[10px] px-3 py-1.5 text-xs">
        <Badge tone={connected ? 'green' : live ? 'amber' : 'neutral'}>
          {connected ? 'live' : live ? 'reconnecting…' : 'finished'}
        </Badge>
        {progress && (
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-40 rounded bg-slate-500/20">
              <span
                className="block h-1.5 rounded bg-brand-500"
                style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
              />
            </span>
            {progress.done}/{progress.total}
          </span>
        )}
        <label className="ml-auto flex items-center gap-1">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />{' '}
          follow
        </label>
        <span className="muted">{lines.length} lines</span>
      </div>
      <div
        ref={parentRef}
        className="mono min-h-0 flex-1 overflow-auto p-2 scrollbar-thin"
        onScroll={() => {}}
      >
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((it) => {
            const l = lines[it.index]!;
            return (
              <div
                key={it.key}
                className={cn(
                  'absolute left-0 top-0 w-full whitespace-pre',
                  l.stream === 'err' && 'text-red-500',
                )}
                style={{ transform: `translateY(${it.start}px)` }}
              >
                {l.line}
              </div>
            );
          })}
        </div>
        {lines.length === 0 && <div className="muted">Waiting for output…</div>}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ArtifactRef } from '../../api/types';
import { useCompare } from '../../api/queries';
import { Badge, Button } from '../../components/ui';
import { cn, readPref, writePref } from '../../lib/utils';

export type CompareMode = 'slider' | 'overlay' | 'side-by-side' | 'diff';
export const COMPARE_MODES: CompareMode[] = ['slider', 'overlay', 'side-by-side', 'diff'];

export function ScreenshotCompare({
  before,
  after,
  labels = ['before', 'after'],
  defaultMode,
  storageKey = 'compare-mode',
}: {
  before?: ArtifactRef;
  after?: ArtifactRef;
  labels?: [string, string];
  defaultMode?: CompareMode;
  storageKey?: string;
}) {
  const [mode, setModeState] = useState<CompareMode>(
    () => defaultMode ?? readPref<CompareMode>(storageKey, 'slider'),
  );
  const setMode = (m: CompareMode) => {
    setModeState(m);
    writePref(storageKey, m);
  };
  const [x, setX] = useState(50);
  const [opacity, setOpacity] = useState(0.5);
  const [onion, setOnion] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const compare = useCompare(before?.id, after?.id, mode === 'diff');
  const w = Math.max(before?.width ?? 1280, after?.width ?? 1280);
  const h = Math.max(before?.height ?? 720, after?.height ?? 720);
  const ratio = (h / w) * 100;
  const dragging = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);

  if (!before && !after) return <div className="muted text-xs">No screenshots for this step.</div>;
  if (!before || !after) {
    const only = before ?? after!;
    return (
      <figure>
        <img src={only.url} alt={only.fileName} className="w-full rounded border border-line" />
        <figcaption className="muted text-[11px]">{only.fileName}</figcaption>
      </figure>
    );
  }

  const onPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current && e.type !== 'pointerdown') return;
    const rect = boxRef.current!.getBoundingClientRect();
    setX(Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)));
  };

  return (
    <div className="space-y-2" data-testid="screenshot-compare">
      <div
        className="flex flex-wrap items-center gap-2 text-xs"
        role="tablist"
        aria-label="comparison mode"
      >
        {COMPARE_MODES.map((m) => (
          <Button
            key={m}
            size="sm"
            role="tab"
            aria-selected={mode === m}
            variant={mode === m ? 'primary' : 'default'}
            onClick={() => setMode(m)}
          >
            {m}
          </Button>
        ))}
        {mode === 'overlay' && (
          <>
            <label className="ml-2 flex items-center gap-1">
              opacity{' '}
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                aria-label="overlay opacity"
              />
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={onion} onChange={(e) => setOnion(e.target.checked)} />{' '}
              onion skin (difference)
            </label>
          </>
        )}
        {mode === 'side-by-side' && (
          <label className="ml-2 flex items-center gap-1">
            zoom{' '}
            <input
              type="range"
              min={1}
              max={4}
              step={0.25}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              aria-label="zoom"
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
            >
              reset
            </Button>
          </label>
        )}
        {mode === 'diff' && compare.data && (
          <Badge
            tone={compare.data.mismatchRatio > 0.01 ? 'amber' : 'green'}
            title={`${compare.data.mismatchPixels} pixels differ`}
          >
            {(compare.data.mismatchRatio * 100).toFixed(2)}% mismatch
          </Badge>
        )}
        <span className="muted ml-auto">
          {labels[0]} ↔ {labels[1]}
        </span>
      </div>

      {mode === 'slider' && (
        <div
          ref={boxRef}
          className="relative w-full select-none overflow-hidden rounded border border-line bg-black/5"
          style={{ paddingTop: `${ratio}%` }}
          onPointerDown={(e) => {
            dragging.current = true;
            (e.target as Element).setPointerCapture?.(e.pointerId);
            onPointer(e);
          }}
          onPointerMove={onPointer}
          onPointerUp={() => (dragging.current = false)}
          onPointerLeave={() => (dragging.current = false)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setX((v) => Math.max(0, v - 2));
            if (e.key === 'ArrowRight') setX((v) => Math.min(100, v + 2));
          }}
          tabIndex={0}
          role="slider"
          aria-valuenow={Math.round(x)}
          aria-label="before/after slider"
        >
          <img
            src={before.url}
            alt={labels[0]}
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
          />
          <img
            src={after.url}
            alt={labels[1]}
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
            style={{ clipPath: `inset(0 ${100 - x}% 0 0)` }}
          />
          <div className="absolute bottom-0 top-0 w-0.5 bg-brand-500" style={{ left: `${x}%` }}>
            <div className="absolute top-1/2 -ml-3 h-6 w-6 -translate-y-1/2 rounded-full border-2 border-white bg-brand-500 shadow" />
          </div>
          <span className="absolute left-2 top-2 rounded bg-black/60 px-1 text-[10px] text-white">
            {labels[1]}
          </span>
          <span className="absolute right-2 top-2 rounded bg-black/60 px-1 text-[10px] text-white">
            {labels[0]}
          </span>
        </div>
      )}

      {mode === 'overlay' && (
        <div
          className="relative w-full overflow-hidden rounded border border-line"
          style={{ paddingTop: `${ratio}%` }}
        >
          <img
            src={before.url}
            alt={labels[0]}
            className="absolute inset-0 h-full w-full object-contain"
          />
          <img
            src={after.url}
            alt={labels[1]}
            className="absolute inset-0 h-full w-full object-contain"
            style={{ opacity: onion ? 1 : opacity, mixBlendMode: onion ? 'difference' : 'normal' }}
          />
        </div>
      )}

      {mode === 'side-by-side' && (
        <SideBySide
          before={before}
          after={after}
          labels={labels}
          zoom={zoom}
          pan={pan}
          setPan={setPan}
          ratio={ratio}
        />
      )}

      {mode === 'diff' && (
        <div className="grid gap-2 md:grid-cols-3">
          {compare.isLoading && <div className="muted text-xs">Computing diff…</div>}
          {compare.error && (
            <div className="text-xs text-red-500">{(compare.error as Error).message}</div>
          )}
          {compare.data && (
            <>
              <Img src={compare.data.before.url} label={labels[0]} />
              <Img src={compare.data.after.url} label={labels[1]} />
              <Img src={compare.data.diff.url} label="diff" />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Img({ src, label }: { src: string; label: string }) {
  return (
    <figure className="min-w-0">
      <img src={src} alt={label} className="w-full rounded border border-line" />
      <figcaption className="muted text-[11px]">{label}</figcaption>
    </figure>
  );
}

function SideBySide({
  before,
  after,
  labels,
  zoom,
  pan,
  setPan,
  ratio,
}: {
  before: ArtifactRef;
  after: ArtifactRef;
  labels: [string, string];
  zoom: number;
  pan: { x: number; y: number };
  setPan: (p: { x: number; y: number }) => void;
  ratio: number;
}) {
  const drag = useRef<{ x: number; y: number } | null>(null);
  const style = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
    transformOrigin: '0 0',
  } as const;
  useEffect(() => {
    if (zoom === 1) setPan({ x: 0, y: 0 });
  }, [zoom]);
  const pane = (a: ArtifactRef, label: string) => (
    <div
      className={cn(
        'relative w-full cursor-grab overflow-hidden rounded border border-line',
        drag.current && 'cursor-grabbing',
      )}
      style={{ paddingTop: `${ratio}%` }}
      onPointerDown={(e) => (drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y })}
      onPointerMove={(e) =>
        drag.current && setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y })
      }
      onPointerUp={() => (drag.current = null)}
      onPointerLeave={() => (drag.current = null)}
    >
      <img
        src={a.url}
        alt={label}
        className="absolute inset-0 h-full w-full object-contain"
        style={style}
        draggable={false}
      />
      <span className="absolute left-2 top-2 rounded bg-black/60 px-1 text-[10px] text-white">
        {label}
      </span>
    </div>
  );
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {pane(before, labels[0])}
      {pane(after, labels[1])}
    </div>
  );
}

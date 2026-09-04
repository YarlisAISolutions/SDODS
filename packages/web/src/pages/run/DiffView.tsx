import { classifyDiffLine, cn } from '../../lib/utils';

export function DiffView({ text }: { text?: string }) {
  if (!text) return <div className="muted text-xs">No diff.</div>;
  return (
    <pre className="mono max-h-[60vh] overflow-auto rounded border border-line text-[12px] leading-5">
      {text.split('\n').map((line, i) => {
        const k = classifyDiffLine(line);
        return (
          <div
            key={i}
            className={cn(
              'px-2 whitespace-pre',
              k === 'add' && 'bg-green-500/15 text-green-700 dark:text-green-300',
              k === 'del' && 'bg-red-500/15 text-red-700 dark:text-red-300',
              k === 'hunk' && 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
              k === 'meta' && 'muted',
            )}
          >
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}

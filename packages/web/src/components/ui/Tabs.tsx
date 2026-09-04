import * as RadixTabs from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export function Tabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: Array<{ value: string; label: ReactNode; content: ReactNode; count?: number }>;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <RadixTabs.Root
      value={value}
      onValueChange={onChange}
      className={cn('flex min-h-0 flex-col', className)}
    >
      <RadixTabs.List className="mb-3 flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <RadixTabs.Trigger
            key={t.value}
            value={t.value}
            className="-mb-px border-b-2 border-transparent px-3 py-1.5 text-sm muted hover:text-[var(--text)] data-[state=active]:border-brand-500 data-[state=active]:text-[var(--text)]"
          >
            {t.label}
            {t.count != null && (
              <span className="ml-1 rounded bg-slate-500/15 px-1 text-[10px]">{t.count}</span>
            )}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {tabs.map((t) => (
        <RadixTabs.Content key={t.value} value={t.value} className="min-h-0 flex-1 outline-none">
          {t.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}

import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <RadixDialog.Content
          className={cn(
            'panel fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(96vw,var(--w))] -translate-x-1/2 -translate-y-1/2 overflow-auto p-5 shadow-2xl',
          )}
          style={{ ['--w' as string]: wide ? '960px' : '560px' }}
        >
          <RadixDialog.Title className="text-base font-semibold">{title}</RadixDialog.Title>
          {description && (
            <RadixDialog.Description className="muted mt-1 text-xs">
              {description}
            </RadixDialog.Description>
          )}
          <div className="mt-4">{children}</div>
          {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
          <RadixDialog.Close
            className="absolute right-3 top-3 text-lg muted hover:text-[var(--text)]"
            aria-label="Close"
          >
            ×
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

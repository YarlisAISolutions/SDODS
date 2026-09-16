import * as Radix from '@radix-ui/react-dropdown-menu';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * Styled Radix dropdown menu. Items get role="menuitem" and full keyboard support (arrows, typeahead,
 * Escape) from Radix; this file only supplies the look.
 */
export const Menu = Radix.Root;
export const MenuTrigger = Radix.Trigger;
export const MenuSub = Radix.Sub;
export const MenuRadioGroup = Radix.RadioGroup;

const surface = 'panel z-50 min-w-[220px] overflow-hidden p-1 text-sm shadow-xl';
const row =
  'flex w-full cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-[var(--panel-2)]';

export function MenuContent({ className, ...props }: ComponentProps<typeof Radix.Content>) {
  return (
    <Radix.Portal>
      <Radix.Content sideOffset={6} className={cn(surface, className)} {...props} />
    </Radix.Portal>
  );
}

export function MenuItem({
  className,
  danger,
  shortcut,
  children,
  ...props
}: ComponentProps<typeof Radix.Item> & { danger?: boolean; shortcut?: ReactNode }) {
  const cls = cn(row, danger && 'text-red-600 dark:text-red-400', className);
  // asChild hands the item's behaviour to a single child element (a link), so no wrapper spans.
  if (props.asChild)
    return (
      <Radix.Item className={cls} {...props}>
        {children}
      </Radix.Item>
    );
  return (
    <Radix.Item className={cls} {...props}>
      <span className="flex-1">{children}</span>
      {shortcut && <span className="muted text-[11px]">{shortcut}</span>}
    </Radix.Item>
  );
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof Radix.Label>) {
  return (
    <Radix.Label
      className={cn('px-2 pb-1 pt-2 text-[10px] uppercase tracking-wide muted', className)}
      {...props}
    />
  );
}

export function MenuSeparator({ className, ...props }: ComponentProps<typeof Radix.Separator>) {
  return <Radix.Separator className={cn('my-1 h-px bg-[var(--border)]', className)} {...props} />;
}

export function MenuSubTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof Radix.SubTrigger>) {
  return (
    <Radix.SubTrigger
      className={cn(row, 'data-[state=open]:bg-[var(--panel-2)]', className)}
      {...props}
    >
      <span className="flex-1">{children}</span>
      <span aria-hidden className="muted">
        ›
      </span>
    </Radix.SubTrigger>
  );
}

export function MenuSubContent({ className, ...props }: ComponentProps<typeof Radix.SubContent>) {
  return (
    <Radix.Portal>
      <Radix.SubContent
        sideOffset={4}
        className={cn(surface, 'min-w-[160px]', className)}
        {...props}
      />
    </Radix.Portal>
  );
}

export function MenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof Radix.RadioItem>) {
  return (
    <Radix.RadioItem className={cn(row, 'pl-7 relative', className)} {...props}>
      <Radix.ItemIndicator className="absolute left-2 text-brand-600">✓</Radix.ItemIndicator>
      {children}
    </Radix.RadioItem>
  );
}

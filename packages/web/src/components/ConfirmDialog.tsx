import { useEffect, useState, type ReactNode } from 'react';
import { Dialog } from './ui/Dialog';
import { Button, ErrorBox, Field, Input } from './ui';

/**
 * Confirmation for something that cannot be undone with a click.
 *
 * The app had no confirm pattern at all before this -- every destructive button fired straight
 * into a mutation -- so this is deliberately generic: the dataset and environment deletes have the
 * same shape and no UI yet.
 *
 * `confirmText` turns it into type-to-confirm. Reserve that for actions whose blast radius is a
 * whole project; a plain confirm is right for the rest.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmText,
  confirmLabel = 'Delete',
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** when set, the exact string the user has to type before the action unlocks */
  confirmText?: string;
  confirmLabel?: string;
  pending?: boolean;
  error?: unknown;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  // Reopening must not inherit the last attempt's typing, or a second delete is one click away.
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const unlocked = !confirmText || typed === confirmText;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            disabled={!unlocked || pending}
            data-testid="confirm-action"
          >
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {children}
        {confirmText && (
          <Field label={`Type ${confirmText} to confirm`}>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label={`Type ${confirmText} to confirm`}
              data-testid="confirm-text"
            />
          </Field>
        )}
        {error ? <ErrorBox error={error} /> : null}
      </div>
    </Dialog>
  );
}

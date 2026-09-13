import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('keeps the action locked until the exact text is typed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete demo-shop?"
        confirmText="demo-shop"
        onConfirm={onConfirm}
      />,
    );

    const button = screen.getByTestId('confirm-action');
    expect(button).toBeDisabled();

    // A near miss stays locked: this is the guard against deleting the wrong project.
    await user.type(screen.getByTestId('confirm-text'), 'demo-sho');
    expect(button).toBeDisabled();

    await user.type(screen.getByTestId('confirm-text'), 'p');
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('forgets what was typed when it is reopened', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete shop?"
        confirmText="shop"
        onConfirm={() => {}}
      />,
    );
    await user.type(screen.getByTestId('confirm-text'), 'shop');
    expect(screen.getByTestId('confirm-action')).toBeEnabled();

    rerender(
      <ConfirmDialog
        open={false}
        onOpenChange={() => {}}
        title="Delete shop?"
        confirmText="shop"
        onConfirm={() => {}}
      />,
    );
    rerender(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete shop?"
        confirmText="shop"
        onConfirm={() => {}}
      />,
    );
    // Carrying the previous confirmation over would put a second delete one click away.
    expect(screen.getByTestId('confirm-action')).toBeDisabled();
  });

  it('needs no typing when no confirmText is given', () => {
    render(<ConfirmDialog open onOpenChange={() => {}} title="Remove row?" onConfirm={() => {}} />);
    expect(screen.getByTestId('confirm-action')).toBeEnabled();
    expect(screen.queryByTestId('confirm-text')).toBeNull();
  });
});

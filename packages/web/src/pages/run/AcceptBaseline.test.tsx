import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StepView } from '../../api/types';

const calls: Array<{ path: string; init: { json?: unknown } }> = [];
vi.mock('../../api/client', async (orig) => {
  const mod = (await orig()) as object;
  return {
    ...mod,
    api: vi.fn(async (path: string, init: { json?: unknown } = {}) => {
      calls.push({ path, init });
      if (path.endsWith('/baselines/accept'))
        return {
          runId: 'run-1',
          project: 'demo-shop',
          accepted: [
            {
              name: 'inventory',
              runnerProject: 'demo-shop--ui--chromium',
              platform: 'linux',
              reason: 'changed',
              created: false,
              baseline: 'features/__screenshots__/demo-shop--ui--chromium/linux/inventory.png',
            },
          ],
        };
      if (path.startsWith('/api/artifacts/compare'))
        return {
          before: { url: 'data:image/png;base64,e' },
          after: { url: 'data:image/png;base64,a' },
          diff: { url: 'data:image/png;base64,d' },
          mismatchPixels: 75372,
          mismatchRatio: 0.08,
        };
      return {};
    }),
  };
});

import { StepCard } from './StepCard';
import { ToastProvider } from '../../components/ui/Toast';

const img = (id: string, phase: string) => ({
  id,
  url: `data:image/png;base64,${id}`,
  kind: 'visual',
  phase,
  fileName: `inventory-${phase}.png`,
  mediaType: 'image/png',
  width: 1280,
  height: 720,
});

const step: StepView = {
  id: 's3',
  stepIndex: 3,
  kind: 'step',
  keyword: 'And',
  text: 'the page should match the visual baseline "inventory"',
  status: 'failed',
  errorMessage: '75372 pixels (ratio 0.09 of all image pixels) are different.',
  heals: [],
  visual: {
    name: 'inventory',
    expected: img('e', 'expected'),
    actual: img('a', 'actual'),
    diff: img('d', 'diff'),
  },
};

function renderCard(props: Partial<Parameters<typeof StepCard>[0]> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MemoryRouter>
          <ul>
            <StepCard
              step={step}
              projectSlug="demo-shop"
              fingerprint="fp"
              runId="run-1"
              runnerProject="demo-shop--ui--chromium"
              canAcceptBaseline
              {...props}
            />
          </ul>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('Accept as baseline', () => {
  beforeEach(() => {
    calls.length = 0;
    localStorage.clear();
  });

  it('shows the diff before accepting and posts the check for this run target', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Accept as baseline' }));

    // Nothing is sent until the person confirms, and the confirm shows what they are accepting.
    expect(calls.filter((c) => c.path.includes('/baselines/'))).toEqual([]);
    const review = screen.getByTestId('accept-baseline-review');
    expect(within(review).getByAltText('expected')).toBeInTheDocument();
    expect(within(review).getByAltText('actual')).toBeInTheDocument();
    expect(within(review).getByAltText('diff')).toHaveAttribute('src', 'data:image/png;base64,d');

    await user.click(screen.getByTestId('confirm-action'));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/runs/run-1/baselines/accept')?.init.json).toEqual({
        names: ['demo-shop--ui--chromium/inventory'],
      }),
    );
    expect(await screen.findByText(/Updated features\/__screenshots__/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('accept-baseline-review')).toBeNull());
  }, 20_000);

  it('cancelling sends nothing', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Accept as baseline' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls.filter((c) => c.path.includes('/baselines/'))).toEqual([]);
  }, 20_000);

  it('is not offered to viewers or on a passing check', () => {
    const { unmount } = renderCard({ canAcceptBaseline: false });
    expect(screen.queryByRole('button', { name: 'Accept as baseline' })).toBeNull();
    unmount();
    renderCard({ step: { ...step, status: 'passed' } });
    expect(screen.queryByRole('button', { name: 'Accept as baseline' })).toBeNull();
  });
});

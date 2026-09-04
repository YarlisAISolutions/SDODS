import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, beforeEach } from 'vitest';
import { ScreenshotCompare } from './ScreenshotCompare';

const before = {
  id: 'b',
  url: 'data:image/png;base64,AAA',
  kind: 'screenshot',
  fileName: '00-before.png',
  mediaType: 'image/png',
  width: 1280,
  height: 720,
};
const after = {
  id: 'a',
  url: 'data:image/png;base64,BBB',
  kind: 'screenshot',
  fileName: '00-after.png',
  mediaType: 'image/png',
  width: 1280,
  height: 720,
};

function wrap(ui: React.ReactElement) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

describe('ScreenshotCompare', () => {
  beforeEach(() => localStorage.clear());

  it('switches between the four modes and remembers the choice', () => {
    wrap(<ScreenshotCompare before={before} after={after} storageKey="t-mode" />);
    expect(screen.getByRole('slider', { name: /before\/after slider/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'overlay' }));
    expect(screen.getByLabelText('overlay opacity')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'side-by-side' }));
    expect(screen.getByLabelText('zoom')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'diff' }));
    expect(screen.getByText(/Computing diff|mismatch/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('automax:t-mode')!)).toBe('diff');
  });

  it('restores the remembered mode', () => {
    localStorage.setItem('automax:t-mode', JSON.stringify('overlay'));
    wrap(<ScreenshotCompare before={before} after={after} storageKey="t-mode" />);
    expect(screen.getByRole('tab', { name: 'overlay' })).toHaveAttribute('aria-selected', 'true');
  });

  it('moves the slider with the keyboard', () => {
    wrap(<ScreenshotCompare before={before} after={after} storageKey="t-mode" />);
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('aria-valuenow', '50');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider).toHaveAttribute('aria-valuenow', '52');
  });

  it('renders a single image when only one side exists', () => {
    wrap(<ScreenshotCompare before={before} />);
    expect(screen.getByAltText('00-before.png')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });
});

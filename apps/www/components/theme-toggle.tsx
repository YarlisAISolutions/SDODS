'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // The placeholder is the button's size so the bar does not jump when the theme resolves.
  if (!mounted) return <span className="inline-block size-11" aria-hidden="true" />;
  const dark = resolvedTheme === 'dark';
  return (
    <button
      type="button"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      className="card inline-flex size-11 items-center justify-center text-base"
    >
      <span aria-hidden="true">{dark ? '☀' : '☾'}</span>
    </button>
  );
}

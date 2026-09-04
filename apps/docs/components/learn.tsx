import type { ReactNode } from 'react';

/** "What you'll learn" opener used at the top of every page. */
export function Learn({ children }: { children: ReactNode }) {
  return (
    <div className="sdods-learn">
      <strong>What you&apos;ll learn</strong>
      {children}
    </div>
  );
}

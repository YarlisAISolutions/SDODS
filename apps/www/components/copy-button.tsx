'use client';

import { useEffect, useState } from 'react';

/** Copy button that reports success without a layout shift, and out loud. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <>
      <button
        type="button"
        className="btn btn-secondary shrink-0"
        aria-label={`${label} the install command`}
        onClick={() => {
          navigator.clipboard?.writeText(text).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        {copied ? 'Copied' : label}
      </button>
      {/* The label swap is the only feedback there is, and a swap is silent. */}
      <span role="status" className="sr-only">
        {copied ? 'Install command copied to the clipboard' : ''}
      </span>
    </>
  );
}

/**
 * One command and its copy button.
 *
 * Never wrapped across lines: a wrapped install command has already been pasted in two halves and
 * failed, so it scrolls in its own box instead. Which is exactly why the copy button is not
 * optional — the part of a long command you cannot see is the part you would have missed.
 */
export function CommandRow({ command, label }: { command: string; label: string }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {/* min-w-0: without it the flex item refuses to shrink past its content, the overflow never
          engages and the copy button is pushed off the card. */}
      <pre
        tabIndex={0}
        role="region"
        aria-label={`Install command for ${label}`}
        className="min-w-0 grow overflow-x-auto"
      >
        <code>{command}</code>
      </pre>
      <CopyButton text={command} />
    </div>
  );
}

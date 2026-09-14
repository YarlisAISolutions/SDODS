'use client';

import { useEffect, useState } from 'react';

/** Copy text to the clipboard, with a fallback for pages without the async Clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the selection-based fallback
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand('copy');
    area.remove();
    return done;
  } catch {
    return false;
  }
}

function ClipboardIcon({ done }: { done: boolean }) {
  return done ? (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d="M20 6 9 17l-5-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <rect
        x="8"
        y="3"
        width="8"
        height="4"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2M9 12h6M9 16h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * A command in one line with an icon copy button. The line never wraps — a wrapped command gets
 * pasted in two halves — so it truncates with an ellipsis and the full value stays in the title and
 * in what is copied.
 */
export function CopyCommand({ value, what = 'command' }: { value: string; what?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="sk-command">
      <code className="sk-command-text" title={value}>
        {value}
      </code>
      <button
        type="button"
        className="sk-icon-button"
        aria-label={copied ? `Copied ${what}` : `Copy ${what}`}
        onClick={() => copyText(value).then(setCopied)}
      >
        <ClipboardIcon done={copied} />
      </button>
      <span role="status" className="sk-sr-only">
        {copied ? `${what} copied to the clipboard` : ''}
      </span>
    </div>
  );
}

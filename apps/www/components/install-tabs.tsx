'use client';

import { useEffect, useState } from 'react';

export type OsKey = 'unix' | 'windows';

const COMMANDS: Record<OsKey, { label: string; command: string; note: string }> = {
  unix: {
    label: 'macOS / Linux',
    command: 'curl -fsSL https://sdods.com/install.sh | sh',
    note: 'Options go after -s --, for example: | sh -s -- --workspace ~/my-tests --mcp claude',
  },
  windows: {
    label: 'Windows',
    command: 'irm https://sdods.com/install.ps1 | iex',
    note: 'With options: & ([scriptblock]::Create((irm https://sdods.com/install.ps1))) -Workspace C:\\my-tests',
  },
};

/** Copy button that reports success without a layout shift. */
function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
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
  );
}

/**
 * OS-tabbed install command. Defaults to the visitor's platform, which is the only thing most
 * people need from this page.
 */
export function InstallTabs({ compact = false }: { compact?: boolean }) {
  const [os, setOs] = useState<OsKey>('unix');

  useEffect(() => {
    const ua = navigator.userAgent || '';
    if (/Windows/i.test(ua)) setOs('windows');
  }, []);

  const active = COMMANDS[os];

  return (
    <div>
      <div className="flex gap-2" role="tablist" aria-label="Operating system">
        {(Object.keys(COMMANDS) as OsKey[]).map((key) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={os === key}
            className={os === key ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => setOs(key)}
          >
            {COMMANDS[key].label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <pre className="grow overflow-x-auto">
          <code>{active.command}</code>
        </pre>
        <CopyButton text={active.command} />
      </div>

      {!compact && <p className="muted mt-3 text-sm">{active.note}</p>}
    </div>
  );
}

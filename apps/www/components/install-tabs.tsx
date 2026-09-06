'use client';

import { useEffect, useId, useRef, useState } from 'react';

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

const KEYS = Object.keys(COMMANDS) as OsKey[];

/** Copy button that reports success without a layout shift, and out loud. */
function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
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
 * OS-tabbed install command. Defaults to the visitor's platform, which is the only thing most
 * people need from this page.
 *
 * The tabs are the real thing: arrows move between them, the tab that is selected is the only
 * one in the tab order, and each one owns the panel underneath.
 */
export function InstallTabs({ compact = false }: { compact?: boolean }) {
  const [os, setOs] = useState<OsKey>('unix');
  const base = useId();
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const ua = navigator.userAgent || '';
    if (/Windows/i.test(ua)) setOs('windows');
  }, []);

  const tabId = (key: OsKey) => `${base}-tab-${key}`;
  const panelId = (key: OsKey) => `${base}-panel-${key}`;

  function onKeyDown(event: React.KeyboardEvent) {
    const at = KEYS.indexOf(os);
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? KEYS[(at + 1) % KEYS.length]
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? KEYS[(at - 1 + KEYS.length) % KEYS.length]
          : event.key === 'Home'
            ? KEYS[0]
            : event.key === 'End'
              ? KEYS[KEYS.length - 1]
              : undefined;
    if (!next || next === os) return;
    event.preventDefault();
    setOs(next);
    tabs.current[next]?.focus();
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Operating system">
        {KEYS.map((key) => (
          <button
            key={key}
            ref={(el) => {
              tabs.current[key] = el;
            }}
            role="tab"
            type="button"
            id={tabId(key)}
            aria-selected={os === key}
            aria-controls={panelId(key)}
            tabIndex={os === key ? 0 : -1}
            onKeyDown={onKeyDown}
            className={os === key ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => setOs(key)}
          >
            {COMMANDS[key].label}
          </button>
        ))}
      </div>

      {KEYS.map((key) => (
        <div
          key={key}
          role="tabpanel"
          id={panelId(key)}
          aria-labelledby={tabId(key)}
          hidden={os !== key}
        >
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            {/* min-w-0: without it the flex item refuses to shrink past its content, the
                overflow never engages and the copy button is pushed off the card. */}
            <pre
              tabIndex={0}
              role="region"
              aria-label={`Install command for ${COMMANDS[key].label}`}
              className="min-w-0 grow overflow-x-auto"
            >
              <code>{COMMANDS[key].command}</code>
            </pre>
            <CopyButton text={COMMANDS[key].command} />
          </div>
          {!compact && <p className="muted mt-3 text-sm">{COMMANDS[key].note}</p>}
        </div>
      ))}
    </div>
  );
}

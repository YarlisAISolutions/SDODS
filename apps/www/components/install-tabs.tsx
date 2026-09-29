'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { CommandRow } from '@/components/copy-button';
import {
  TAB_CHANNELS,
  alternatesFor,
  defaultTabFor,
  type Channel,
  type ChannelId,
  type ChannelOs,
} from '@/lib/install-channels';

/**
 * Tabbed install commands, one tab per live channel.
 *
 * Which tabs exist is not a decision this component makes: `TAB_CHANNELS` only contains channels
 * whose registry has actually been probed and answered. A channel that is not published yet is
 * absent rather than disabled — a greyed-out "Homebrew" tab still promises something that does
 * not exist.
 *
 * The tabs are the real thing: arrows move between them, the tab that is selected is the only one
 * in the tab order, and each one owns the panel underneath.
 */
export function InstallTabs({ compact = false }: { compact?: boolean }) {
  // Compact is the home page, where the question is "what do I paste" and every extra tab is a
  // decision the visitor did not come to make. The scripts install on every platform, so the
  // short list loses nobody.
  const channels: Channel[] = compact
    ? TAB_CHANNELS.filter((c) => c.id === 'script-unix' || c.id === 'script-windows')
    : TAB_CHANNELS;

  const keys = channels.map((c) => c.id);
  const [active, setActive] = useState<ChannelId>(keys[0] ?? 'script-unix');
  const base = useId();
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    // `?os=` wins over the user agent: the SDODS dashboard links here with the OS it detected, and
    // someone sending a teammate the Windows command should not have it swapped for their own.
    const param = new URLSearchParams(window.location.search).get('os');
    const ua = navigator.userAgent || '';
    const os: ChannelOs =
      param === 'windows' || param === 'macos' || param === 'linux'
        ? param
        : /Windows/i.test(ua)
          ? 'windows'
          : /Mac OS X/i.test(ua)
            ? 'macos'
            : 'linux';
    const wanted = defaultTabFor(os);
    // Only if that tab is actually rendered: the default must never select a tab that is not there.
    if (keys.includes(wanted)) setActive(wanted);
    // Empty deps on purpose: `keys` is derived from a module constant and the platform does not
    // change mid-visit, so this runs once. Re-running it would undo the visitor's own tab choice.
  }, []);

  if (channels.length === 0) return null;

  const tabId = (key: ChannelId) => `${base}-tab-${key}`;
  const panelId = (key: ChannelId) => `${base}-panel-${key}`;

  function onKeyDown(event: React.KeyboardEvent) {
    const at = keys.indexOf(active);
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? keys[(at + 1) % keys.length]
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? keys[(at - 1 + keys.length) % keys.length]
          : event.key === 'Home'
            ? keys[0]
            : event.key === 'End'
              ? keys[keys.length - 1]
              : undefined;
    if (!next || next === active) return;
    event.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Installation method">
        {channels.map((channel) => (
          <button
            key={channel.id}
            ref={(el) => {
              tabs.current[channel.id] = el;
            }}
            role="tab"
            type="button"
            id={tabId(channel.id)}
            aria-selected={active === channel.id}
            aria-controls={panelId(channel.id)}
            tabIndex={active === channel.id ? 0 : -1}
            onKeyDown={onKeyDown}
            className={active === channel.id ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => setActive(channel.id)}
          >
            {channel.label}
          </button>
        ))}
      </div>

      {channels.map((channel) => {
        const alternates = compact ? [] : alternatesFor(channel.id);
        return (
          <div
            key={channel.id}
            role="tabpanel"
            id={panelId(channel.id)}
            aria-labelledby={tabId(channel.id)}
            hidden={active !== channel.id}
          >
            <div className="mt-4">
              <CommandRow command={channel.command} label={channel.label} />
            </div>
            {!compact && <p className="muted mt-3 text-sm">{channel.note}</p>}

            {alternates.length > 0 && (
              <div className="mt-6 border-t pt-4">
                <p className="muted text-sm font-semibold">
                  Or with a package manager you already use
                </p>
                {alternates.map((alt) => (
                  <div key={alt.id} className="mt-4">
                    <p className="text-sm font-semibold">{alt.label}</p>
                    <div className="mt-2">
                      <CommandRow command={alt.command} label={alt.label} />
                    </div>
                    <p className="muted mt-2 text-sm">{alt.note}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CopyCommand } from '../copy';
import { buildTools, type AgentProject, type AgentTool, type ToolId } from './tools';

export interface AgentInstallProps {
  project: AgentProject;
  /** Tools shown as tabs; the rest go under "More". Default: Claude Code and Cursor. */
  primary?: ToolId[];
  /** Every tool to offer, in order. Default: all that can work for the project. */
  tools?: ToolId[];
  /** Heading. Default: "Using an AI coding agent? Install {name}:" */
  title?: string;
  learnMoreHref?: string;
  learnMoreLabel?: string;
  /** `card` has a border and padding; `compact` sits inside other content, e.g. a page footer. */
  variant?: 'card' | 'compact';
  className?: string;
  /** localStorage key for the visitor's last choice; pass null to not remember it. */
  storageKey?: string | null;
}

function Sparkle() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d="M12 3l1.8 4.9L19 9.7l-5.2 1.8L12 16.5l-1.8-5L5 9.7l5.2-1.8L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d="m6 9 6 6 6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function readStored(key: string | null | undefined): string | null {
  if (!key) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string | null | undefined, value: string) {
  if (!key) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private mode or storage disabled: the choice just is not remembered
  }
}

/**
 * "Using an AI coding agent? Install …" — tabs for the main tools, a More menu for the rest, and
 * one copyable line per step.
 */
export function AgentInstall({
  project,
  primary = ['claude-code', 'cursor'],
  tools: order,
  title,
  learnMoreHref,
  learnMoreLabel = 'Learn more about using it with AI tools',
  variant = 'card',
  className,
  storageKey = 'sk-agent-install-tool',
}: AgentInstallProps) {
  const tools = useMemo(() => buildTools(project, order), [project, order]);
  const tabs = tools.filter((t) => primary.includes(t.id));
  const more = tools.filter((t) => !primary.includes(t.id));
  const [active, setActive] = useState<ToolId | undefined>(tabs[0]?.id ?? tools[0]?.id);
  const [open, setOpen] = useState(false);
  const base = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const moreButton = useRef<HTMLButtonElement | null>(null);
  const menuItems = useRef<Array<HTMLButtonElement | null>>([]);
  const root = useRef<HTMLDivElement | null>(null);

  // Restore after hydration so the server render and the first client render agree.
  useEffect(() => {
    const saved = readStored(storageKey);
    if (saved && tools.some((t) => t.id === saved)) setActive(saved as ToolId);
  }, [storageKey, tools]);

  useEffect(() => {
    // Runs when the menu opens or closes only: focus goes to the checked item once, not on every
    // selection change while the menu is already open.
    if (!open) return;
    menuItems.current[
      Math.max(
        0,
        more.findIndex((t) => t.id === active),
      )
    ]?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  if (tools.length === 0) return null;

  const current: AgentTool = tools.find((t) => t.id === active) ?? tools[0]!;
  const moreActive = more.some((t) => t.id === current.id);

  const choose = (id: ToolId) => {
    setActive(id);
    store(storageKey, id);
  };

  // Arrow keys move between the tabs and the More button, the WAI-ARIA tabs pattern.
  const stops = [...tabs.map((t) => t.id as string), ...(more.length ? ['more'] : [])];
  const focusStop = (stop: string | undefined) =>
    stop === 'more' ? moreButton.current?.focus() : stop && tabRefs.current[stop]?.focus();
  const onTabKey = (e: KeyboardEvent, stop: string) => {
    const at = stops.indexOf(stop);
    const next =
      e.key === 'ArrowRight'
        ? stops[(at + 1) % stops.length]
        : e.key === 'ArrowLeft'
          ? stops[(at - 1 + stops.length) % stops.length]
          : e.key === 'Home'
            ? stops[0]
            : e.key === 'End'
              ? stops[stops.length - 1]
              : undefined;
    if (next === undefined) return;
    e.preventDefault();
    focusStop(next);
    if (next !== 'more') choose(next as ToolId);
  };

  const onMenuKey = (e: KeyboardEvent, index: number) => {
    const n = more.length;
    const to =
      e.key === 'ArrowDown'
        ? (index + 1) % n
        : e.key === 'ArrowUp'
          ? (index - 1 + n) % n
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : undefined;
    if (to !== undefined) {
      e.preventDefault();
      menuItems.current[to]?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault();
      setOpen(false);
      moreButton.current?.focus();
    }
  };

  const panelId = `${base}-panel`;
  const menuId = `${base}-menu`;

  return (
    <section
      ref={root}
      className={['sk-agent-install', `sk-agent-install--${variant}`, className]
        .filter(Boolean)
        .join(' ')}
      aria-label={`Install ${project.name} in an AI coding agent`}
    >
      <p className="sk-agent-install-title">
        <Sparkle />
        <span>{title ?? `Using an AI coding agent? Install ${project.name}:`}</span>
      </p>

      <div className="sk-tabs" role="tablist" aria-label="AI coding agent">
        {tabs.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${t.id}`}
            aria-selected={current.id === t.id}
            aria-controls={panelId}
            tabIndex={current.id === t.id || (moreActive && t.id === tabs[0]?.id) ? 0 : -1}
            className="sk-tab"
            onClick={() => choose(t.id)}
            onKeyDown={(e) => onTabKey(e, t.id)}
          >
            {t.label}
          </button>
        ))}
        {more.length > 0 && (
          <div className="sk-more">
            <button
              ref={moreButton}
              type="button"
              role="tab"
              id={`${base}-tab-more`}
              aria-selected={moreActive}
              aria-controls={panelId}
              aria-haspopup="menu"
              aria-expanded={open}
              tabIndex={moreActive || tabs.length === 0 ? 0 : -1}
              className="sk-tab sk-more-button"
              onClick={() => setOpen((o) => !o)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpen(true);
                } else onTabKey(e, 'more');
              }}
            >
              {moreActive ? current.label : 'More'}
              <Chevron />
            </button>
            {open && (
              <div className="sk-menu" role="menu" id={menuId} aria-label="More AI coding agents">
                {more.map((t, i) => (
                  <button
                    key={t.id}
                    ref={(el) => {
                      menuItems.current[i] = el;
                    }}
                    type="button"
                    role="menuitemradio"
                    aria-checked={current.id === t.id}
                    tabIndex={-1}
                    className="sk-menu-item"
                    onClick={() => {
                      choose(t.id);
                      setOpen(false);
                      moreButton.current?.focus();
                    }}
                    onKeyDown={(e) => onMenuKey(e, i)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div
        className="sk-panel"
        role="tabpanel"
        id={panelId}
        aria-labelledby={`${base}-tab-${moreActive ? 'more' : current.id}`}
      >
        <p className="sk-intro">{current.intro}</p>
        <ol className="sk-steps">
          {current.steps.map((step, i) => (
            <li key={`${current.id}-${i}`} className="sk-step">
              {step.kind === 'note' ? (
                <p className="sk-note">{step.text}</p>
              ) : (
                <>
                  {step.caption && <span className="sk-caption">{step.caption}</span>}
                  {step.kind === 'command' ? (
                    <CopyCommand value={step.value} what={`${current.label} command`} />
                  ) : (
                    <a className="sk-link-button" href={step.href}>
                      {step.label}
                    </a>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      </div>

      {learnMoreHref && (
        <a className="sk-learn-more" href={learnMoreHref}>
          {learnMoreLabel}
        </a>
      )}
    </section>
  );
}

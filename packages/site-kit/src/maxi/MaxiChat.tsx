'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { copyText } from '../copy';
import { parseMarkdown, type Block, type Inline } from './markdown';
import { createSseParser } from './sse';
import { TutorAvatar, type TutorMood } from './TutorAvatar';

export interface MaxiChatProps {
  /** Base URL of the chat service. Nothing renders when it is empty, so sites can ship the widget dark. */
  endpoint: string | undefined;
  name: string;
  /** Shown under the name in the panel header. */
  tagline?: string;
  /** The first thing the assistant says in an empty conversation. */
  greeting: string;
  /** One-click questions for an empty conversation. */
  starters?: string[];
  /** Short line under the input, e.g. that answers can be wrong. */
  disclaimer?: ReactNode;
  placeholder?: string;
  launcherLabel?: string;
  /** Status lines while a tool runs, keyed by tool name. */
  toolLabels?: Record<string, string>;
  /** sessionStorage key for the conversation, so it survives navigating between pages. */
  storageKey?: string;
  className?: string;
}

type Role = 'user' | 'assistant';

interface ChatMessage {
  role: Role;
  content: string;
  /** Conversation id from the service, present once an answer finished; enables feedback. */
  id?: string;
  vote?: 'up' | 'down';
  /** An answer that failed or was stopped before any text arrived. */
  failed?: boolean;
}

const MAX_HISTORY = 19;
const MAX_INPUT = 4000;
const MAX_ASSISTANT = 16000;

/** The conversation as the service expects it: alternating turns, failed exchanges left out. */
export function historyFor(
  messages: ChatMessage[],
  question: string,
): Array<{ role: Role; content: string }> {
  const turns: Array<{ role: Role; content: string }> = [];
  for (let i = 0; i < messages.length; i++) {
    const user = messages[i]!;
    const answer = messages[i + 1];
    if (user.role !== 'user' || !answer || answer.role !== 'assistant') continue;
    i++;
    if (answer.failed || !answer.content.trim()) continue;
    turns.push(
      { role: 'user', content: user.content },
      { role: 'assistant', content: answer.content.slice(0, MAX_ASSISTANT) },
    );
  }
  turns.push({ role: 'user', content: question });
  return turns.slice(-MAX_HISTORY);
}

function load(key: string): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as ChatMessage[]) : [];
    return Array.isArray(parsed)
      ? parsed.filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
      : [];
  } catch {
    return [];
  }
}

function save(key: string, messages: ChatMessage[]) {
  try {
    sessionStorage.setItem(key, JSON.stringify(messages));
  } catch {
    // private mode or storage full: the conversation just won't survive a page change
  }
}

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'text':
        return <Fragment key={i}>{n.text}</Fragment>;
      case 'code':
        return <code key={i}>{n.text}</code>;
      case 'strong':
        return <strong key={i}>{renderInline(n.children)}</strong>;
      case 'em':
        return <em key={i}>{renderInline(n.children)}</em>;
      case 'link': {
        const external = /^https?:\/\//i.test(n.href);
        return (
          <a
            key={i}
            href={n.href}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {renderInline(n.children)}
          </a>
        );
      }
    }
  });
}

function CodeBlock({ block }: { block: Extract<Block, { type: 'code' }> }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="sk-maxi-code">
      <div className="sk-maxi-code-bar">
        <span>{block.lang || 'code'}</span>
        {!block.open && (
          <button
            type="button"
            className="sk-maxi-text-button"
            aria-label={copied ? 'Copied' : `Copy ${block.lang || 'code'}`}
            onClick={() => copyText(block.text).then(setCopied)}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      <pre>
        <code>{block.text}</code>
      </pre>
    </div>
  );
}

function Markdown({ text }: { text: string }) {
  return (
    <>
      {parseMarkdown(text).map((b, i) => {
        switch (b.type) {
          case 'paragraph':
            return <p key={i}>{renderInline(b.children)}</p>;
          case 'heading':
            return (
              <p key={i} className="sk-maxi-heading">
                {renderInline(b.children)}
              </p>
            );
          case 'code':
            return <CodeBlock key={i} block={b} />;
          case 'list': {
            const Tag = b.ordered ? 'ol' : 'ul';
            return (
              <Tag key={i}>
                {b.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </Tag>
            );
          }
          case 'table':
            return (
              <div
                key={i}
                className="sk-maxi-table"
                tabIndex={0}
                role="region"
                aria-label="Table, scrolls sideways"
              >
                <table>
                  <thead>
                    <tr>
                      {b.header.map((cell, j) => (
                        <th key={j}>{renderInline(cell)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, j) => (
                      <tr key={j}>
                        {row.map((cell, k) => (
                          <td key={k}>{renderInline(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'rule':
            return <hr key={i} />;
        }
      })}
    </>
  );
}

function Icon({ d, label }: { d: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      focusable="false"
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const CLOSE = 'M18 6 6 18M6 6l12 12';
const SEND = 'M5 12h14M13 6l6 6-6 6';
const STOP = 'M7 7h10v10H7z';
const THUMB_UP =
  'M7 10v10H4V10h3zm0 0 4-7a2 2 0 0 1 2 2v4h5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 16.8 20H7';
const THUMB_DOWN =
  'M17 14V4h3v10h-3zm0 0-4 7a2 2 0 0 1-2-2v-4H6a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 7.2 4H17';
const NEW = 'M12 5v14M5 12h14';

/**
 * A floating chat with an assistant served over SSE: a launcher in the corner that opens a panel
 * with streaming answers, copyable code, and thumbs up/down on each answer.
 */
export function MaxiChat({
  endpoint,
  name,
  tagline,
  greeting,
  starters = [],
  disclaimer,
  placeholder = 'Ask a question',
  launcherLabel,
  toolLabels = {},
  storageKey = 'sk-maxi-conversation',
  className,
}: MaxiChatProps) {
  const base = endpoint?.replace(/\/+$/, '');
  const [open, setOpen] = useState(false);
  // Read on the client only. The panel starts closed, so messages never reach the server-rendered
  // markup and restoring them here cannot cause a hydration mismatch.
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    typeof window === 'undefined' ? [] : load(storageKey),
  );
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<string>();
  const [error, setError] = useState<{ message: string; retry?: string }>();
  const [announcement, setAnnouncement] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const titleId = useId();
  const panelId = useId();

  useEffect(() => {
    if (!busy) save(storageKey, messages);
  }, [messages, busy, storageKey]);

  // Focus follows the panel: into the input when it opens, back to the launcher when it closes
  // (not on first render, which would steal focus from the page).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (wasOpen.current) launcherRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    const log = logRef.current;
    if (log && stickToBottom.current) log.scrollTop = log.scrollHeight;
  }, [messages, activity, error]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const close = useCallback(() => setOpen(false), []);

  const update = (fn: (last: ChatMessage) => ChatMessage) =>
    setMessages((prev) =>
      prev.length ? [...prev.slice(0, -1), fn(prev[prev.length - 1]!)] : prev,
    );

  const send = useCallback(
    async (question: string, retrying = false) => {
      const text = question.trim().slice(0, MAX_INPUT);
      if (!text || busy || !base) return;
      const history = historyFor(messages, text);
      setMessages((prev) => {
        // A retry replaces the exchange that failed instead of showing the question twice.
        const last = prev[prev.length - 1];
        const kept = retrying && last?.failed ? prev.slice(0, -2) : prev;
        return [...kept, { role: 'user', content: text }, { role: 'assistant', content: '' }];
      });
      setInput('');
      setError(undefined);
      setBusy(true);
      setAnnouncement(`${name} is answering`);
      stickToBottom.current = true;

      const controller = new AbortController();
      abortRef.current = controller;
      let received = false;
      try {
        const res = await fetch(`${base}/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages: history, page: window.location.href }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw Object.assign(new Error(body.error ?? `${name} is unavailable right now.`), {
            retry: res.status >= 500 || res.status === 429,
          });
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let streamError: { message: string; retryable: boolean } | undefined;
        const parser = createSseParser(({ event, data }) => {
          const payload = JSON.parse(data) as Record<string, unknown>;
          if (event === 'text') {
            received = true;
            setActivity(undefined);
            update((m) => ({ ...m, content: m.content + String(payload.text ?? '') }));
          } else if (event === 'tool') {
            setActivity(toolLabels[String(payload.name)] ?? 'Working on it…');
          } else if (event === 'done') {
            update((m) => ({ ...m, id: String(payload.id) }));
          } else if (event === 'error') {
            streamError = {
              message: String(payload.message),
              retryable: Boolean(payload.retryable),
            };
          }
        });
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
        parser.end();
        if (streamError)
          throw Object.assign(new Error(streamError.message), { retry: streamError.retryable });
        setAnnouncement(`${name} answered`);
      } catch (e) {
        if (controller.signal.aborted) {
          if (!received) update((m) => ({ ...m, failed: true }));
          setAnnouncement('Stopped');
        } else {
          const err = e as Error & { retry?: boolean };
          const message =
            err instanceof TypeError
              ? `Couldn't reach ${name}. Check your connection and try again.`
              : err.message;
          if (!received) update((m) => ({ ...m, failed: true }));
          setError({ message, retry: err.retry !== false ? text : undefined });
          setAnnouncement(message);
        }
      } finally {
        abortRef.current = null;
        setActivity(undefined);
        setBusy(false);
      }
    },
    [base, busy, messages, name, toolLabels],
  );

  const vote = async (index: number, value: 'up' | 'down') => {
    const message = messages[index];
    if (!message?.id || message.vote || !base) return;
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, vote: value } : m)));
    setAnnouncement(
      value === 'up' ? 'Thanks for the feedback' : 'Thanks, that helps improve the answers',
    );
    try {
      await fetch(`${base}/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: message.id, vote: value }),
      });
    } catch {
      // feedback is best effort
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const onInputKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  const newChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setError(undefined);
    inputRef.current?.focus();
  };

  if (!base) return null;

  const mood: TutorMood = error ? 'concerned' : busy ? (activity ? 'thinking' : 'talking') : 'idle';
  const classes = ['sk-maxi', className].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          className="sk-maxi-launcher"
          aria-haspopup="dialog"
          aria-expanded="false"
          aria-controls={panelId}
          onClick={() => setOpen(true)}
        >
          <TutorAvatar size={30} decorative />
          <span>{launcherLabel ?? `Ask ${name}`}</span>
        </button>
      )}
      {open && (
        <section
          id={panelId}
          className="sk-maxi-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            }
          }}
        >
          <header className="sk-maxi-header">
            <TutorAvatar size={34} mood={mood} decorative />
            <div className="sk-maxi-title">
              <h2 id={titleId}>{name}</h2>
              {tagline && <p>{tagline}</p>}
            </div>
            {messages.length > 0 && (
              <button
                type="button"
                className="sk-icon-button"
                aria-label="New conversation"
                title="New conversation"
                onClick={newChat}
              >
                <Icon d={NEW} />
              </button>
            )}
            <button
              type="button"
              className="sk-icon-button"
              aria-label={`Close ${name}`}
              onClick={close}
            >
              <Icon d={CLOSE} />
            </button>
          </header>

          <div
            ref={logRef}
            className="sk-maxi-log"
            onScroll={(e) => {
              const el = e.currentTarget;
              stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
            }}
          >
            <div className="sk-maxi-message sk-maxi-message--assistant">
              <p>{greeting}</p>
            </div>
            {messages.length === 0 && starters.length > 0 && (
              <div className="sk-maxi-starters">
                {starters.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="sk-maxi-starter"
                    onClick={() => void send(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => {
              if (m.role === 'user') {
                return (
                  <div key={i} className="sk-maxi-message sk-maxi-message--user">
                    <p>{m.content}</p>
                  </div>
                );
              }
              const streaming = busy && i === messages.length - 1;
              if (!m.content && !streaming) return null;
              return (
                <div key={i} className="sk-maxi-message sk-maxi-message--assistant">
                  {m.content ? (
                    <Markdown text={m.content} />
                  ) : (
                    <span className="sk-maxi-typing" aria-hidden="true" />
                  )}
                  {m.id && !streaming && (
                    <div
                      className="sk-maxi-feedback"
                      role="group"
                      aria-label="Was this answer helpful?"
                    >
                      <button
                        type="button"
                        className="sk-icon-button"
                        aria-label="Helpful"
                        aria-pressed={m.vote === 'up'}
                        disabled={Boolean(m.vote)}
                        onClick={() => void vote(i, 'up')}
                      >
                        <Icon d={THUMB_UP} />
                      </button>
                      <button
                        type="button"
                        className="sk-icon-button"
                        aria-label="Not helpful"
                        aria-pressed={m.vote === 'down'}
                        disabled={Boolean(m.vote)}
                        onClick={() => void vote(i, 'down')}
                      >
                        <Icon d={THUMB_DOWN} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {activity && <p className="sk-maxi-activity">{activity}</p>}
            {error && (
              <div className="sk-maxi-error" role="alert">
                <p>{error.message}</p>
                {error.retry && (
                  <button
                    type="button"
                    className="sk-maxi-text-button"
                    onClick={() => void send(error.retry!, true)}
                  >
                    Try again
                  </button>
                )}
              </div>
            )}
          </div>

          <form className="sk-maxi-form" onSubmit={onSubmit}>
            <label className="sk-sr-only" htmlFor={`${panelId}-input`}>
              {`Message ${name}`}
            </label>
            <textarea
              id={`${panelId}-input`}
              ref={inputRef}
              rows={2}
              value={input}
              maxLength={MAX_INPUT}
              placeholder={placeholder}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onInputKey}
            />
            {busy ? (
              <button
                type="button"
                className="sk-maxi-send"
                aria-label="Stop answering"
                onClick={() => abortRef.current?.abort()}
              >
                <Icon d={STOP} />
              </button>
            ) : (
              <button
                type="submit"
                className="sk-maxi-send"
                aria-label="Send"
                disabled={!input.trim()}
              >
                <Icon d={SEND} />
              </button>
            )}
          </form>
          {disclaimer && <p className="sk-maxi-disclaimer">{disclaimer}</p>}
          <span role="status" className="sk-sr-only">
            {announcement}
          </span>
        </section>
      )}
    </div>
  );
}

'use client';

/**
 * The two-minute film, with its titles in the DOM rather than in the picture.
 *
 * Everything a viewer reads — the chapter that is playing, the closing line, the transcript —
 * is HTML. That is deliberate: text baked into video cannot be spelled reliably by a generator,
 * cannot be selected, translated, indexed or read aloud by a screen reader, and cannot be fixed
 * without re-rendering the film.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { withBase } from '@/lib/base-path';
import { CHAPTERS, TRANSCRIPT, clock } from './chapters';

export function Film() {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [at, setAt] = useState(0);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const chapter = CHAPTERS.reduce((found, c) => (at >= c.at ? c : found), CHAPTERS[0]!);

  const toggle = useCallback(() => {
    const el = video.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, []);

  const seek = (seconds: number) => {
    const el = video.current;
    if (!el) return;
    el.currentTime = seconds;
    setEnded(false);
    void el.play();
  };

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const tick = () => setAt(el.currentTime);
    const onPlay = () => {
      setStarted(true);
      setEnded(false);
    };
    el.addEventListener('timeupdate', tick);
    el.addEventListener('play', onPlay);
    el.addEventListener('ended', () => setEnded(true));
    return () => {
      el.removeEventListener('timeupdate', tick);
      el.removeEventListener('play', onPlay);
    };
  }, []);

  return (
    <section className="w-full text-left" aria-labelledby="film-heading">
      <h2 id="film-heading" className="sr-only">
        SDODS in two minutes
      </h2>

      <div className="group relative overflow-hidden rounded-xl border border-fd-border bg-black shadow-lg">
        <video
          ref={video}
          className="block w-full"
          poster={withBase('/film/sdods-film.jpg')}
          preload="metadata"
          playsInline
          controls={started}
          onClick={toggle}
        >
          <source src={withBase('/film/sdods-film.mp4')} type="video/mp4" />
          <track
            kind="captions"
            src={withBase('/film/sdods-film.vtt')}
            srcLang="en"
            label="English"
            default
          />
        </video>

        {/* Before the first play: what this is, and one button. */}
        {!started && (
          <button
            type="button"
            onClick={toggle}
            className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-t from-black/75 via-black/25 to-black/50 text-white transition hover:from-black/80"
          >
            <span className="flex size-16 items-center justify-center rounded-full bg-white/95 text-black shadow-xl transition group-hover:scale-105">
              <svg viewBox="0 0 24 24" className="ml-1 size-7" fill="currentColor" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
            <span className="text-lg font-semibold">Two minutes on what SDODS is for</span>
            <span className="text-sm text-white/75">
              Filmed in the product · 1:59 · captions included
            </span>
          </button>
        )}

        {/* While it plays: the chapter, small, out of the way. */}
        {started && !ended && (
          <div className="pointer-events-none absolute top-0 right-0 left-0 flex items-start justify-between p-3 opacity-0 transition group-hover:opacity-100">
            <span className="rounded-md bg-black/65 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
              {chapter.title}
            </span>
            <span className="rounded-md bg-black/65 px-2 py-1 font-mono text-[11px] text-white/80 backdrop-blur">
              {clock(at)} / 1:59
            </span>
          </div>
        )}

        {/* After it ends: the line the film closes on, spelled correctly. */}
        {ended && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-black/85 text-center text-white">
            <p className="text-2xl font-bold tracking-tight">Test automation you can defend.</p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link
                href="/docs"
                className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black"
              >
                Get started
              </Link>
              <Link
                href="/docs/roadmap"
                className="rounded-md border border-white/40 px-4 py-2 text-sm font-medium"
              >
                See the road
              </Link>
              <button
                type="button"
                onClick={() => seek(0)}
                className="rounded-md border border-white/40 px-4 py-2 text-sm font-medium"
              >
                Watch again
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Chapters: the film's argument, in six lines, each one a way in. */}
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {CHAPTERS.map((c) => {
          const current = c.title === chapter.title && started;
          return (
            <li key={c.title}>
              <button
                type="button"
                onClick={() => seek(c.at)}
                aria-current={current ? 'true' : undefined}
                className={`w-full rounded-lg border p-3 text-left transition hover:bg-fd-accent ${
                  current ? 'border-fd-primary bg-fd-accent' : 'border-fd-border'
                }`}
              >
                <span className="font-mono text-xs text-fd-muted-foreground">{clock(c.at)}</span>
                <span className="mt-0.5 block text-sm font-semibold">{c.title}</span>
                <span className="mt-0.5 block text-xs text-fd-muted-foreground">{c.blurb}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setTranscriptOpen((open) => !open)}
          className="text-sm text-fd-primary underline underline-offset-2"
          aria-expanded={transcriptOpen}
        >
          {transcriptOpen ? 'Hide the transcript' : 'Read the transcript instead'}
        </button>
        {transcriptOpen && (
          <ol className="mt-3 space-y-2 rounded-lg border border-fd-border p-4 text-sm text-fd-muted-foreground">
            {TRANSCRIPT.map((line, i) => (
              <li key={line} className="flex gap-3">
                <span className="shrink-0 font-mono text-xs text-fd-muted-foreground/70">
                  {clock(i * 7.4)}
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <p className="mt-2 text-xs text-fd-muted-foreground">
        Twelve of the sixteen shots are SDODS recording its own interface; the narration and score
        were generated locally.
      </p>
    </section>
  );
}

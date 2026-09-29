'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { COMMUNITY_ENABLED, myVotes, vote as sendVote, type VoteValue } from '@/lib/community';
import { useUser } from '@/components/qa/community';
import type { Profile } from '@/lib/questions';

/**
 * Votes on the real posts: live questions and answers people posted on the site. The illustrative
 * example threads are never voted on.
 *
 * One provider per page fetches the signed-in user's own votes (and reputation) for every post on
 * it in a single request, and the authors' public reputation for the bylines.
 */

type VotesContext = {
  signedIn: boolean;
  mine: Record<string, VoteValue>;
  setMine: (path: string, v: VoteValue) => void;
  rep: Record<string, number>;
  profiles: Record<string, Profile>;
};

const Ctx = createContext<VotesContext>({
  signedIn: false,
  mine: {},
  setMine: () => {},
  rep: {},
  profiles: {},
});

type ProviderProps = {
  /** Every votable post on the page, as service paths. */
  paths: string[];
  /** Author uids to show reputation for. */
  authors: string[];
  children: ReactNode;
};

/** Signed-in voting when the community is on; read-only scores otherwise. Chosen at build time. */
export const VotesProvider = COMMUNITY_ENABLED ? LiveVotesProvider : StaticVotesProvider;

function LiveVotesProvider(props: ProviderProps) {
  const user = useUser();
  return <VotesState {...props} signedIn={Boolean(user)} />;
}

/** Without the service there is no one to vote as, and the auth SDK never loads. */
function StaticVotesProvider(props: ProviderProps) {
  return <VotesState {...props} signedIn={false} />;
}

function VotesState({ paths, authors, children, signedIn }: ProviderProps & { signedIn: boolean }) {
  const [mine, setMineState] = useState<Record<string, VoteValue>>({});
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const pathsKey = paths.join(',');
  const authorsKey = [...new Set(authors)].sort().join(',');

  useEffect(() => {
    if (!signedIn || !pathsKey) return;
    let live = true;
    myVotes(pathsKey.split(','))
      .then((r) => live && setMineState(r.votes))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [signedIn, pathsKey]);

  useEffect(() => {
    if (!authorsKey) return;
    let live = true;
    import('@/lib/questions')
      .then(({ profiles }) => profiles(authorsKey.split(',')))
      .then((p) => live && setProfiles(p))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [authorsKey]);

  return (
    <Ctx.Provider
      value={{
        signedIn,
        mine,
        setMine: (path, v) => setMineState((m) => ({ ...m, [path]: v })),
        rep: Object.fromEntries(Object.entries(profiles).map(([k, v]) => [k, v.rep])),
        profiles,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

/** An author's public profile (reputation and badges), once loaded. */
export function useProfile(uid: string | null): Profile | null {
  const { profiles } = useContext(Ctx);
  return uid ? (profiles[uid] ?? null) : null;
}

/** An author's public reputation, once loaded. */
export function useRep(uid: string | null): number | null {
  const { rep } = useContext(Ctx);
  return uid && rep[uid] !== undefined ? rep[uid]! : null;
}

/**
 * The score beside a post, with up and down buttons when the community is on. A second click on the
 * same arrow withdraws the vote, as on Stack Overflow.
 */
export function VoteControl({ path, score }: { path: string; score: number }) {
  const { signedIn, mine, setMine } = useContext(Ctx);
  const [shown, setShown] = useState(score);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const current = mine[path] ?? 0;

  useEffect(() => setShown(score), [score]);

  if (!COMMUNITY_ENABLED)
    return (
      <span className="muted flex min-w-[2.5rem] flex-col items-center text-xs">
        <span className="tabular-nums">{score}</span>
        <span className="text-[0.65rem]">votes</span>
      </span>
    );

  const cast = async (dir: 1 | -1) => {
    if (!signedIn) {
      setMessage('Sign in to vote.');
      return;
    }
    const next: VoteValue = current === dir ? 0 : dir;
    setBusy(true);
    setMessage(null);
    try {
      const r = await sendVote(path, next);
      setShown(r.score);
      setMine(path, r.value);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const arrow = (dir: 1 | -1) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => void cast(dir)}
      aria-label={dir === 1 ? 'Vote up' : 'Vote down'}
      aria-pressed={current === dir}
      className={`rounded px-1.5 leading-none ${
        current === dir ? 'text-[var(--brand)]' : 'muted hover:text-[var(--brand)]'
      }`}
    >
      {dir === 1 ? '▲' : '▼'}
    </button>
  );

  return (
    <div className="flex min-w-[2.5rem] flex-col items-center text-sm">
      {arrow(1)}
      <span className="tabular-nums font-semibold" aria-live="polite">
        {shown}
      </span>
      {arrow(-1)}
      {message && (
        <span role="status" className="muted mt-1 w-28 text-center text-[0.7rem]">
          {message}
        </span>
      )}
    </div>
  );
}
